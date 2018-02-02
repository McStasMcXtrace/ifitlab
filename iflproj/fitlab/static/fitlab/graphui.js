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
const anchSpace = 80;
const pathChargeStrength = -100;
const pathLinkStrength = 2;
const distance = 80;

const arrowHeadLength = 12;
const arrowHeadAngle = 25;

// some debug colours
const color = d3.scaleOrdinal().range(d3.schemeCategory20);

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
  if (state==NodeState.DISCONNECTED) {
    return "disconnected";
  }
  else if (state==NodeState.PASSIVE) {
    return "passive";
  }
  else if (state==NodeState.ACTIVE) {
    return "active";
  }
  else if (state==NodeState.RUNNING) {
    return "running";
  }
  else if (state==NodeState.FAIL) {
    return "fail";
  }
  else throw "invalid value"
}

// type supplying graphical data
class GraphicsNode {
  constructor(owner, label, x, y) {
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.r = nodeRadius;
    this.label = label;
    this.anchors = null;
    this.links = [];
    this.centerAnchor = new CenterAnchor(this);

    // graphics switch on this property, which is updated externally according to some rule
    this.state = NodeState.DISCONNECTED;
    this.active = false;
  }
  setAnchors(anchors) {
    if (this.anchors != null) throw "please set anchors only once, cleaning up makes a mess"
    ConnectionTruthMcWeb.assignIdxAndOrder(anchors);
    this.anchors = anchors;
  }
  isAllConnected() {
    let c = this.getConnections();
    return c.indexOf(false) == -1;
  }
  getConnections() {
    // collect local link anchors
    let links = this.links;
    let linkAnchors = [];
    let l = null;
    for (var j=0; j<links.length; j++) {
      l = links[j];
      linkAnchors.push(l.d1);
      linkAnchors.push(l.d2);
    }
    // match anchors with link anchors
    let connectivity = [];
    let anchors = this.anchors;
    let a = null;
    for (var j=0; j<anchors.length; j++) {
      a = anchors[j];
      connectivity.push(linkAnchors.indexOf(a) != -1);
    }
    return connectivity;
  }
  get neighbours() {
    let nbs = [];
    let l;
    for (var j=0; j<this.links.length; j++) {
      l = this.links[j];
      if (l.d1.owner != this) {
        nbs.push(l.d1.owner);
      }
      if (l.d2.owner != this) {
        nbs.push(l.d2.owner);
      }
    }
    return nbs;
  }
  get exitLinks() {
    let exLinks = [];
    let idxs = [];
    let a = null;
    let l = null;
    for (var j=0;j<this.links.length;j++) {
      l = this.links[j];
      a = l.d1;
      if (this.anchors.indexOf(a) != -1) exLinks.push(l);
    }
    return exLinks;
  }
  addLink(link, isInput) {
    this.links.push(link);
    this.onConnect(link, isInput);
  }
  rmLink(link, isInput) {
    remove(this.links, link);
    this.onDisconnect(link, isInput);
  }
  draw(branch, i) {
    return branch
      .attr('stroke', "black")
      .classed(getNodeStateClass(this.state), true)
  }
  // hooks for higher level nodes
  onConnect(link, isInput) {}
  onDisconnect(link, isInput) {}
  setAnchorTypes(at) {
    let anchors = this.anchors;
    let a = null;
    if (at.length == anchors.length) {
      for (var j=0;j<anchors.length;j++) {
        a = anchors[j];
        a.type = at[j];
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
  constructor(owner, angle, type, parname) {
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

    this.isTarget = false;
    this.isLinked = false;

    this.arrowHead = null;

    // these integers, reflecting anchor position on a node, are set externally
    this.i_o = null;
    this.idx = null;
    this.order = null;
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
  get connections() {
    let answer = 0;
    let olinks = this.owner.links;
    let l = null;
    for (var i=0; i<olinks.length; i++) {
      l = olinks[i];
      if (this == l.d1 || this == l.d2) answer++;
    }
    return answer;
  }
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
  constructor(owner, angle, type, parname) {
    super(owner, angle, type, parname);
    this.localx = owner.r * Math.cos(this.angle/360*2*Math.PI);
    this.localy = - this.owner.r * Math.sin(this.angle/360*2*Math.PI); // svg inverted y-axis

    let ext_localx = (owner.r + extensionLength) * Math.cos(this.angle/360*2*Math.PI);
    let ext_localy = - (this.owner.r + extensionLength) * Math.sin(this.angle/360*2*Math.PI); // svg inverted y-axis
    this.ext = new ExtensionAnchor(owner, ext_localx, ext_localy);
  }
}

class AnchorSquare extends Anchor {
  constructor(owner, angle, type, parname) {
    super(owner, angle, type, parname);
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

    d1.owner.addLink(this, false);
    d2.owner.addLink(this, true);

    d2.isTarget = true;
    d1.isLinked = true;
    d2.isLinked = true;
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
    this.d2.isTarget = false;
    this.d1.isLinked = false;
    this.d2.isLinked = false;

    this.d1.owner.rmLink(this, false);
    this.d2.owner.rmLink(this, true);
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
  constructor(graphData, mouseAddLinkCB, delNodeCB, selectNodeCB, executeNodeCB, createNodeCB) {
    // pythonicism
    self = this;

    this.graphData = graphData; // this is needed for accessing anchors and nodes for simulations
    this.mouseAddLinkCB =  mouseAddLinkCB; // this is the cb callled when anchors are dragged on top of one another
    this.delNodeCB = delNodeCB;
    this.selectNodeCB = selectNodeCB;
    this.executeNodeCB = executeNodeCB;
    this.createNodeCB = createNodeCB;

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
        self.graphData.selectedNode = null;
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
  }
  recenter() {
    // unwanted, test-only explicit reference to #buttons
    let btnsmenu = d3.select("#buttons");
    btnsmenu.style("left", window.innerWidth/2-btnsmenu.node().clientWidth/2 + "px");

    self.centeringSim.stop();
    self.centeringSim.force("centering").x(window.innerWidth/2);
    self.centeringSim.force("centering").y(window.innerHeight/2);
    self.centeringSim.nodes(self.graphData.nodes.concat(self.graphData.getAnchors()));
    self.centeringSim.alpha(1).restart();
  }
  resetChargeSim() {
    // the charge force seems to have to reset like this for some reason
    self.distanceSim = d3.forceSimulation(self.graphData.nodes)
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
  resetPathSim() {
    self.pathSim.stop();
    self.pathSim.nodes(self.graphData.getAnchors());
    self.pathSim.force("link").links(self.graphData.getForceLinks());
  }
  restartPathSim() {
    // run the pathsim manually to avoid the animation
    self.pathSim.alpha(1);
    for (var i=0; i < 300; i++) {
      self.pathSim.tick();
    }
    self.update();
  }
  restartCollideSim() {
    self.collideSim.stop();
    self.collideSim.nodes(self.graphData.nodes);
    self.collideSim.alpha(1).restart();
    // path anchors go into the center-sim only
    self.centeringSim.stop();
    self.centeringSim.nodes(self.graphData.nodes.concat(self.graphData.anchors));
    self.centeringSim.alpha(1).restart();
  }
  dragged(d) {
    // reheating collision protection is needed during long drags
    if (self.collideSim.alpha() < 0.1) { self.restartCollideSim(); }

    d.x += d3.event.dx;
    d.y += d3.event.dy;
  }
  dragstarted(d) {
    self.restartCollideSim();
  }
  dragended(d) {
    // recalc node link path anchors here
    d.links.forEach( function(l) {
      l.recalcPathAnchors();
    } )

    // restart post-drag relevant layout sims
    self.restartChargeSim();
    self.resetPathSim(); // we need to reset, because the path anchors may have changed during recalcPathAnchors
    self.restartPathSim();
    self.recenter();

    self.drawAll();
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
    self.drawAll();
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
    self.anchors
      .attr("cx", function(d) { return d.x; })
      .attr("cy", function(d) { return d.y; });
    */
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
      .data(self.graphData.nodes)
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
          self.delNodeCB( node.owner );
        }
        else {
          self.graphData.selectedNode = node;
          self.selectNodeCB( node );
          self.update();
        }
      })
      .on("dblclick", function() {
        let node = d3.select(this).datum();
        //self.graphData.selectedNode = node;
        //self.selectNodeCB( node );
        self.executeNodeCB(node);
      });

    self.nodes = GraphDraw.drawNodes(self.draggable);

    // draw the splines
    let links = self.graphData.links;

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
    let anchors = self.graphData.anchors;
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

    // recenter everything
    self.recenter();
    // update data properties
    self.update();
  }
}

// node data manager, keeping this interface tight and providing convenient arrays for layout sims
class GraphData {
  constructor() {
    this.nodes = [];
    this.links = [];
    this.anchors = [];
    this.forceLinks = [];

    this.nodeIds = [];

    this._selectedNode = null;
  }
  set selectedNode(n) {
    let m = this._selectedNode;
    if (m) m.active = false;
    this._selectedNode = n;
    // n could be null - de-selection
    if (n) n.active = true;
  }
  get selectedNode() {
    return this._selectedNode;
  }
  // should be private
  updateAnchors() {
    this.anchors = [];
    this.forceLinks = [];
    for (let j = 0; j < this.links.length; j++) {

      let anchors = this.links[j].getAnchors();
      let fl = null;

      for (let i = 0; i < anchors.length; i++) {
        this.anchors.push(anchors[i]);
        if (i > 0) {
          fl = { 'source' : anchors[i-1], 'target' : anchors[i], 'index' : null }
          this.forceLinks.push(fl);
        }
      }
    }
  }
  getAnchors() {
    this.updateAnchors();
    return this.anchors;
  }
  getForceLinks() {
    this.updateAnchors();
    return this.forceLinks;
  }
  addNode(n) {
    if (!this.nodeIds.includes(n.id)) {
      this.nodes.push(n);
      this.nodeIds.push(n.label);
      this.anchors.push(n.centerAnchor);
    }
    else throw "node of that id already exists"
  }
  rmNodeAndLinks(n) {
    let nl = n.links.length;
    let report = [];
    let l = null;
    for (var i=0; i<nl; i++) {
      l = n.links[0];
      report.push(["link_add", l.d1.owner.id, l.d1.idx, l.d2.owner.id, l.d2.idx, l.d1.order]);
      this.rmLink(l);
    }
    remove(this.nodes, n);
    return report;
  }
  rmNodeSecure(n) {
    if (n.links.length > 0) throw "some links persist on node, won't delete " + n.owner.id;
    remove(this.nodes, n);
  }
  addLink(l) {
    this.links.push(l);
    this.updateAnchors();
  }
  rmLink(l) {
    l.detatch();
    remove(this.links, l);
  }
}

class ConnectionTruthMcWeb {
  // returns the specified number of angles which will all be interpreted as inputs
  // NOTE: input angle are reversed, due to the let-to-right counting for inputs as function arguments
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
  // returns the specified number of angles which will all be interpreted as outputs
  // NOTE: output angles are NOT reversed, see comment on getInputAngles
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
  static isInputAngle(angle) {
    return 45 < angle && angle < 135;
  }
  static isOutputAngle(angle) {
    return 225 < angle && angle < 315;
  }
  static getFunctionalInputAngles(num) {
    if (num == 0) {
      return [];
    } else if (num == 1) {
      return [180];
    } else if (num == 2) {
      return [170, 190].reverse();
    } else if (num == 3) {
      return [160, 180, 200].reverse();
    } else if (num == 4) {
      return [150, 170, 190, 210].reverse();
    } else if (num == 5) {
      return [140, 160, 180, 200, 220].reverse();
    } else throw "give a number from 0 to 5";
  }
  static getFunctionalOutputAngles(num) {
    if (num == 0) {
      return [];
    } else if (num == 1) {
      return [0];
    } else if (num == 2) {
      return [10, 350];
    } else if (num == 3) {
      return [20, 0, 340];
    } else if (num == 4) {
      return [30, 10, 350, 330];
    } else if (num == 5) {
      return [40, 20, 0, 340, 320];
    } else throw "give a number from 0 to 5";
  }
  static isFunctionalInputAngle(angle) {
    return 135 < angle && angle < 225;
  }
  static isFunctionalOutputAngle(angle) {
    let t1 = 0 <= angle && angle < 45;
    let t2 = 315 < angle && angle <= 360;
    return t1 || t2;
  }
  static canConnect(a1, a2) {
    // a1 must be an output and a2 an input
    let t1 = this.isInputAngle(a2.angle);
    let t2 = this.isOutputAngle(a1.angle);
    let t3 = this.isFunctionalInputAngle(a2.angle);
    let t4 = this.isFunctionalOutputAngle(a1.angle);

    // inputs can only have one connection
    let t5 = a2.connections == 0;
    // both anchors must be of the same type
    let t6 = a1.type == a2.type;
    let t7 = a1.type == '' || a2.type == ''; // the latter of these two is questionable
    let t8 = a1.type == 'obj' || a2.type == 'obj'; // the latter of these two is questionable

    let ans = ( t1 && t2 || t3 && t4 ) && t5 && (t6 || t7 || t8);
    return ans;
  }
  static assignIdxAndOrder(anchors) {
    // this function assigns anchor positional properties, used for back-tracking graph structure
    let i0 = anchors.filter(a => this.isInputAngle(a.angle));
    let o0 = anchors.filter(a => this.isOutputAngle(a.angle));
    let i1 = anchors.filter(a => this.isFunctionalInputAngle(a.angle));
    let o1 = anchors.filter(a => this.isFunctionalOutputAngle(a.angle));
    let a = null;
    for (var j=0;j<i0.length;j++) {
      a = i0[j];
      a.i_o = 0;
      a.idx = j;
      a.order = 0;
    }
    for (var j=0;j<o0.length;j++) {
      a = o0[j];
      a.i_o = 1;
      a.idx = j;
      a.order = 0;
    }
    for (var j=0;j<i1.length;j++) {
      a = i1[j];
      a.i_o = 0;
      a.idx = j;
      a.order = 1;
    }
    for (var j=0;j<o1.length;j++) {
      a = o1[j];
      a.i_o = 1;
      a.idx = j;
      a.order = 1;
    }
  }
  static getLinkClass(a) {
    if (this.isInputAngle(a.angle) || this.isOutputAngle(a.angle)) return LinkSingle; else return LinkDouble;
  }
  static updateStates(nodes) {
    for (var i=0; i<nodes.length; i++) {
      this.updateNodeState(nodes[i]);
    }
  }
  static updateNodeState(node) {
    let o = node.owner;
    if (o.isActive()) {
      node.state = NodeState.ACTIVE;
    }
    else if (!o.isConnected()){
      node.state = NodeState.DISCONNECTED;
    }
    else {
      node.state = NodeState.PASSIVE;
    }
  }
  static _getBaseNodeClassName(basetype) {
    let ncs = this._nodeBaseClasses();
    let nt = ncs.map(cn => cn.basetype);
    let i = nt.indexOf(basetype);
    if (i >= 0) return ncs[i]; else throw "_getBaseNodeClassName: unknown basetype: " + basetype;
  }
  static _getPrefix(basetype) {
    let ncs = this._nodeBaseClasses();
    let prefixes = ncs.map(cn => cn.prefix);
    let basetypes = ncs.map(cn => cn.basetype);
    let i = basetypes.indexOf(basetype);
    if (i >= 0) return prefixes[i]; else throw "_getPrefix: unknown basetype";
  }
  // register all node types here
  static _nodeBaseClasses() {
    return [
      NodeObject,
      NodeObjectLitteral,
      NodeFunction,
      NodeFunctionNamed,
      NodeMethodAsFunction,
      NodeIData,
      NodeIFunc,
      NodeFunctional
    ];
  }
  static createNodeObjectFromConf(typeconf, id, x=0, y=0) {
    let cn =  ConnectionTruthMcWeb._getBaseNodeClassName(typeconf.basetype);
    let n = new cn(x, y, id,
      typeconf.name,
      typeconf.label,
      typeconf,
      typeconf.itypes, // js doesn't seem to mind these sometimes-extra arguments
      typeconf.otypes, //
      typeconf.ipars,
    );
    return n
  }
}

// high-level node types
class Node {
  static get basetype() { throw "Node: basetype property must be overridden"; }
  static get prefix() { throw "Node: prefix property must be overridden"; }
  // F stands for functional, e.g. type lists for the "other" classification
  constructor (x, y, id, name, label, typeconf, itypes, otypes, ipars, itypesF, otypesF, iparsF) {
    this.id = id;
    this.name = name;
    this.type = typeconf.type;
    this.address = typeconf.address;
    this.ipars = ipars
    this.itypes = itypes;
    this.otypes = otypes;
    this.ipars = ipars
    this.itypesF = itypesF;
    this.otypesF = otypesF;
    this.iparsF = iparsF;

    this.gNode = null; // the graphics representing this object
    this._obj = null; // the data object of this handle
    this.static = typeconf.static != "false";
    this.executable = typeconf.executable != "false"
    this.editable = typeconf.edit != "false"

    // practical construction used by subclasses
    let iangles = ConnectionTruthMcWeb.getInputAngles(itypes.length);
    let oangles = ConnectionTruthMcWeb.getOutputAngles(otypes.length)
    let ianglesF = ConnectionTruthMcWeb.getFunctionalInputAngles(itypesF.length);
    let oanglesF = ConnectionTruthMcWeb.getFunctionalOutputAngles(otypesF.length)
    let anchors = [];
    let nt = this._getGNType();
    let at = this._getAnchorType();
    let n = new nt(this, label, x, y);
    for (var i=0;i<iangles.length;i++) { anchors.push( new at(n, iangles[i], itypes[i], ipars[i]) ); }
    for (var i=0;i<oangles.length;i++) { anchors.push( new at(n, oangles[i], otypes[i], null) ); }
    for (var i=0;i<ianglesF.length;i++) { anchors.push( new at(n, ianglesF[i], itypesF[i], iparsF[i]) ); }
    for (var i=0;i<oanglesF.length;i++) { anchors.push( new at(n, oanglesF[i], otypesF[i], null) ); }
    n.setAnchors(anchors);
    n.onConnect = this.onConnect.bind(this);
    n.onDisconnect = this.onDisconnect.bind(this);

    this.gNode = n;
  }
  get plot() {
    return this._obj.plotdata;
  }
  get objFull() {
    //console.log("get_objFull: ", this._obj);
    return this._obj;
  }
  set objFull(value) {
    this._obj = value;
    //console.log("set_objFull: ", this._obj);
    this.onObjChange(value);
  }
  get obj() {
    if (this._obj == null) {
      return null;
    } else if (this._obj.userdata == null) {
      return null;
    }
    return this._obj.userdata;
  }
  set obj(value) {
    if (value === undefined) console.log("data set undefined");
    if (value == null) {
      this.objFull = null;
    } else {
      if (this._obj == null) this._obj = {};
      this._obj.userdata = value;
    }
    this.onObjChange(value);
  }
  onObjChange(obj) {
    //console.log("obj change detected: ", obj)
  }
  get label() {
    return this.gNode.label;
  }
  set label(value) {
    if (value) this.gNode.label = value;
  }
  static isAllConnected() {
    return this.gNode.isAllConnected();
  }
  _getGNType() {
    throw "abstract method call"
  }
  _getAnchorType() {
    throw "abstract method call"
  }
  isConnected(iIsConn, oIsConn) {
    throw "abstract method call";
  }
  isActive() {
    let val = this.objFull != null;
    return val;
  }
  // order means itypes/otypes/itypesF/otypesF == 0/1/2/3
  getAnchor(idx, order) {
    let l1 = this.itypes.length;
    let l2 = this.otypes.length;
    let l3 = this.itypesF.length;

    let a = null;
    if (order == 0) {
      a = this.gNode.anchors[idx];
    } else if (order == 1) {
      a = this.gNode.anchors[idx+l1];
    } else if (order == 2) {
      a = this.gNode.anchors[idx+l1+l2];
    } else if (order == 3) {
      a = this.gNode.anchors[idx+l1+l2+l3];
    } else throw "nonsenseException"
    return a;
  }
  onConnect(link, isInput) { }
  onDisconnect(link, isInput) { }
}

class NodeFunction extends Node {
  static get basetype() { return "function"; }
  get basetype() { return NodeFunction.basetype; } // js is not class-based
  static get prefix() { return "f"; }
  constructor(x, y, id, name, label, type, itypes, otypes, ipars) {
    super(x, y, id, name, label, type, itypes, otypes, ipars, [], ['func'], []);
    this.idxF = itypes.length + otypes.length -1;
  }
  _getGNType() {
    return GraphicsNodeCircular;
  }
  _getAnchorType() {
    return AnchorCircular;
  }
  isConnected() {
    let conn = this.gNode.getConnections();
    let subconn = conn.slice(0, this.idxF); // the pre-functional connections
    return subconn.indexOf(false) == -1;
  }
}

class NodeFunctionNamed extends Node {
  static get basetype() { return "function_named"; }
  get basetype() { return NodeFunctionNamed.basetype; } // js is not class-based
  static get prefix() { return "f"; }
  constructor(x, y, id, name, label, type, itypes, otypes, ipars) {
    super(x, y, id, name, label, type, itypes, otypes, ipars, [], [], []);
    this.idxF = itypes.length + otypes.length -1;
  }
  _getGNType() {
    return GraphicsNodeCircular;
  }
  _getAnchorType() {
    return AnchorCircular;
  }
  isConnected() {
    let conn = this.gNode.getConnections();
    let subconn = conn.slice(0, this.idxF); // the pre-functional connections
    return subconn.indexOf(false) == -1;
  }
}

class NodeMethodAsFunction extends NodeFunctionNamed {
  static get basetype() { return "method_as_function"; }
  get basetype() { return NodeFunctionNamed.basetype; } // js is not class-based
  _getGNType() {
    return GraphicsNodeHexagonal;
  }
}

class NodeObject extends Node {
  static get basetype() { return "object"; }
  get basetype() { return NodeObject.basetype; } // js is not class-based
  static get prefix() { return "o"; }
  constructor(x, y, id, name, label, type, iotype='obj') {
    let itypes = [iotype];
    let otypes = [iotype];
    let ipars = [''];
    super(x, y, id, name, label, type, itypes, otypes, ipars, [], [], []);
    this.iotype = iotype;
  }
  _getGNType() {
    return GraphicsNodeFluffy;
  }
  _getAnchorType() {
    return AnchorCircular;
  }
  isConnected() {
    let conn = this.gNode.getConnections();
    if (conn.length > 0) {
      return conn[0];
    }
  }
  onConnect(link, isInput) {
    if (isInput) {
      this.otypes = [link.d1.type];
      this.gNode.setAnchorTypes(this.itypes.concat(this.otypes));
    }
  }
  onDisconnect(link, isInput) {
    if (isInput) {
      this.otypes = [this.iotype];
      this.gNode.setAnchorTypes(this.itypes.concat(this.otypes));
    }
  }
}

class NodeObjectLitteral extends Node {
  static get basetype() { return "object_litteral"; }
  get basetype() { return NodeObjectLitteral.basetype; } // js is not class-based
  static get prefix() { return "o"; }
  constructor(x, y, id, name, label, type) {
    let itypes = [];
    let otypes = ['obj'];
    let ipars = [''];
    super(x, y, id, name, label, type, itypes, otypes, ipars, [], [], []);
  }
  _getGNType() {
    return GraphicsNodeFluffy;
  }
  _getAnchorType() {
    return AnchorCircular;
  }
  isConnected() {
    let conn = this.gNode.getConnections();
    if (conn.length > 0) {
      return conn[0];
    }
  }
  // auto-set label
  onObjChange(obj) {
    if (obj) {
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
  get basetype() { return NodeIData.basetype; } // js is not class-based
  static get prefix() { return "id"; }
  constructor(x, y, id, name, label, type) {
    super(x, y, id, name, label, type, 'IData');
  }
  _getGNType() {
    return GraphicsNodeFluffyPad;
  }
}

class NodeIFunc extends NodeObject {
  static get basetype() { return "object_ifunc"; }
  get basetype() { return NodeIFunc.basetype; } // js is not class-based
  static get prefix() { return "id"; }
  constructor(x, y, id, name, label, type) {
    super(x, y, id, name, label, type, 'IFunc');
  }
  _getGNType() {
    return GraphicsNodeCircularPad;
  }
}

class NodeFunctional extends Node {
  static get basetype() { return "functional"; }
  get basetype() { return NodeFunctional.basetype; } // js is not class-based
  static get prefix() { return "op"; }
  constructor(x, y, id, name, label, type, itypesF, otypesF, iparsF) {
    super(x, y, id, name, label, type, [], [], [], itypesF, otypesF, iparsF);
  }
  _getGNType() {
    return GraphicsNodeSquare;
  }
  _getAnchorType() {
    return AnchorSquare;
  }
  isConnected() {
    return this.gNode.getConnections().indexOf(false) == -1;
  }
}

// high/user-level interface to graph data and drawing
class GraphInterface {
  constructor() {
    this.graphData = new GraphData();
    let linkCB = this._tryCreateLink.bind(this);
    let delNodeCB = this._delNodeAndLinks.bind(this);
    let selNodeCB = this._selNodeCB.bind(this);
    let exeNodeCB = this._exeNodeCB.bind(this);
    let createNodeCB = this._createNodeCB.bind(this);
    this.draw = new GraphDraw(this.graphData, linkCB, delNodeCB, selNodeCB, exeNodeCB, createNodeCB);
    this.truth = ConnectionTruthMcWeb;

    // id, node dict,for high-level nodes
    this.nodes = {};
    // create-node id uniqueness counter - dict'ed by key 'basetype prefix'
    this.idxs = {};

    // undo-redo stack
    this.undoredo = new UndoRedoCommandStack();

    // event listeners
    this._selListn = [];
    this._updateUiListn = [];

    // locks all undoable commands, and also a few others (js is single-threaded in most cases)
    this.locked = false;

    // node create conf pointer
    this._createConf = null;
  }
  setCreateNodeConf(conf) {
    this._createConf = cloneConf(conf);
  }
  _createNodeCB(x, y) {
    let conf = this._createConf;
    if (conf == null) return;

    let rv = this.node_add(x, y, "", "", conf.label, conf.address);
    this.draw.resetChargeSim();
    this.draw.restartCollideSim();
    this.updateUi();

    this._createConf = null;
  }
  _exeNodeCB(gNode) {
    this.run(gNode.owner.id);
  }
  // NOTE that node can be null, indicating a total de-selection
  _selNodeCB(node) {
    for (var i=0; i<this._selListn.length; i++) {
      let l = this._selListn[i];
      l(node);
    }
  }
  _delNodeAndLinks(n) {
    if (n.gNode) n = n.gNode; // totally should be un-hacked

    // formalize "node cleanup" which is link removal
    let l = null;
    let numlinks = n.links.length;
    for (var i=0; i<numlinks; i++) {
      l = n.links[0];
      this.link_rm(l.d1.owner.owner.id, l.d1.idx, l.d2.owner.owner.id, l.d2.idx, l.d1.order);
    }
    // formalize the now clean node removal
    let id = n.owner.id;
    this.node_rm(id);

    // ui related actions
    this.draw.drawAll();
    this.draw.restartCollideSim();
  }
  _tryCreateLink(s, d) {
    if (this.truth.canConnect(s, d)) {
      this.link_add(s.owner.owner.id, s.idx, d.owner.owner.id, d.idx, s.order);

      this.draw.drawAll();
      this.draw.resetPathSim();
      this.draw.restartPathSim();
    }
  }
  // used by high-level node constructors taking only a node conf
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
  addUiUpdateListener(lsn) {
    this._updateUiListn.push(lsn);
  }
  addSelectNodeListener(lsn) {
    this._selListn.push(lsn);
  }
  pushSelectedNodeLabel(text) {
    this.node_label(this.graphData.selectedNode.owner.id, text);
  }
  pushSelectedNodeData(json_txt) {
    this.node_data(this.graphData.selectedNode.owner.id, json_txt);
  }
  runSelectedNode() {
    if (this.graphData.selectedNode) {
      this.run(this.graphData.selectedNode.owner.id);
    }
    else {
      console.log("GraphInterface.runSelectedNode: selected node is null");
      return;
    }
  }
  reset() {
    this.graphData = new GraphData();
    this.draw.graphData = this.graphData;
    this.nodes = {};
    this.idxs = {};
    this.undoredo = new UndoRedoCommandStack();
    this.updateUi();
  }
  updateUi() {
    this.draw.drawAll();

    if (this.graphData.selectedNode) {
      for (var i=0; i<this._updateUiListn.length; i++) {
        let l = this._updateUiListn[i];
        l(this.graphData.selectedNode.owner);
      }
    }
  }
  extractGraphDefinition() {
    let def = {};
    def.nodes = {};
    def.datas = {};
    def.links = {};
    // put meta-properties here, s.a. version, date

    let nodes = def.nodes;
    let datas = def.datas;
    let links = def.links;
    let n = null;
    for (let key in this.nodes) {
      n = this.nodes[key];
      nodes[n.id] = [n.gNode.x, n.gNode.y, n.id, n.name, n.label, n.address];
      if (n.basetype == 'object_litteral') datas[n.id] = btoa(JSON.stringify(n.obj));

      let elks = n.gNode.exitLinks;
      if (elks.length == 0) continue;

      links[n.id] = [];
      let l = null;
      for (var j=0;j<elks.length;j++) {
        l = elks[j];
        links[n.id].push([n.id, l.d1.idx, l.d2.owner.owner.id, l.d2.idx, l.d1.order]);
      }
    }
    let def_text = JSON.stringify(def);
    //console.log(JSON.stringify(def, null, 2));
    console.log(def_text);
    return def_text;
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
    simpleajax('/ajax_load_graph_def', "", function(msg) {
      this.reset();
      this.injectGraphDefinition(JSON.parse(msg));
    }.bind(this));
  }
  saveGraphDef() {
    let graphDef = this.extractGraphDefinition();
    let post_data = { "graphdef" : graphDef };
    simpleajax('/ajax_save_graph_def', post_data, function(msg) {
      console.log(msg);
    }.bind(this));
  }

  // FORMAL INTERFACE SECTION
  //
  run(id) {
    // safeties
    if (this.lock == true) { console.log("GraphInterface.run call during lock (id: " + id + ")" ); return; }
    let n = this.nodes[id];
    if (n.executable == false) { console.log("GraphInterface.run call on non-executable node (id: " + id + ")"); return; }

    this.lock = true;
    n.gNode.state = NodeState.RUNNING;
    this.updateUi();

    let syncset = this.undoredo.getSyncSet();
    let post_data = { json_str: JSON.stringify({ run_id: id, sync: syncset }) };
    let selfref = this; // replace this with the .bind(this) method on a func object

    // TODO: consider a locking mechanism for the entire ui, or drop data updates completely...
    simpleajax('/ajax_run_node', post_data,
      function(msg) {
        selfref.lock = false; // js is single threaded and finished everything before moving on
        let obj_full = JSON.parse(msg);
        n.objFull = obj_full;
        let obj_setable = obj_full.userdata;
        selfref.node_data(id, JSON.stringify(obj_setable));
        selfref.undoredo.incSyncByOne(); // this to avoid re-setting already existing server state
        ConnectionTruthMcWeb.updateNodeState(n.gNode);
        selfref.updateUi();

        // TESTING
        plot_1d(obj_full.plotdata, d3.select('#node_properties').append("svg"));
      },
      function() {
        console.log("run() ajax fail (id: " + id + ")");
        selfref.lock = false;
        ConnectionTruthMcWeb.updateNodeState(n.gNode);
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
      if ((id == '') || (!id) || (id in this.nodes)) {
        id = this._getId(ConnectionTruthMcWeb._getPrefix(conf.basetype));
      }
      let n = ConnectionTruthMcWeb.createNodeObjectFromConf(conf, id, x, y);
      n.obj = conf.data;
      this.nodes[id] = n;

      this.graphData.addNode(n.gNode);
      this.truth.updateNodeState(n.gNode);
      this.draw.resetChargeSim();

      return [["node_add", n.gNode.x, n.gNode.y, n.id, n.name, n.label, n.address], ["node_rm", n.id]];
    }
    else if (command=="node_rm") {
      let n = this.nodes[args[0]];
      if (!n) throw "invalid node_rm command: node not found (by id)";
      let id = n.id;

      // construct reverse command
      let na_cmd = ["node_add", n.gNode.x, n.gNode.y, id, n.name, n.label, n.address];

      // remove node traces
      this.graphData.rmNodeSecure(n.gNode);
      delete this.nodes[id];

      return [["node_rm", id], na_cmd];
    }
    else if (command=="link_add") {
      let id1 = args[0];
      let idx1 = args[1];
      let id2 = args[2];
      let idx2 = args[3];
      let ordr = args[4];

      // WARNING: non-general handling of order
      if (!(ordr in [0, 1])) throw "invalid order";
      let n1 = this.nodes[id1];
      let n2 = this.nodes[id2];

      // extract the proper link given input data
      let a1 = null;
      let a2 = null;
      if (ordr==0) {
        a1 = n1.getAnchor(idx1, 1);
        a2 = n2.getAnchor(idx2, 0);
      } else if (ordr==1) {
        a1 = n1.getAnchor(idx1, 3);
        a2 = n2.getAnchor(idx2, 2);
      } else throw "extra-binary order connections not implemented"

      // connect
      if (this.truth.canConnect(a1, a2)) {
        let linkClass = this.truth.getLinkClass(a1);
        let l = new linkClass(a1, a2)
        this.graphData.addLink(l);
        this.truth.updateNodeState(a1.owner);
        this.truth.updateNodeState(a2.owner);
      }
      return [["link_add"].concat(args), ["link_rm"].concat(args)];
    }
    else if (command=="link_rm") {
      let id1 = args[0];
      let idx1 = args[1];
      let id2 = args[2];
      let idx2 = args[3];
      let ordr = args[4];

      // 1) get the anchors of the link
      if (!(ordr in [0, 1])) throw "invalid order";
      let n1 = this.nodes[id1];
      let n2 = this.nodes[id2];

      let a1 = null;
      let a2 = null;
      if (ordr==0) {
        a1 = n1.getAnchor(idx1, 1);
        a2 = n2.getAnchor(idx2, 0);
      } else if (ordr==1) {
        a1 = n1.getAnchor(idx1, 3);
        a2 = n2.getAnchor(idx2, 2);
      } else throw "extra-binary order connections not implemented"

      // 2) get the link given the anchors
      let l = null;
      for (var i=0;i<n1.gNode.links.length;i++) {
        l = n1.gNode.links[i];
        // search for the right l
        if ((l.d1 == a1) && (l.d2 == a2)) break;
      }
      // 3) remove l!
      if (!l) throw "could not find link to remove!"
      n1.gNode.rmLink(l);
      n2.gNode.rmLink(l);
      this.graphData.rmLink(l);

      return [["link_rm"].concat(args), ["link_add"].concat(args)];
    }
    else if (command=="node_label") {
      let id = args[0];
      let label = args[1];
      let n = this.nodes[id];
      let prevlbl = n.label;
      n.label = label;
      // check that the change was commited before continuing - or return null
      if (n.label != label) return null
      this.draw.drawAll();
      return [["node_label", id, label], ["node_label", id, prevlbl]];
    }
    else if (command=="node_data") {
      if (!isString(args[1])) {
        console.log(args);
        throw "arg[1] must be a string";
      }

      let id = args[0];
      let data_str = args[1];
      let n = this.nodes[id];
      let prevdata_str = JSON.stringify(n.obj);

      // apply data only if node is not static
      if (n.static == false) {
        n.obj = JSON.parse(data_str);
        this.truth.updateNodeState(n.gNode);
        this.draw.drawAll();
        return [["node_data", id, data_str], ["node_data", id, prevdata_str]];
      }
      return null;
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
    this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
  }
  node_rm(id) {
    // str
    if (this.lock == true) { console.log("node_rm call during lock"); return -1; }
    let cmd_rev = this._command(["node_rm", id]);
    this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
  }
  node_label(id, label) {
    // str, str
    if (this.lock == true) { console.log("node_label call during lock"); return -1; }
    let cmd_rev = this._command(["node_label", id, label]);
    if (cmd_rev) {
      this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
    }
  }
  node_data(id, data) {
    // str, str
    if (this.lock == true) { console.log("node_data call during lock"); return -1; }
    let cmd_rev = this._command(["node_data", id, data]);
    if (cmd_rev) {
      this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
    }
  }
  link_add(id1, idx1, id2, idx2, ordr=0) {
    // str, int, str, int, int
    if (this.lock == true) { console.log("link_add call during lock"); return -1; }
    let cmd_rev = this._command(["link_add", id1, idx1, id2, idx2, ordr]);
    this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
  }
  link_rm(id1, idx1, id2, idx2, ordr=0) {
    // str, int, str, int, int
    if (this.lock == true) { console.log("link_rm call during lock"); return -1; }
    let cmd_rev = this._command(["link_rm", id1, idx1, id2, idx2, ordr]);
    this.undoredo.newdo(cmd_rev[0], cmd_rev[1]);
  }
}

class UndoRedoCommandStack {
  constructor(maxSize=50) {
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
  constructor(selectConfCB) {
    this.menus = [];
    this.root = d3.select("#graph_menu");
    this.selectConfCB = selectConfCB;

    let address = null;
    let conf = null;
    let c = null;
    for (var i=0; i<nodeAddresses.length; i++) {
      address = nodeAddresses[i];
      conf = nodeTypeRead(address);
      c = cloneConf(conf);
      this.createMenuItem(c);
    }
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
    let n = ConnectionTruthMcWeb.createNodeObjectFromConf(conf, "", 50, 50);
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
