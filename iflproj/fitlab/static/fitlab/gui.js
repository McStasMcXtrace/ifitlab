/*
* A nodespeak compatible graph ui using d3.js for drawing and force layouts.
*
* Written by Jakob Garde 2017-2018.
*/

// various drawing settings
const width = 790;
const height = 700;
const anchorRadius = 6;
const pathChargeStrength = -10;
const distanceChargeStrength = -10;
const pathLinkStrength = 1;
const distance = 20;

class LinkHelper {
  // helper line draw / register & deregister events
  // TODO: FIX LinkHelper to check for self-destruction at every mouse move, use
  // mouse state as a determinant
  constructor(svgroot, svgbranch, p0, destructor) {
    svgroot
      .on("mousemove", function() {
        // TODO: check mouse button state (down) and elliminate the mouseup event,
        // since this event can be not caught by the svg

        let m = d3.mouse(svgroot.node());
        self.linkHelperBranch
          .select("path")
          .datum([p0, m])
          .attr('d', d3.line()
            .x( function(p) { return p[0]; } )
            .y( function(p) { return p[1]; } )
          );
      } );
    svgroot
      .on("mouseup", function() {
        svgbranch.selectAll("path").remove();
        svgroot.on("mousemove", null);
        destructor();
      } );
    // draw initial line
    let m = d3.mouse(svgroot.node());
    svgbranch
      .append("path")
      .classed("linkHelper", true)
      .datum([p0, m])
      .attr('d', d3.line()
        .x( function(p) { return p[0]; } )
        .y( function(p) { return p[1]; } )
      );
    svgbranch.lower();
  }
}

// responsible for drawing, and acts as an interface
class GraphDraw {
  constructor(graphData, mouseAddLinkCB, delNodeCB, selectNodeCB, executeNodeCB, createNodeCB, nodeMouseDownCB) {
    self = this;

    this.graphData = graphData; // this is needed for accessing anchors and nodes for drawing and simulations
    this.mouseAddLinkCB =  mouseAddLinkCB; // this is callled when anchors are dragged to other anchors
    this.delNodeCB = delNodeCB;
    this.selectNodeCB = selectNodeCB;
    this.executeNodeCB = executeNodeCB;
    this.createNodeCB = createNodeCB;
    this.nodeMouseDownCB = nodeMouseDownCB; // this is used for PlotLines implementation, and can implicitly influence plotlines drawing

    this.svg = d3.select('body')
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      //.append("g")
      //.call(d3.zoom().on("zoom", function () {
      //  this.svg.attr("transform", d3.event.transform);
      //}.bind(this)));

    this.svg
      .on("click", function() {
        //console.log(d3.event); // enables debugging of click event in various browsers

        self.graphData.setSelectedNode(null);
        self.selectNodeCB( null );
        self.update();
        let m = d3.mouse(this)
        let svg_x = m[0];
        let svg_y = m[1];
        createNodeCB(svg_x, svg_y);
      } );

    // force layout simulations
    this.collideSim = d3.forceSimulation()
      .force("collide",
        d3.forceCollide( function(d) { return d.colliderad; } )
      )
      .stop()
      .on("tick", this.update);
    this.centeringSim = d3.forceSimulation()
      .force("centering",
        d3.forceCenter(width/2, height/2)
      )
      .stop()
      .on("tick", this.update);
    this.pathSim = d3.forceSimulation()
      .force("link",
        d3.forceLink()
          .strength(pathLinkStrength)
          .distance( function(d) { return distance; } )
      )
      // force to keep links out of node centers and anchors
      .force("pathcharge",
        d3.forceManyBody()
          .strength(pathChargeStrength)
      )
      .stop()
      .on("tick", this.update);
    this.distanceSim = null;

    this.draggable = null;
    this.dragAnchor = null;
    this.dragNode = null;

    // root nodes for various item types (NOTE: the ordering matters)
    this.linkGroup = this.svg.append("g");
    this.splineGroup = this.svg.append("g");
    this.nodeGroup = this.svg.append("g");
    this.tooltip = this.svg.append("g")
      .attr("opacity", 0);
    this.tooltip.append("rect")
      .attr("x", -30)
      .attr("y", -13)
      .attr("width", 60)
      .attr("height", 26)
      .attr("fill", 'white')
      .attr("stroke", "black");
    this.tooltip.append("text")
      .attr("id", "tooltip_text")
      .attr("text-anchor", "left")
      .attr("dominant-baseline", "middle")
      .attr("x", -23);

    // svg resize @ window resize
    let wresize = function() {
      this.svg.attr("width", window.innerWidth-20).attr("height", window.innerHeight-25);
      this.recenter();
    }.bind(this);
    window.onresize = wresize;
    wresize();

    // specific selections
    this.nodes = null;
    this.paths = null;
    this.anchors = null;
    this.arrowHeads = null;

    this.linkHelperBranch = this.svg.append("g");
    this.h = null;

    // listeners
    this._updateListn = [];
    this._drawListn = [];
  }
  addUpdateListener(listener) {
    this._updateListn.push(listener);
  }
  addDrawListener(listener) {
    this._drawListn.push(listener);
  }
  _callUpdateListeners() {
    for (let i=0;i<this._updateListn.length;i++) this._updateListn[i]();
  }
  _callDrawListeners() {
    for (let i=0;i<this._drawListn.length;i++) this._drawListn[i]();
  }
  recenter() {
    // TODO: the UI element related code should be called via a proxy callback to generalize this interface

    // unwanted, test-only explicit reference to #buttons
    let btnsmenu = d3.select("#buttons");
    btnsmenu.style("left", window.innerWidth/2-btnsmenu.node().clientWidth/2 + "px");
    let btnsmenu_2 = d3.select("#buttons_2");
    btnsmenu_2.style("left", window.innerWidth/2-btnsmenu_2.node().clientWidth/2 + "px");

    self.centeringSim.stop();
    self.centeringSim.force("centering").x(window.innerWidth/2);
    self.centeringSim.force("centering").y(window.innerHeight/2);
    let nodes = self.graphData.getGraphicsNodeObjs();
    let anchors = self.graphData.getAnchors();
    self.centeringSim.nodes(nodes.concat(anchors));
    self.centeringSim.alpha(1).restart();
  }
  resetChargeSim() {
    // the charge force seems to have to reset like this for some reason
    self.distanceSim = d3.forceSimulation(self.graphData.getGraphicsNodeObjs())
      .force("noderepulsion",
        d3.forceManyBody()
          .strength( distanceChargeStrength )
          .distanceMin(0)
          .distanceMax(75))
      .stop()
      .on("tick", self.update);
  }
  restartChargeSim() {
    self.distanceSim.stop();
    self.distanceSim.alpha(1).restart();
  }
  resetAndRestartPathSim(id) {
    let anchors = null;
    let forcelinks = null;
    if (!id) {
      anchors = self.graphData.getAnchors();
      forcelinks = self.graphData.getForceLinks();
    }
    else {
      let a_f = self.graphData.getAnchorsAndForceLinks(id)
      anchors = a_f[0];
      forcelinks = a_f[1];
    }

    self.pathSim.stop();
    self.pathSim.nodes(anchors);
    self.pathSim.force("link").links(forcelinks);

    self.pathSim.alpha(1);
    for (var i=0; i < 300; i++) {
      self.pathSim.tick();
    }
    self.update();
  }
  restartCollideSim() {
    self.collideSim.stop();
    self.collideSim.nodes(self.graphData.getGraphicsNodeObjs());
    self.collideSim.alpha(1).restart();
    // path anchors go into the center-sim only
    self.centeringSim.stop();
    let nodes = self.graphData.getGraphicsNodeObjs();
    let anchors = self.graphData.getAnchors();
    self.centeringSim.nodes(nodes.concat(anchors));
    self.centeringSim.alpha(1).restart();
  }
  dragged(d) {
    // reheating collision protection is needed during long drags
    if (self.collideSim.alpha() < 0.1) { self.restartCollideSim(); }

    d.x += d3.event.dx;
    d.y += d3.event.dy;

    self._callUpdateListeners();
  }
  dragstarted(d) {
    self.restartCollideSim();
  }
  dragended(d) {
    self.graphData.recalcPathAnchorsAroundNodeObj(d);

    // restart post-drag relevant layout sims
    self.restartChargeSim();
    self.resetAndRestartPathSim(d.owner.id);
    self.recenter();
  }
  anchorMouseDown(d) {
    self.dragAnchor = d;
    self.h = new LinkHelper(self.svg, self.linkHelperBranch, [d.x, d.y], function() { self.h = null; }.bind(self) );
  }
  anchorMouseUp(d, branch) {
    let s = self.dragAnchor;

    if (s && s != d && s.owner != d.owner) self.mouseAddLinkCB(s, d);
    self.dragAnchor = null;
  }
  showTooltip(x, y, tip) {
    if (tip == '') return;

    let text = d3.select("#tooltip_text")
      .text(tip);
    let width = text
      .node()
      .getComputedTextLength();
    self.tooltip.select("rect")
      .attr("width", width + 15);

    self.tooltip
      .attr("transform", "translate(" + (x+40) + "," + (y+25) + ")")
      .style("opacity", 1);
  }
  clearTooltip() {
    self.tooltip
      .style("opacity", 0);
  }
  update() {
    self.draggable
      .attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; } );
    self.nodes
      .classed("selected", function(d) { return d.active; })
    self.splines
      .each( function(l, i) {
        l.update(d3.select(this), i);
      });

    /*
    // for DEBUG purposes
    if (!self.anchors) return;
    self.anchors
      .attr("cx", function(d) { return d.x; })
      .attr("cy", function(d) { return d.y; });
    */

    self._callUpdateListeners();
  }
  static drawNodes(branch) {
    // draw anchor nodes
    branch.each( function(d, i) {
      let sbranch = d3.select(this)
        .append("g")
        .selectAll("circle")
        .data(d.anchors)
        .enter()
        .append("g");
      sbranch
        .append("circle")
        .attr('r', anchorRadius)
        // semi-static transform, which does not belong in update()
        .attr("transform", function(p) { return "translate(" + p.localx + "," + p.localy + ")" } )
        .style("fill", "white")
        .style("stroke", "#000")
        .classed("hidden", function(d) { return d.isLinked; })
        .on("mousedown", function(p) {
          // these two lines will prevent drag behavior
          d3.event.stopPropagation();
          d3.event.preventDefault();
          self.anchorMouseDown(p);
        } )
        .on("mouseup", function(p) {
          self.anchorMouseUp(p);
        } )
        .on("mouseover", function(d) {
          d3.select(this)
            .classed("selected", true)
            .classed("hidden", false)
            .classed("visible", true);
          self.showTooltip(d.x, d.y, d.tt);
          } )
        .on("mouseout", function(d) {
          d3.select(this)
            .classed("selected", false)
            .classed("hidden", function(d) { return d.isLinked; })
            .classed("visible", false);
          self.clearTooltip();
        } )

      sbranch
        .each( function(d, i) {
          d.drawArrowhead(d3.select(this), i).lower();
        } );
    });
    // draw labels
    branch.append('text')
      .text( function(d) { return d.label } )
      .attr("font-family", "sans-serif")
      .attr("font-size", "20px")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .style("cursor", "pointer")
      .classed("noselect", true)
      .lower();

    // draw nodes (delegation & strategy)
    return branch
      .append("g")
      .lower()
      .each( function(d, i) {
        d.draw(d3.select(this), i).lower();
      });
  }
  drawAll() {
    // clear all nodes
    if (self.draggable) self.draggable.remove();

    // prepare node groups
    self.draggable = self.nodeGroup.selectAll("g")
      .data(self.graphData.getGraphicsNodeObjs())
      .enter()
      .append("g")
      .call( d3.drag()
        .filter( function() { return d3.event.button == 0 && !d3.event.ctrlKey; })
        .on("start", self.dragstarted)
        .on("drag", self.dragged)
        .on("end", self.dragended)
      )
      .on("contextmenu", function () { /*console.log("contextmenu");*/ d3.event.preventDefault(); })
      .on("click", function () {
        let node = d3.select(this).datum();
        d3.event.stopPropagation();
        if (d3.event.ctrlKey) {
          self.delNodeCB( node );
        }
        else {
          self.graphData.setSelectedNode(node.owner.id);
          self.selectNodeCB( node );
          self.update();
        }
      })
      .on("dblclick", function() {
        let node = d3.select(this).datum();
        self.executeNodeCB(node);
      })
      .on("mousedown", function(d) {
        self.nodeMouseDownCB(d);
        self.dragNode = d;
        //self.h = new LinkHelper(self.svg, self.linkHelperBranch, [d.x, d.y], function() { self.h = null; }.bind(self) );
      })
      .on("mouseup", function(d) {
        let n = self.dragNode;
        if (n == null || n == d) return;
        self.mouseAddLinkCB(n.centerAnchor, d.centerAnchor);
      });

    self.nodes = GraphDraw.drawNodes(self.draggable);

    // draw the splines
    let links = self.graphData.getLinkObjs();

    if (self.splines) self.splines.remove();
    self.splines = self.splineGroup.selectAll("g")
      .data(links)
      .enter()
      .append("g");

    self.splines
      .each( function(l, i) {
        l.draw(d3.select(this), i);
      });

    /*
    // DEBUG draw anchors
    let anchors = self.graphData.getAnchors();
    if (self.anchors) self.anchors.remove();
    self.anchors = self.linkGroup.selectAll("circle")
      .data(anchors)
      .enter()
      .append("circle")
      .attr("cx", function(d) { return d.x; })
      .attr("cy", function(d) { return d.y; })
      .attr("r", 5)
      .attr("fill", "black");
    */

    // call draw callbacks
    self._callDrawListeners();

    // recenter everything
    self.recenter();
    // update data properties
    self.update();
  }
}

/*
* Custom Node types (IFL specific)
*/
class NodeIData extends NodeObject {
  static get basetype() { return "object_idata"; }
  get basetype() { return NodeIData.basetype; }
  static get prefix() { return "id"; }

  constructor(x, y, id, name, label, typeconf) {
    super(x, y, id, name, label, typeconf, 'IData');
  }
  _getGNType() {
    return GraphicsNodeFluffyPad;
  }
  isActive() {
    // assumed to be associated with an underlying function object
    let b1 = this.plotdata && true;
    let b2 = this.obj != null;
    return b1 || b2
  }
}

class NodeIFunc extends NodeObject {
  static get basetype() { return "object_ifunc"; }
  get basetype() { return NodeIFunc.basetype; }
  static get prefix() { return "if"; }
  constructor(x, y, id, name, label, typeconf) {
    super(x, y, id, name, label, typeconf, 'IFunc');
  }
  _getGNType() {
    return GraphicsNodeCircularPad;
  }
  isActive()  {
    return this.userdata != null
  }
}

function wrap_ajax_validation_ids(gs_id, tab_id) {
  // GraphInterface utility function
  return { "gs_id" : gs_id, "tab_id" : tab_id };
}
function simpleajax(url, data, gs_id, tab_id, success_cb, fail_cb=null, showfail=true) {
  // GraphInterface utility function
  let isalive = true;
  $.ajax({
    type: "POST",
    url: url,
    data: { "gs_id": gs_id, "tab_id": tab_id, "data_str" : JSON.stringify(data) },
  })
  .fail(function(xhr, statusText, errorThrown) {
    if (!showfail) return
    if (fail_cb) fail_cb();
    $("body").css("cursor", "default");
    $(window.open().document.body).html(errorThrown + xhr.status + xhr.responseText);
  })
  .success(function(msg) {
    // parse & json errors
    let obj = null;
    try {
      obj = JSON.parse(msg);
    }
    catch(error) {
      console.log("JSON.parse error on string: ", msg);
      alert("uncomprehensible server response: ", msg);
      throw error;
    }

    // fatal errors
    let fatalerror = obj["fatalerror"];
    if (fatalerror) {
      isalive = false;
      alert("Please restart the session. Fatal error: " + fatalerror);
      //location.reload();
      close();
    }

    // timeouts
    let timeout = obj["timeout"];
    if (timeout) {
      alert("timeout: " + timeout);
    }

    // pass it on
    success_cb(obj)
  });
  return isalive;
}

class GraphInterface {
  /*
  *  High-level graph data and drawing interface. Use to manipulate the graph,
  *  and to save and load it. If used appropriately, this enables undo/redo.
  */
  constructor(gs_id, tab_id, conn_rules) {
    this.gs_id = gs_id;
    this.tab_id = tab_id;
    this.isalive = true;

    this.graphData = new GraphTree(conn_rules);
    let linkCB = this._tryCreateLink.bind(this);
    let delNodeCB = this._delNodeAndLinks.bind(this);
    let selNodeCB = this._selNodeCB.bind(this);
    let dblclickNodeCB = this._dblclickNodeCB.bind(this);
    let createNodeCB = this._createNodeCB.bind(this);
    let nodeMouseDownCB = this._nodeMouseDownCB.bind(this);
    this.draw = new GraphDraw(this.graphData, linkCB, delNodeCB, selNodeCB, dblclickNodeCB, createNodeCB, nodeMouseDownCB);
    this.truth = ConnectionRulesIfl;

    // id, node dict,for high-level nodes
    this.nodes = {};
    // create-node id uniqueness counter - dict'ed by key 'basetype prefix'
    this.idxs = {};

    // undo-redo stack
    this.undoredo = new UndoRedoCommandStack();

    // event listeners
    this._updateUiListn = [];
    this._nodeSelectionListn = [];
    this._nodeCreateListn = [];
    this._nodeDeletedListn = [];
    this._nodeDataUpdateListn = [];
    this._nodeMouseDownListn = [];

    // locks all undoable commands, and also a few others (js is single-threaded in most cases)
    this.locked = false;

    // node create conf pointer
    this._createConf = null;

    // error node
    this._errorNode = null;
  }
  //
  // listener & event interface
  //
  addNodeCreateListener(listener, rmfunc=null) {
    if (listener) this._nodeCreateListn.push([listener, rmfunc]);
  }
  addNodeDeletedListener(listener, rmfunc=null) {
    if (listener) this._nodeDeletedListn.push([listener, rmfunc]);
  }
  addNodeDataUpdateListener(listener, rmfunc=null) {
    if (listener) this._nodeDataUpdateListn.push([listener, rmfunc]);
  }
  addUiUpdateListener(listener, rmfunc=null) {
    if (listener) this._updateUiListn.push([listener, rmfunc]);
  }
  addNodeSelectionListener(listener, rmfunc=null) {
    if (listener) this._nodeSelectionListn.push([listener, rmfunc]);
  }
  addNodeMouseDownListn(listener, rmfunc=null) {
    if (listener) this._nodeMouseDownListn.push([listener, rmfunc]);
  }
  _selNodeCB(node) {
    let n = null;
    if (node) n = node.owner;
    this._fireEvents(this._nodeSelectionListn, [n]);
  }
  _createNodeCB(x, y) {
    let conf = this._createConf;
    if (conf == null) return;

    let id = this.node_add(x, y, "", "", conf.label, conf.address);
    this.draw.resetChargeSim();
    this.draw.restartCollideSim();

    this._createConf = null;

    // update
    this._fireEvents(this._nodeCreateListn, [id]);
    this.updateUi();
  }
  _dblclickNodeCB(gNode) {
    this.run(gNode.owner.id);
  }
  _delNodeAndLinks(n) {
    // link rm's (cleanup before node rm)
    let id = n.owner.id;
    let lnk_cmds = this.graphData.getLinks(id);
    let cmd = null;
    for (var i=0; i<lnk_cmds.length; i++) {
      cmd = lnk_cmds[i];
      this.link_rm(cmd[0], cmd[1], cmd[2], cmd[3]);
    }
    // node rm
    this.node_rm(id);

    // update
    this._fireEvents(this._nodeDeletedListn, [id]);
    this.draw.restartCollideSim();
    this.updateUi();
  }
  _nodeMouseDownCB(gNode) {
    let n = gNode.owner;
    this._fireEvents(this._nodeMouseDownListn, [n]);
  }
  _fireEvents(lst, args=[]) {
    for (var i=0; i<lst.length; i++) {
      let l = lst[i];
      if (args.length==0) l[0](args[0]);
      if (args.length==1) l[0](args[0], args[1]);
      if (args.length==2) l[0](args[0], args[1], args[2]);
      if (args.length==3) l[0](args[0], args[1], args[2], args[3]);
      if (args.length==4) l[0](args[0], args[1], args[2], args[3], args[4]);
      // remove this element if rmfunc returns true (optional)
      if (l[1]) if (l[1]()) remove(lst, l);
    }
  }
  _tryCreateLink(s, d) {
    let createLink = function(a1, a2) {
      this.link_add(a1.owner.owner.id, a1.idx, a2.owner.owner.id, a2.idx);
      this.draw.resetAndRestartPathSim(a1.owner.owner.id);
      this.draw.resetAndRestartPathSim(a2.owner.owner.id);
      this.updateUi();
    }.bind(this);

    let clearThenCreateLink = function(a1, a2) {
      let id = a2.owner.owner.id;
      let lks = this.graphData.getLinks(id);
      let entry = null;
      for (let i=0;i<lks.length;i++) {
        entry = lks[i];
        if (entry[2] == id && entry[1] == a1.idx && entry[3] == a2.idx) {
          this.link_rm(entry[0], entry[1], entry[2], entry[3])
          createLink(a1, a2);
        }
      }
    }.bind(this);

    if (this.truth.canConnect(s, d)) {
      createLink(s, d);
    }
    else if (this.truth.canConnect(d, s)) {
      createLink(d, s);
    }
    // override existing link IF it could be connected
    else if (this.truth.couldConnect(s, d)) {
      clearThenCreateLink(s, d);
    }
    else if (this.truth.couldConnect(d, s)) {
      clearThenCreateLink(d, s);
    }
  }
  _getId(prefix) {
    // used by high-level node constructors, who take only a node conf
    let id = null;
    if (prefix in this.idxs)
      id = prefix + (this.idxs[prefix] += 1);
    else
      id = prefix + (this.idxs[prefix] = 0);
    while (id in this.nodes) {
      if (prefix in this.idxs)
        id = prefix + (this.idxs[prefix] += 1);
      else
        id = prefix + (this.idxs[prefix] = 0);
    }
    return id;
  }
  //
  // server communication stubs
  //
  ajaxcall(url, data, success_cb, fail_cb=null) {
    this.isalive = simpleajax(url, data, this.gs_id, this.tab_id, success_cb, fail_cb, true);
  }
  ajaxcall_noerror(url, data, success_cb) {
    // call with showfail=false, which turns off django and offline fails
    this.isalive = simpleajax(url, data, this.gs_id, this.tab_id, success_cb, null, false);
  }
  //
  // utility interface
  //
  setCreateNodeConf(conf) {
    this._createConf = cloneConf(conf);
  }
  getSelectedNode() {
    return this.graphData.getSelectedNode();
  }
  pushSelectedNodeLabel(text) {
    this.node_label(this.graphData.getSelectedNode().id, text);
  }
  pushSelectedNodeData(json_txt) {
    this.node_data(this.graphData.getSelectedNode().id, json_txt);
  }
  reset() {
    let lst = this.graphData.getGraphicsNodeObjs();
    for (var i=0;i<lst.length;i++) {
      this._delNodeAndLinks(lst[i]);
    }
    this.updateUi();
  }
  updateUi() {
    this.draw.drawAll();
    this._fireEvents(this._updateUiListn, [this.graphData.getSelectedNode()]);
  }
  injectGraphDefinition(def) {
    let args = null;
    for (let key in def.nodes) {
      args = def.nodes[key];
      try {
        this.node_add(args[0], args[1], args[2], args[3], args[4], args[5]);
      }
      catch(error) {
        console.log("inject node add: ", error.message);
      }
    }
    let data = null;
    let elinks = null;
    for (let key in def.links) {
      elinks = def.links[key];
      for (var j=0;j<elinks.length;j++) {
        args = elinks[j];
        try {
          this.link_add(args[0], args[1], args[2], args[3], args[4]);
        }
        catch(error) {
          console.log("inject link add: ", error.message);
        }
      }
    }
    for (let key in def.datas) {
      data = atob(def.datas[key]);
      try {
        this.node_data(key, data);
      }
      catch(error) {
        console.log("inject set data error: ", error.message);
      }
    }
    this.undoredo.resetSync();
    this.updateUi();
  }
  printUndoRedoStack() {
    let lst = this.undoredo.ur;
    //console.log(JSON.stringify(lst, null, 2));
    console.log(JSON.stringify(lst));
  }
  graph_update(update) {
    // should be called using an update set to adjust the graph
    for (let key in update) {
      let obj = update[key];
      let m = this.graphData.getNode(key);
      if (obj != null) {
        this.node_data(key, JSON.stringify(obj.userdata));
      }
      else {
        this.node_data(key, "null");
      }
      m.obj = obj; // (re)set all data
      this.undoredo.incSyncByOne(); // this to avoid re-setting already existing server state
      this.graphData.updateNodeState(m);
      this._fireEvents(this._nodeDataUpdateListn, [m]);
    }
    this.updateUi();
  }
  //
  // graph manipulation interface
  //
  undo() {
    if (this.lock == true) { console.log("undo call during lock"); return -1; }
    let cmd = this.undoredo.undo();
    if (cmd) {
      this._command(cmd);
      this.updateUi();
    }
  }
  redo() {
    if (this.lock == true) { console.log("redo call during lock"); return -1; }
    let cmd = this.undoredo.redo();
    if (cmd) {
      this._command(cmd);
      this.updateUi();
    }
  }
  node_add(x, y, id, name, label, addr) {
    // int, int, str, str, str, str
    if (this.lock == true) { console.log("node_add call during lock"); return -1; }
    let cmd_rev = this._command(["node_add", x, y, id, name, label, addr]);
    if (cmd_rev) {
      this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
      return cmd_rev[0][2];
    }
  }
  node_rm(id) {
    // str
    if (this.lock == true) { console.log("node_rm call during lock"); return -1; }
    let cmd_rev = this._command(["node_rm", id]);
    if (cmd_rev) this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
  }
  node_label(id, label) {
    // str, str
    if (this.lock == true) { console.log("node_label call during lock"); return -1; }
    let cmd_rev = this._command(["node_label", id, label]);
    if (cmd_rev) this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
  }
  node_data(id, data) {
    // str, str
    if (this.lock == true) { console.log("node_data call during lock"); return -1; }
    let cmd_rev = this._command(["node_data", id, data]);
    if (cmd_rev) this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
  }
  link_add(id1, idx1, id2, idx2) {
    // str, int, str, int, int
    if (this.lock == true) { console.log("link_add call during lock"); return -1; }
    let cmd_rev = this._command(["link_add", id1, idx1, id2, idx2]);
    if (cmd_rev) this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
  }
  link_rm(id1, idx1, id2, idx2) {
    // str, int, str, int, int
    if (this.lock == true) { console.log("link_rm call during lock"); return -1; }
    let cmd_rev = this._command(["link_rm", id1, idx1, id2, idx2]);
    if (cmd_rev) this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
  }
  _command(cmd) {
    // impl. graph manipulation commands
    let args = cmd.slice(1);
    let command = cmd[0];
    if (command=="node_add") {
      let x = args[0];
      let y = args[1];
      let id = args[2];
      let name = args[3];
      let label = args[4]
      let address = args[5];

      let conf = nodeTypeRead(address);
      conf.name = name;
      conf.label = label;

      id = this.graphData.nodeAdd(x, y, conf, id);
      let n = this.graphData.getNode(id);
      // do we need this call?
      this.draw.resetChargeSim();
      return [["node_add", n.gNode.x, n.gNode.y, n.id, n.name, n.label, n.address], ["node_rm", n.id]];
    }
    else if (command=="node_rm") {
      let id = args[0];

      let n = this.graphData.getNode(id);
      if (!n) throw "invalid node_rm: node not found (by id)";

      if (this.graphData.nodeRm(id)) {
        let na_cmd = ["node_add", n.gNode.x, n.gNode.y, id, n.name, n.label, n.address];
        return [["node_rm", id], na_cmd];
      }
    }
    else if (command=="link_add") {
      let id1 = args[0];
      let idx1 = args[1];
      let id2 = args[2];
      let idx2 = args[3];

      if (this.graphData.linkAdd(id1, idx1, id2, idx2)) {
        return [["link_add"].concat(args), ["link_rm"].concat(args)];
      }
    }
    else if (command=="link_rm") {
      let id1 = args[0];
      let idx1 = args[1];
      let id2 = args[2];
      let idx2 = args[3];

      if (this.graphData.linkRm(id1, idx1, id2, idx2)) {
        return [["link_rm"].concat(args), ["link_add"].concat(args)];
      }
    }
    else if (command=="node_label") {
      let id = args[0];
      let label = args[1];

      let n = this.graphData.getNode(id);
      if (!n) return null;
      let prevlbl = n.label;
      if (this.graphData.nodeLabel(id, label)) {
          this.updateUi();
          return [["node_label", id, label], ["node_label", id, prevlbl]];
      }
    }
    else if (command=="node_data") {
      if (!isString(args[1])) {
        throw "node_data: args[1] must be a string: ", args;
      }
      let id = args[0];
      let data_str = args[1];

      let n = this.graphData.getNode(id);
      let prevdata_str = JSON.stringify(n.userdata);

      if (this.graphData.nodeData(id, data_str)) {
        this.updateUi();
        return [["node_data", id, data_str], ["node_data", id, prevdata_str]];
      }
    }
    else throw "unknown command value";
  }
}


class UndoRedoCommandStack {
  constructor(maxSize=5000) {
    this.synced = null; // last synced idx
    this.idx = -1; // undo stack index
    this.ur = []; // undo-redo stack
    this.limit = maxSize; // stack maximum size
    this.buffer = []; // sync-set buffer for data otherwise lost by the sequence "sync -> undo -> undo -> newdo -> sync"
  }
  undo() {
    if (this.idx >= 0) {
      return this.ur[this.idx--][1];
    }
  }
  redo() {
    if (this.idx < this.ur.length-1) {
      return this.ur[++this.idx][0];
    }
  }
  newdo(doCmd, undoCmd) {
    if (this.ur.length == this.limit) {
      this.ur.splice(0, 1); // delete first entry and re-index
      this.idx -= 1;
      if (this.synced) this.synced = Math.max(0, this.synced-1);
    }
    if (this.idx < this.synced) { // buffer lost undo history
      this.buffer = this.buffer.concat(this._getSyncSetNoBuffer());
    }
    this.idx += 1;
    this.ur.splice(this.idx);
    this.ur.push([doCmd, undoCmd]);
    return [doCmd, undoCmd];
  }
  getSyncSet() {
    let ss = this.buffer.concat(this._getSyncSetNoBuffer());
    this.buffer = [];
    return ss;
  }
  incSyncByOne() {
    this.synced += 1;
  }
  resetSync() {
    this.synced = this.idx+1;
  }
  _getSyncSetNoBuffer() {
    // init synced variable
    if (!this.synced) {
      if (this.ur.length == 0) return [];
      this.synced = 0;
    }
    // negative/reversed or empty sync set
    if (this.synced > this.idx) {
      let ss = this.ur.slice(this.idx+1, this.synced);
      this.synced = this.idx+1;
      return ss.map(x => x[1]).reverse();
    }
    // positive sync set
    else {
      let ss = this.ur.slice(this.synced, this.idx+1);
      this.synced = this.idx+1;
      return ss.map(x => x[0]);
    }
  }
}

class NodeTypeMenu {
  // a single-column node creation menu ui
  constructor(selectConfCB, rootelementid, branchname) {
    this.menus = [];
    this.root = d3.select("#"+rootelementid);
    this.selectConfCB = selectConfCB;

    this.root
      .append("div")
      .attr("style","background-color:white;font-size:small;text-align:center;")
      .html(branchname.toUpperCase());

    let address = null;
    let conf = null;
    let c = null;
    for (var i=0; i<nodeAddresses.length; i++) {
      address = nodeAddresses[i];
      if (address.split('.')[0] == branchname) {
        conf = nodeTypeRead(address);
        c = cloneConf(conf);
        this.createMenuItem(c);
      }
    }
    // this draws a line under the lat menu item, which would otherwise be clipped by the container
    this.root
      .append("div")
      .classed("menuItem", true);
  }
  // single-read getter
  get selectedConf() {
    let ans = this._selectedConf;
    this._selectedConf = null;
    return ans;
  }
  createMenuItem(conf) {
    // the lbl set-reset hack here is to get the right labels everywhere in a convoluted way...
    let lbl = conf.label;
    conf.label = conf.type;
    let n = NodeTypeHelper.createNode(50, 50, "", conf);
    conf.label = lbl;

    let branch = this.root
      .append("div")
      .style('width', "100px")
      .style('height', "100px")
      .classed("menuItem", true)
      .append("svg")
      .attr("style", "background-color:white;")
      .attr("width", 100)
      .attr("height", 100)
      .datum(conf)
      .on("click", function(d) { this.selectConfCB(d); }.bind(this) )
      .append("g")
      .datum(n.gNode)
      .attr("transform", "translate(50, 60)");

    this.drawMenuNode(branch);
    this.menus.push(branch);
  }
  drawMenuNode(branch) {
    branch.each( function(d, i) {
      let sbranch = d3.select(this)
        .append("g")
        .selectAll("circle")
        .data(d.anchors)
        .enter()
        .append("g");
      sbranch
        .append("circle")
        .attr('r', anchorRadius)
        // semi-static transform, which does not belong in update()
        .attr("transform", function(p) { return "translate(" + p.localx + "," + p.localy + ")" } )
        .style("fill", "white")
        .style("stroke", "#000")
      /* how should we draw the types?
      sbranch
        .text( function(d) { return d.label } )
        .attr("font-family", "sans-serif")
        .attr("font-size", "20px")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
      */
    });
    // draw labels
    branch.append('text')
      .text( function(d) { return d.label } )
      .attr("font-family", "sans-serif")
      .attr("font-size", "10px")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("transform", "translate(0, -45)" )
      .classed("noselect", true)
      .lower();

    // draw nodes (by delegation & strategy)
    return branch
      .append("g")
      .lower()
      .each( function(d, i) {
        d.draw(d3.select(this), i).lower();
      });
  }
}
