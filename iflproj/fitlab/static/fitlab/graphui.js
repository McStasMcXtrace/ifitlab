/*
* A nodespeak compatible graph ui using d3.js for drawing and force layouts.
*
* Written by Jakob Garde 2017-2018.
*/

const width = 790;
const height = 700;
const nodeRadius = 30;
const anchorRadius = 6;

const extensionLength = 40;
const anchSpace = 40;
const pathChargeStrength = -10;
const pathLinkStrength = 1;
const distance = 20;

const arrowHeadLength = 12;
const arrowHeadAngle = 25;

//
// convenience functions
//
function remove(lst, element) {
  let index = lst.indexOf(element);
  if (index > -1) {
    lst.splice(index, 1);
  }
}
function simpleajax(url, d, success_cb, fail_cb=null) {
  return $.ajax({
    type: 'POST',
    url: url,
    data: d,
  })
  .fail(function(xhr, statusText, errorThrown) {
    if (fail_cb) fail_cb();
    $(window.open().document.body).html(errorThrown + xhr.status + xhr.responseText);
  })
  .success(success_cb);
}
function isString(value) {
  let b1 = (typeof value === 'string' || value instanceof String);
  return b1;
}

//
// Type config tree
//
// this function reads and returns an item from a TreeJsonAddr, given a dot-address
function nodeTypeRead(address) {
  let branch = nodeTypes;
  let splt = address.split('.');
  let key = splt[splt.length-1];
  try {
    for (let i=0;i<splt.length-1;i++) {
      branch = branch[splt[i]]['branch'];
    }
    let item = branch[key]["leaf"];
    return item;
  }
  catch(err) {
    throw "no item found at address: " + address;
  }
}
function cloneConf(conf) {
  return Object.assign({}, conf);
}

//
// GraphicsNode related
//
NodeIconType = {
  CIRCE : 0,
  CIRCLEPAD : 1,
  SQUARE : 2,
  FLUFFY : 3,
  FLUFFYPAD : 4,
  HEXAGONAL : 5,
}
NodeState = {
  DISCONNECTED : 0,
  PASSIVE : 1,
  ACTIVE : 2,
  RUNNING : 3,
  FAIL : 4,
}
function getNodeStateClass(state) {
  if (state==NodeState.DISCONNECTED) return "disconnected";
  else if (state==NodeState.PASSIVE) return "passive";
  else if (state==NodeState.ACTIVE) return "active";
  else if (state==NodeState.RUNNING) return "running";
  else if (state==NodeState.FAIL) return "fail";
  else throw "invalid value"
}

// type supplying graphical data
class GraphicsNode {
  // graphical base type - this will not draw itself on the screen
  constructor(owner, label, x, y) {
    this.owner = owner;
    this.label = label;
    this.x = x;
    this.y = y;

    this.anchors = null;
    this.r = nodeRadius;
    this.centerAnchor = new CenterAnchor(this);

    // graphics switch on this property, which is updated externally according to some rule
    this.state = NodeState.DISCONNECTED;
    this.active = false;

    this.colour = "";
  }
  setAnchors(anchors) {
    if (this.anchors) throw "anchors only intended to be set once";
    this.anchors = anchors;
  }
  // level means itypes/otypes == 0/1
  getAnchor(idx, level) {
    let a = null;
    for (var i=0;i<this.anchors.length;i++) {
      a = this.anchors[i];
      if (a.idx==idx && (!a.i_o | 0) == level)
        return a;
    }
    throw "could not get anchor: ", idx, level;
  }
  draw(branch, i) {
    return branch
      .attr('stroke', "black")
      //.style("fill", function() { return this.colour; }.bind(this))
      .classed(getNodeStateClass(this.state), true)
  }
  // hooks for higher level nodes
  onConnect(link, isInput) {}
  onDisconnect(link, isInput) {}
  setOutputAncorTypes(ats) {
    let anchors = this.anchors;
    let a = null;
    for (var j=0;j<anchors.filter(a => !a.i_o).length;j++) {
      a = anchors[j];
      if (a.i_o==false) {
        a.type = ats[j];
      }
    }
  }
}

class GraphicsNodeCircular extends GraphicsNode {
  constructor(owner, label, x, y) {
    super(owner, label, x, y);
  }
  draw(branch, i) {
    branch = super.draw(branch, i);
    return branch
      .append('circle')
      .attr('r', function(d) { return d.r; })
  }
}

class GraphicsNodeCircularPad extends GraphicsNode {
  constructor(owner, label, x, y) {
    super(owner, label, x, y);
  }
  draw(branch, i) {
    branch = super.draw(branch, i);
    branch
      .append('circle')
      .attr('r', 0.85*this.r)
      .attr('stroke', "black")
      .attr('fill', "none")
      .lower()
    branch
      .append('circle')
      .attr('r', this.r)
      .attr('stroke', "black")
      .lower()
    return branch;
  }
}

class GraphicsNodeSquare extends GraphicsNode {
  constructor(owner, label, x, y) {
    super(owner, label, x, y);
    this.r = 0.85 * nodeRadius; // this is now the half height/width of the square
  }
  draw(branch, i) {
    branch = super.draw(branch, i);
    return branch
      .append("g")
      .lower()
      .append('rect')
      .attr('width', function(d) { return 2*d.r; })
      .attr('height', function(d) { return 2*d.r; })
      .attr('x', function(d) { return -d.r; })
      .attr('y', function(d) { return -d.r; })
  }
}

class GraphicsNodeHexagonal extends GraphicsNode {
  constructor(owner, label, x, y) {
    super(owner, label, x, y);
    this.r = 1.05 * nodeRadius;
  }
  draw(branch, i) {
    let r = 1.1 * this.r;
    let alpha;
    let points = [];
    for (i=0; i<6; i++) {
      alpha = i*Math.PI*2/6;
      points.push( {x : r*Math.cos(alpha), y : - r*Math.sin(alpha) } );
    }
    points.push(points[0]);

    branch = super.draw(branch, i);
    return branch
      .append('path')
      .datum(points)
      .attr('d', d3.line()
        .x( function(p) { return p.x; } )
        .y( function(p) { return p.y; } )
      );
  }
}

class GraphicsNodeFluffy extends GraphicsNode {
  constructor(owner, label, x, y) {
    super(owner, label, x, y);
    this.numfluff = 14;
    this.fluffrad = 7;
    this.r = 1.05 * nodeRadius;
  }
  draw(branch, i) {
    let r = 0.80 * this.r;
    let alpha;
    let points = [];
    for (let j=0; j<this.numfluff; j++) {
      alpha = j*Math.PI*2/this.numfluff;
      points.push( {x : r*Math.cos(alpha), y : - r*Math.sin(alpha) } );
    }
    branch = super.draw(branch, i);
    branch.append("g").lower()
      .append('circle')
      .attr('r', r)
      .attr("stroke", "none")
      .lower();
    branch.append("g").lower()
      .selectAll("circle")
      .data(points)
      .enter()
      .append("circle")
      .attr('r', this.fluffrad)
      .attr("transform", function(p) { return "translate(" + p.x + "," + p.y + ")" } );

    return branch;
  }
}

class GraphicsNodeFluffyPad extends GraphicsNode {
  constructor(owner, label, x, y) {
    super(owner, label, x, y);
    this.numfluff = 8;
    this.fluffrad = 13;
  }
  draw(branch, i) {
    branch = super.draw(branch, i);
    branch
      .append('circle')
      .attr('r', 0.9*this.r);

    let r = 0.7 * this.r;
    let alpha;
    let points = [];
    for (let j=0; j<this.numfluff; j++) {
      alpha = j*Math.PI*2/this.numfluff;
      points.push( {x : r*Math.cos(alpha), y : - r*Math.sin(alpha) } );
    }

    branch.append("g").lower()
      .append('circle')
      .attr('r', r)
      .attr("stroke", "none")
      .lower();
    branch.append("g").lower()
      .selectAll("circle")
      .data(points)
      .enter()
      .append("circle")
      .attr('r', this.fluffrad)
      .attr("transform", function(p) { return "translate(" + p.x + "," + p.y + ")" } );

    return branch;
  }
}

// connection anchor point fixed on a node at a circular periphery
class Anchor {
  constructor(owner, angle, type, parname, i_o, idx) {
    this.owner = owner;
    this.angle = angle;
    this.type = type;
    this.parname = parname;

    this.vx = 0;
    this.vy = 0;
    this.r = 3;
    this.localx = null;
    this.localy = null;

    this.ext = null;

    this.arrowHead = null;
    this.i_o = i_o;
    this.idx = idx;
    this.numconnections = 0;
  }
  get isLinked() {
    return this.numconnections > 0;
  }
  get isTarget() {
    return (this.i_o == true) && (this.numconnections > 0);
  }
  get tt() {
    let parname = this.parname;
    if (!parname) parname = '';
    return parname + "(" + this.type + ")";
  }
  get x() { return this.owner.x + this.localx; }
  set x(value) { /* empty:)) */ }
  get y() { return this.owner.y + this.localy; }
  set y(value) { /* empty:)) */ }
  drawArrowhead(branch, i) {
    if (!this.isTarget) return branch;

    let angle1 = Math.PI/180*(this.angle - arrowHeadAngle);
    let angle2 = Math.PI/180*(this.angle + arrowHeadAngle);
    let x0 = this.localx;
    let y0 = this.localy;
    let x1 = x0 + arrowHeadLength*Math.cos(angle1);
    let y1 = y0 - arrowHeadLength*Math.sin(angle1);
    let x2 = x0 + arrowHeadLength*Math.cos(angle2);
    let y2 = y0 - arrowHeadLength*Math.sin(angle2);
    let points = [{x:x1,y:y1}, {x:x0,y:y0}, {x:x2,y:y2}];

    this.arrowHead = branch.append("path")
      .datum(points)
      .classed("arrow", true)
      .attr('d', d3.line()
        .x( function(p) { return p.x; } )
        .y( function(p) { return p.y; } )
      );
    return this.arrowHead;
  }
}

class AnchorCircular extends Anchor {
  constructor(owner, angle, type, parname, i_o, idx) {
    super(owner, angle, type, parname, i_o, idx);
    this.localx = owner.r * Math.cos(this.angle/360*2*Math.PI);
    this.localy = - this.owner.r * Math.sin(this.angle/360*2*Math.PI); // svg inverted y-axis

    let ext_localx = (owner.r + extensionLength) * Math.cos(this.angle/360*2*Math.PI);
    let ext_localy = - (this.owner.r + extensionLength) * Math.sin(this.angle/360*2*Math.PI); // svg inverted y-axis
    this.ext = new ExtensionAnchor(owner, ext_localx, ext_localy);
  }
}

class AnchorSquare extends Anchor {
  constructor(owner, angle, type, parname, i_o, idx) {
    super(owner, angle, type, parname, i_o, idx);
    this.localx = owner.r * Math.cos(this.angle/360*2*Math.PI);
    this.localy = - this.owner.r * Math.sin(this.angle/360*2*Math.PI); // svg inverted y-axis

    // TODO: angle = angle modulus 360 and shift to positive
    if (0 <= angle && angle < 360/8) {
      this.localx = owner.r;
      this.localy = -owner.r * Math.tan(angle/180*Math.PI);
    }
    else if (360/8 <= angle && angle < 3*360/8) {
      //this.localx = owner.r * Math.cos(angle/180*Math.PI);
      this.localx = -owner.r * Math.tan(angle/180*Math.PI - Math.PI/2);
      this.localy = -owner.r;
    }
    else if (3*360/8 <= angle && angle < 5*360/8) {
      this.localx = -owner.r;
      this.localy = owner.r * Math.tan(angle/180*Math.PI - Math.PI);
    }
    else if (5*360/8 <= angle && angle < 7*360/8) {
      this.localx = owner.r * Math.tan(angle/180*Math.PI - 3*Math.PI/2);
      this.localy = owner.r;
    }
    else if (7*360/8 <= angle && angle < 360) {
      this.localx = owner.r;
      this.localy = -owner.r * Math.tan(angle/180*Math.PI);
    }

    let ext_localx = this.localx + this.localx/owner.r * extensionLength;
    let ext_localy = this.localy + this.localy/owner.r * extensionLength;
    this.ext = new ExtensionAnchor(owner, ext_localx, ext_localy);
  }
}

// a "path helper" radial extension to Anchor
class ExtensionAnchor {
  constructor(owner, localx, localy) {
    this.owner = owner; // this is the node, not the anchor
    this.vx = 0;
    this.vy = 0;
    this.localx = localx;
    this.localy = localy;
  }
  get x() { return this.owner.x + this.localx; }
  set x(value) { /* empty:)) */ }
  get y() { return this.owner.y + this.localy; }
  set y(value) { /* empty:)) */ }
}

// path helper node type
class PathAnchor {
  constructor(x, y, owner) {
    this.owner = owner; // this must be a link object
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
  }
}

// placed at Node centers, used to provide a static charge for path layout simulations
class CenterAnchor {
  constructor(owner) {
    this.owner = owner;
    this.x = 0;
    this.y = 0
    this.vx = 0;
    this.vy = 0;
  }
  get x() { return new Number(this.owner.x); }
  set x(value) { /* empty:)) */ }
  get y() { return new Number(this.owner.y); }
  set y(value) { /* empty:)) */ }
}

// link data type
class Link {
  constructor(d1, d2) {
    this.d1 = d1;
    this.d2 = d2;
    this.pathAnchors = [];
    this.recalcPathAnchors();

    d1.numconnections += 1;
    d2.numconnections += 1;
  }
  recalcPathAnchors() {
    this.pathAnchors = [];
    let x1 = this.d1.ext.x;
    let y1 = this.d1.ext.y;
    let x2 = this.d2.ext.x;
    let y2 = this.d2.ext.y;

    let distx = Math.abs(x1 - x2);
    let disty = Math.abs(y1 - y2);
    let len = Math.sqrt( distx*distx + disty*disty );
    let xScale = d3.scaleLinear()
      .domain([0, len])
      .range([x1, x2]);
    let yScale = d3.scaleLinear()
      .domain([0, len])
      .range([y1, y2]);
    let na = Math.floor(len/anchSpace) - 1;
    let space = len/na;
    for (let i=1; i <= na; i++) {
      this.pathAnchors.push( new PathAnchor(xScale(i*space), yScale(i*space), this) );
    }
  }
  length() {
    let dx = d2.x - d1.x;
    let dy = d2.y - d1.y;
    return Math.sqrt(dx*dx + dy*dy);
  }
  getAnchors() {
    let result = [this.d1, this.d1.ext].concat(this.pathAnchors);
    result.push(this.d2.ext);
    result.push(this.d2);
    return result;
  }
  detatch() {
    this.d1.numconnections -= 1;
    this.d2.numconnections -= 1;
  }
}

class LinkSingle extends Link {
  constructor(d1, d2) {
    super(d1, d2);
  }
  draw(branch, i) {
    let anchors = this.getAnchors();
    return branch
      .append('path')
      .datum(anchors)
      .attr("class", "arrow")
      .attr('d', d3.line()
        .curve(d3.curveBasis)
        .x( function(p) { return p.x; } )
        .y( function(p) { return p.y; } )
      );
  }
  update(branch, i) {
    let anchors = this.getAnchors();
    return branch
      .select('path')
      .datum(anchors)
      .attr('d', d3.line()
        .curve(d3.curveBasis)
        .x( function(p) { return p.x; } )
        .y( function(p) { return p.y; } )
      );
  }
}

class LinkDouble extends Link {
  constructor(d1, d2) {
    super(d1, d2);
  }
  draw(branch, i) {
    let anchors = this.getAnchors();
    branch
      .append('path')
      .datum(anchors)
      .attr("class", "arrowThick")
      .attr('d', d3.line()
        .curve(d3.curveBasis)
        .x( function(p) { return p.x; } )
        .y( function(p) { return p.y; } )
      );
    branch
      .append('path')
      .datum(anchors)
      .attr("class", "arrowThin")
      .attr('d', d3.line()
        .curve(d3.curveBasis)
        .x( function(p) { return p.x; } )
        .y( function(p) { return p.y; } )
      );
    return branch;
  }
  update(branch, i) {
    let anchors = this.getAnchors();
    branch
      .select('path')
      .datum(anchors)
      .attr('d', d3.line()
        .curve(d3.curveBasis)
        .x( function(p) { return p.x; } )
        .y( function(p) { return p.y; } )
      );
    branch
      .selectAll('path')
      .filter(function (d, i) { return i === 1; })
      .datum(anchors)
      .attr('d', d3.line()
        .curve(d3.curveBasis)
        .x( function(p) { return p.x; } )
        .y( function(p) { return p.y; } )
      );
    return branch;
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
        d3.forceCollide(nodeRadius + 3)
        .iterations(4)
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
      .force("pathcharge",
        d3.forceManyBody()
          .strength(pathChargeStrength)
      )
      .stop()
      .on("tick", this.update);
    this.distanceSim = null;

    this.draggable = null;
    this.dragAnchor = null;
    this.temp = null;

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
    this.linkHelper = this.svg.append("g");

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
    // unwanted, test-only explicit reference to #buttons
    let btnsmenu = d3.select("#buttons");
    btnsmenu.style("left", window.innerWidth/2-btnsmenu.node().clientWidth/2 + "px");

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
          .strength( -40 )
          .distanceMin(20)
          .distanceMax(100))
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

    self.svg
      .on("mousemove", function() {
        let p0 = [self.dragAnchor.x, self.dragAnchor.y];
        let m = d3.mouse(self.svg.node());
        self.linkHelper
          .select("path")
          .datum([p0, m])
          .attr('d', d3.line()
            .x( function(p) { return p[0]; } )
            .y( function(p) { return p[1]; } )
          );
      } );
    self.svg
      .on("mouseup", function() {
        self.linkHelper.selectAll("path").remove();
        self.svg.on("mousemove", null);
      } );
    // draw initial line
    let p0 = [d.x, d.y];
    let m = d3.mouse(self.svg.node());
    self.linkHelper
      .append("path")
      .classed("linkHelper", true)
      .datum([p0, m])
      .attr('d', d3.line()
        .x( function(p) { return p[0]; } )
        .y( function(p) { return p[1]; } )
      );
  }
  anchorMouseUp(d, branch) {
    let s = self.dragAnchor;

    if (s && s != d && s.owner != d.owner) self.mouseAddLinkCB(s, d);
    self.dragAnchor = null;

    // the s == d case triggers the node drawn to disappear, so redraw
    //self.drawAll();
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

    // draw nodes (by delegation & strategy)
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
        .filter( function() { return d3.event.button == 2 && !d3.event.ctrlKey; })
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
        self.nodeMouseDownCB(d.owner.id, d);
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

class ConnRulesBasic {
  // .reverse()'d into left-to-right ordering in the return list
  static getInputAngles(num) {
    if (num == 0) {
      return [];
    } else if (num == 1) {
      return [90];
    } else if (num == 2) {
      return [80, 100].reverse();
    } else if (num == 3) {
      return [70, 90, 110].reverse();
    } else if (num == 4) {
      return [60, 80, 100, 120].reverse();
    } else if (num == 5) {
      return [50, 70, 90, 110, 130].reverse();
    } else throw "give a number from 0 to 5";
  }
  static getOutputAngles(num) {
    if (num == 0) {
      return [];
    } else if (num == 1) {
      return [270];
    } else if (num == 2) {
      return [260, 280];
    } else if (num == 3) {
      return [250, 270, 290];
    } else if (num == 4) {
      return [240, 260, 280, 300];
    } else if (num == 5) {
      return [230, 250, 270, 290, 310];
    } else throw "give a number from 0 to 5";
  }
  static canConnect(a1, a2) {
    //  a2 input anchor, a1 output
    let t1 = a2.i_o;
    let t2 = !a1.i_o;
    // inputs can only have one connection
    let t5 = a2.numconnections == 0;
    // both anchors must be of the same type
    let t6 = a1.type == a2.type;
    let t7 = a1.type == '' || a2.type == '';
    let t8 = a1.type == 'obj' || a2.type == 'obj';

    let ans = ( t1 && t2 ) && t5 && (t6 || t7 || t8);
    return ans;
  }
  static _nodeBaseClasses() {
    return [
      NodeObject,
      NodeObjectLiteral,
      NodeFunction,
      NodeFunctionNamed,
      NodeMethodAsFunction,
      NodeIData,
      NodeIFunc,
      NodeFunctional,
    ];
  }
  static getNodeIdPrefix(basetype) {
    let ncs = this._nodeBaseClasses();
    let prefixes = ncs.map(cn => cn.prefix);
    let basetypes = ncs.map(cn => cn.basetype);
    let i = basetypes.indexOf(basetype);
    if (i >= 0) return prefixes[i]; else throw "getNodeIdPrefix: unknown basetype";
  }
  static createNode(typeconf, id, x=0, y=0) {
    // find the node basetype class
    let tpe = null
    let ncs = this._nodeBaseClasses();
    let nt = ncs.map(cn => cn.basetype);
    let i = nt.indexOf(typeconf.basetype);
    if (i >= 0) tpe = ncs[i]; else throw "unknown typeconf.basetype: " + typeconf.basetype;

    // create the node
    let n = new tpe(x, y, id,
      typeconf.name,
      typeconf.label,
      typeconf,
    );
    if (typeconf.data) {
      n.userdata = typeconf.data;
    }
    return n;
  }
}

// high-level datagraph node types
//
class Node {
  static get basetype() { throw "Node: basetype property must be overridden"; }
  static get prefix() { throw "Node: prefix property must be overridden"; }
  constructor (x, y, id, name, label, typeconf) {
    this.id = id;
    this.name = name;
    this.type = typeconf.type;
    this.address = typeconf.address;
    this._obj = null; // the data object of this handle
    this.static = typeconf.static != "false";
    this.executable = typeconf.executable != "false"
    this.edit = typeconf.edit != "false"

    // craete the GraphicsNode
    let nt = this._getGNType();
    this.gNode = new nt(this, label, x, y);

    let iangles = ConnRulesBasic.getInputAngles(typeconf.itypes.length);
    let oangles = ConnRulesBasic.getOutputAngles(typeconf.otypes.length)

    let anchors = [];
    let at = this._getAnchorType();
    for (var i=0;i<iangles.length;i++) { anchors.push( new at(this.gNode, iangles[i], typeconf.itypes[i], typeconf.ipars[i], true, i) ); }
    for (var i=0;i<oangles.length;i++) { anchors.push( new at(this.gNode, oangles[i], typeconf.otypes[i], null, false, i) ); }

    this.gNode.setAnchors(anchors);
    this.gNode.onConnect = this.onConnect.bind(this);
    this.gNode.onDisconnect = this.onDisconnect.bind(this);
  }
  get obj() {
    return this._obj;
  }
  set obj(value) {
    this._obj = value;
    this.onObjChange(value);
  }
  set userdata(value) {
    if (this._obj == null) this._obj = {};
    this._obj.userdata = value;
    this.onUserDataChange(value);
  }
  get userdata() {
    if (this._obj) return this._obj.userdata;
    return null;
  }
  get plotdata() {
    if (this._obj) return this._obj.plotdata;
    return null;
  }
  set info(value) {
    if (this._obj == null) this._obj = {};
    this._obj.info = value;
  }
  get info() {
    if (this._obj) return this._obj.info;
    return null;
  }
  onUserDataChange(userdata) {}
  onObjChange(obj) {}
  get label() {
    return this.gNode.label;
  }
  set label(value) {
    if (value || value=="") this.gNode.label = value;
  }
  _getGNType() {
    throw "abstract method call"
  }
  _getAnchorType() {
    throw "abstract method call"
  }
  isConnected(connectivity) {
    throw "abstract method call";
  }
  isActive() {
    let val = this.obj != null;
    return val;
  }
  onConnect(link, isInput) { }
  onDisconnect(link, isInput) { }
}

class NodeFunction extends Node {
  static get basetype() { return "function"; }
  get basetype() { return NodeFunction.basetype; }
  static get prefix() { return "f"; }
  constructor(x, y, id, name, label, typeconf) {
    super(x, y, id, name, label, typecond);
  }
  _getGNType() {
    return GraphicsNodeCircular;
  }
  _getAnchorType() {
    return AnchorCircular;
  }
  isConnected(connectivity) {
    return connectivity.indexOf(false) == -1;
  }
}

class NodeFunctionNamed extends Node {
  static get basetype() { return "function_named"; }
  get basetype() { return NodeFunctionNamed.basetype; }
  static get prefix() { return "f"; }
  constructor(x, y, id, name, label, typeconf) {
    super(x, y, id, name, label, typeconf);
  }
  _getGNType() {
    return GraphicsNodeCircular;
  }
  _getAnchorType() {
    return AnchorCircular;
  }
  isConnected(connectivity) {
    return connectivity.indexOf(false) == -1;
  }
  isActive() {
    // assumed to be associated with an underlying function object
    return true;
  }
}

class NodeMethodAsFunction extends NodeFunctionNamed {
  static get basetype() { return "method_as_function"; }
  get basetype() { return NodeMethodAsFunction.basetype; }
  _getGNType() {
    return GraphicsNodeHexagonal;
  }
}

class NodeObject extends Node {
  static get basetype() { return "object"; }
  get basetype() { return NodeObject.basetype; }
  static get prefix() { return "o"; }
  constructor(x, y, id, name, label, typeconf, iotype='obj') {
    typeconf.itypes = [iotype];
    typeconf.otypes = [iotype];
    typeconf.ipars = [''];
    super(x, y, id, name, label, typeconf);
    this.iotype = iotype;
  }
  _getGNType() {
    return GraphicsNodeFluffy;
  }
  _getAnchorType() {
    return AnchorCircular;
  }
  isConnected(connectivity) {
    if (connectivity.length > 0) {
      return connectivity[0];
    }
  }
  onConnect(link, isInput) {
    if (isInput) {
      this.gNode.setOutputAncorTypes([link.d1.type]);
    }
  }
  onDisconnect(link, isInput) {
    if (isInput) {
      this.gNode.setOutputAncorTypes([this.iotype]);
    }
  }
}

class NodeObjectLiteral extends Node {
  static get basetype() { return "object_literal"; }
  get basetype() { return NodeObjectLiteral.basetype; }
  static get prefix() { return "o"; }
  constructor(x, y, id, name, label, typeconf) {
    typeconf.itypes = [];
    typeconf.otypes = ['obj'];
    typeconf.ipars = [''];
    super(x, y, id, name, label, typeconf);
  }
  _getGNType() {
    return GraphicsNodeFluffy;
  }
  _getAnchorType() {
    return AnchorCircular;
  }
  isConnected(connectivity) {
    if (connectivity.length > 0) {
      return conn[0];
    }
  }
  onUserDataChange(userdata) {
    this.onObjChange(userdata);
  }
  // auto-set label
  onObjChange(obj) {
    if (obj || obj=="") {
      this.gNode.label = JSON.stringify(obj).substring(0, 5)
    }
    else {
      this.gNode.label = "null";
    }
  }
  get label() {
    return this.gNode.label;
  }
  set label(value) {
    // just ignore external set-label calls
  }
}

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
  static get prefix() { return "id"; }
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

class NodeFunctional extends Node {
  static get basetype() { return "functional"; }
  get basetype() { return NodeFunctional.basetype; }
  static get prefix() { return "op"; }
  constructor(x, y, id, name, label, typeconf) {
    super(x, y, id, name, label, typeconf);
  }
  _getGNType() {
    return GraphicsNodeSquare;
  }
  _getAnchorType() {
    return AnchorSquare;
  }
  isConnected(connectivity) {
    return connectivity.indexOf(false) == -1;
  }
}

// high/user-level interface to graph data and drawing
//
class GraphInterface {
  constructor(plotlines) {
    this.plotlines = plotlines;

    this.graphData = new GraphTree(ConnRulesBasic);
    let linkCB = this._tryCreateLink.bind(this);
    let delNodeCB = this._delNodeAndLinks.bind(this);
    let selNodeCB = this._selNodeCB.bind(this);
    let exeNodeCB = this._exeNodeCB.bind(this);
    let createNodeCB = this._createNodeCB.bind(this);
    let nodeMouseDownCB = this._nodeMouseDownCB.bind(this);
    this.draw = new GraphDraw(this.graphData, linkCB, delNodeCB, selNodeCB, exeNodeCB, createNodeCB, nodeMouseDownCB);
    this.truth = ConnRulesBasic;

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
    this._nodeRunReturnListn = [];
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
  addNodeRunReturnListener(listener, rmfunc=null) {
    if (listener) this._nodeRunReturnListn.push([listener, rmfunc]);
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
  _exeNodeCB(gNode) {
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
  _nodeMouseDownCB(id, x, y) {
    let n = this.graphData.getNode(id);
    this._fireEvents(this._nodeMouseDownListn, [id, n.gNode, n.plotdata]);
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
    if (this.truth.canConnect(s, d)) {
      this.link_add(s.owner.owner.id, s.idx, d.owner.owner.id, d.idx);
      this.draw.resetAndRestartPathSim(s.owner.owner.id);
      this.draw.resetAndRestartPathSim(d.owner.owner.id);
      this.updateUi()
    }
  }
  // used by high-level node constructors, those taking only a node conf
  _getId(prefix) {
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

  // UTILITY INTERFACE SECTION
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
  runSelectedNode() {
    if (this.graphData.getSelectedNode()) {
      this.run(this.graphData.getSelectedNode().id);
    }
    else {
      console.log("GraphInterface.runSelectedNode: selected node is null");
      return;
    }
  }
  reset() {
    //this.graphData = new GraphData();
    this.graphData = new GraphTree(ConnRulesBasic);
    this.draw.graphData = this.graphData;
    this.nodes = {};
    this.idxs = {};
    this.undoredo = new UndoRedoCommandStack();
    this.updateUi();
  }
  updateUi() {
    this.draw.drawAll();
    this._fireEvents(this._updateUiListn, [this.graphData.getSelectedNode()]);
  }
  extractGraphDefinition() {
    return this.graphData.extractGraphDefinition();
  }
  injectGraphDefinition(def) {
    let args = null;
    for (let key in def.nodes) {
      args = def.nodes[key];
      this.node_add(args[0], args[1], args[2], args[3], args[4], args[5]);
    }
    let data = null;
    let elinks = null;
    for (let key in def.links) {
      elinks = def.links[key];
      for (var j=0;j<elinks.length;j++) {
        args = elinks[j];
        this.link_add(args[0], args[1], args[2], args[3], args[4]);
      }
    }
    for (let key in def.datas) {
      data = atob(def.datas[key]);
      this.node_data(key, data);
    }
    this.updateUi();
  }
  printUndoRedoStack() {
    let lst = this.undoredo.ur;
    //console.log(JSON.stringify(lst, null, 2));
    console.log(JSON.stringify(lst));
  }
  loadGraphDef() {
    simpleajax('/ifl/ajax_load_graph_def', "", function(msg) {
      this.reset();
      this.injectGraphDefinition(JSON.parse(msg));
    }.bind(this));
  }
  saveGraphDef() {
    let graphDef = this.extractGraphDefinition();
    let post_data = { "graphdef" : graphDef };
    simpleajax('/ifl/ajax_save_graph_def', post_data, function(msg) {
      console.log(msg);
    }.bind(this));
  }

  // FORMAL INTERFACE SECTION
  //
  run(id) {
    // safeties
    if (id == null) throw "run arg must be a valid id"
    if (this.lock == true) { console.log("GraphInterface.run call during lock (id: " + id + ")" ); return; }
    let n = this.graphData.getNode(id);
    if (n.executable == false) { console.log("GraphInterface.run call on non-executable node (id: " + id + ")"); return; }

    // clear the state of any error node, we can hope users have now fixed the problem and we do not want any hangover error nodes
    if (this._errorNode)
    {
      this.graphData._updateNodeState(this._errorNode);
      this._errorNode = null;
    }

    // lock the ui and set running node state
    this.lock = true;
    n.gNode.state = NodeState.RUNNING;
    this.updateUi();

    let syncset = this.undoredo.getSyncSet();
    let post_data = {json_str: JSON.stringify({ run_id: id, sync: syncset })};
    let selfref = this; // replace this with the .bind(this) method on a func object

    simpleajax('/ifl/ajax_run_node', post_data,
      function(msg) {
        selfref.lock = false;
        let retobj = JSON.parse(msg);

        // fail section
        let fail = retobj['error']
        if (fail != null) {
          selfref.graphData._updateNodeState(n);
          let sourceid = fail['source-id'];
          if (sourceid) {
            let m = selfref.graphData.getNode(sourceid);
            selfref._errorNode = m;
            m.gNode.state = NodeState.FAIL;
            m.info = fail['message'];
            selfref.updateUi();
            alert(m.label + " " + sourceid + " " + fail['message']);
          }
          else {
            alert(fail['message']);
          }
        }

        // success section
        let update = retobj['update'];
        for (let key in update) {
          let obj = update[key];
          let m = selfref.graphData.getNode(key);
          if (obj != null) {
            selfref.node_data(key, JSON.stringify(obj.userdata));
            m.obj = obj; // (re)set all data
            selfref.undoredo.incSyncByOne(); // this to avoid re-setting already existing server state
          }
          selfref.graphData._updateNodeState(m);
          selfref._fireEvents(selfref._nodeRunReturnListn, [m]);
        }
        selfref.updateUi();
      },
      function() {
        // unhandled server exception section
        selfref.lock = false;
        selfref.graphData._updateNodeState(n);
        selfref.updateUi();
      }
    );
  }
  _command(cmd) {
    let args = cmd.slice(1);
    let command = cmd[0]
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

// a single-column node creation menu ui
class NodeTypeMenu {
  constructor(selectConfCB, rootelementid, branchname) {
    this.menus = [];
    this.root = d3.select("#"+rootelementid);
    this.selectConfCB = selectConfCB;

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
      .classed("menuItem", true);  }
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
    let n = ConnRulesBasic.createNode(conf, "", 50, 50);
    conf.label = lbl;

    let branch = this.root
      .append("div")
      .style('width', "100px")
      .style('height', "100px")
      .classed("menuItem", true)
      .append("svg")
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
