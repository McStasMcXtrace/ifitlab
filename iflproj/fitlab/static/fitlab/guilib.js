/*
* A nodespeak compatible graph ui using d3.js for drawing and force layouts.
*
* Written by Jakob Garde 2018.
*/

/*
* Generic Utility functions and types
*/

function remove(lst, element) {
  let index = lst.indexOf(element);
  if (index > -1) {
    lst.splice(index, 1);
  }
}
function isString(value) {
  let b1 = (typeof value === 'string' || value instanceof String);
  return b1;
}


/*
* Node types json utility
*/

function nodeTypeRead(address) {
  // reads and returns an item from a TreeJsonAddr, given a dot-address
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


/*
* Graphics Node, Anchor and Link types
*/
const nodeRadius = 30;
const extensionLength = 40;
const anchSpace = 40;
const arrowHeadLength = 12;
const arrowHeadAngle = 25;

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

function getInputAngles(num) {
  // .reverse()'d into left-to-right ordering in the return list
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
function getOutputAngles(num) {
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

class GraphicsNode {
  // graphical base type - this will not draw, but should be subclassed
  constructor(owner, label, x, y) {
    this.owner = owner;
    this.label = label;
    this._x = x;
    this._y = y;

    this.anchors = null;
    this.r = nodeRadius;
    this.colliderad = this.r;

    this.centerAnchor = new CenterAnchor(this);
    this.state = NodeState.DISCONNECTED;
    this.active = false;

    this.colour = "black";
  }
  setAnchors(anchors) {
    if (this.anchors) throw "anchors only intended to be set once";
    this.anchors = anchors;
  }
  get x() {
    return this._x;
  }
  set x(value) {
    this._x = value;
  }
  get y() {
    return this._y;
  }
  set y(value) {
    this._y = value;
  }
  // level means itypes/otypes == 0/1
  getAnchor(idx, level) {
    if (idx == -1) return this.centerAnchor;

    let a = null;
    for (var i=0;i<this.anchors.length;i++) {
      a = this.anchors[i];
      if (a.idx==idx && (!a.i_o | 0) == level)
        return a;
    }
    throw "could not get anchor: ", idx, level;
  }
  hasCenterConnection() {
    return this.centerAnchor.numconnections >= 1;
  }
  draw(branch, i) {
    return branch
      .attr('stroke', ()=>{ return this.colour; })
      .classed(getNodeStateClass(this.state), true)
  }
  // hooks for higher level nodes
  onConnect(link, isInput) {}
  onDisconnect(link, isInput) {}
  setOutputAncorTypes(anchorTypes) {
    let anchors = this.anchors;
    let a = null;
    let oanchors = anchors.filter(a => !a.i_o);
    for (var j=0;j<oanchors.length;j++) {
      a = oanchors[j];
      a.type = anchorTypes[j];
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
      .attr('fill', "none")
      .lower()
    branch
      .append('circle')
      .attr('r', this.r)
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
    this.colliderad = 1.07 * this.r;

    this._x = x;
    this._Y = y;
    this._attach = null;
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
  get x() {
    if (this._attach == null) {
      return this._x;
    } else {
      return this._x + this._attach.x;
    }
  }
  set x(value) {
    if (this._attach == null) {
      this._x = value;
    } else {
      return;
    }
  }
  get y() {
    if (this._attach == null) {
      return this._y;
    } else {
      return this._y + this._attach.y;
    }
  }
  set y(value) {
    if (this._attach == null) {
      this._y = value;
    } else {
      return;
    }
  }
  attachMoveToCenterLink(link) {
    if (link.d1.owner.owner.basetype == "method") this._attach = link.d2.owner;
    if (link.d2.owner.owner.basetype == "method") this._attach = link.d1.owner;
    if (this._attach == null) return;

    this._x = this._x - this._attach.x;
    this._y = this._y - this._attach.y;
  }
  detachMove() {
    if (this._attach == null) return;
    this._x = this._x + this._attach.x;
    this._y = this._y + this._attach.y;
    this._attach = null;
  }
}

class GraphicsNodeFluffy extends GraphicsNode {
  constructor(owner, label, x, y) {
    super(owner, label, x, y);
    this.numfluff = 14;
    this.fluffrad = 7;
    this.r = 1.05 * nodeRadius;
    this.colliderad = this.r;
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

class GraphicsNodeFluffySmall extends GraphicsNode {
  constructor(owner, label, x, y) {
    super(owner, label, x, y);
    this.numfluff = 5;
    this.fluffrad = 7;
    this.r = 0.5 * nodeRadius;
    this.colliderad = 0.7 * nodeRadius;

    this._attachAnch = null;
    this._localx = 20;
    this._localy = -40;
  }
  get x() {
    if (this._attachAnch == null) return this._x;
    return this._localx + this._attachAnch.x;
  }
  set x(value) {
    if (this._attachAnch == null) this._x = value;
  }
  get y() {
    if (this._attachAnch == null) return this._y;
    return this._localy + this._attachAnch.y;
  }
  set y(value) {
    if (this._attachAnch == null) this._y = value;
  }
  attachMoveTo(d) {
    this._attachAnch = d;
    this._localx = d.localx*2;
    this._localy = d.localy*2;
  }
  detachMove() {
    this._attachAnch = null;
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
    this.colliderad = 1.1 * this.r;
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

class Anchor {
  // connection anchor point fixed on a node at a circular periphery
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
    this.type = type;
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

class AnchorCircularNoext extends Anchor {
  constructor(owner, angle, type, parname, i_o, idx) {
    super(owner, angle, type, parname, i_o, idx);
    this.localx = owner.r * Math.cos(this.angle/360*2*Math.PI);
    this.localy = - this.owner.r * Math.sin(this.angle/360*2*Math.PI); // svg inverted y-axis
    this.ext = new ExtensionAnchor(owner, this.localx, this.localy);
  }
}

class AnchorSquare extends Anchor {
  constructor(owner, angle, type, parname, i_o, idx) {
    super(owner, angle, type, parname, i_o, idx);
    this.localx = owner.r * Math.cos(this.angle/360*2*Math.PI);
    this.localy = - this.owner.r * Math.sin(this.angle/360*2*Math.PI); // svg inverted y-axis

    if (0 <= angle && angle < 360/8) {
      this.localx = owner.r;
      this.localy = -owner.r * Math.tan(angle/180*Math.PI);
    }
    else if (360/8 <= angle && angle < 3*360/8) {
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

class ExtensionAnchor {
  // a "path helper" radial extension to Anchor
  constructor(owner, localx, localy) {
    this.owner = owner; // this is the node, not the anchor
    this.vx = 0;
    this.vy = 0;
    this.localx = localx;
    this.localy = localy;
    this.type = "ExtensionAnchor";
  }
  get x() { return this.owner.x + this.localx; }
  set x(value) { /* empty:)) */ }
  get y() { return this.owner.y + this.localy; }
  set y(value) { /* empty:)) */ }
}

class PathAnchor {
  constructor(x, y, owner) {
    this.owner = owner; // this must be a link object
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.type = "PathAnchor";
  }
}

class CenterAnchor {
  // Placed at Node centers, used to provide a static charge for path layout simulations.
  // Also used for drawing method connections.
  constructor(owner) {
    this.owner = owner;
    this.vx = 0;
    this.vy = 0;
    this.idx = -1; // this default index of -1 will accomodate the link_add interface
    this.type = "CenterAnchor";
    this.numconnections = 0;
  }
  get x() { return new Number(this.owner.x); }
  set x(value) { /* empty:)) */ }
  get y() { return new Number(this.owner.y); }
  set y(value) { /* empty:)) */ }
}

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
  // becomes a single line
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
  // becoes a double line
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

class LinkCenter extends Link {
  // becomes a straight double line
  constructor(d1, d2) {
    super(d1, d2);
  }
  recalcPathAnchors() {}
  getAnchors() { return [this.d1, this.d2]; }
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


/*
* Base/Abstract Node types
*/

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
    this.executable = typeconf.executable != "false";
    this.edit = typeconf.edit != "false";
    this.docstring = typeconf.docstring;

    // craete the GraphicsNode
    let nt = this._getGNType();
    this.gNode = new nt(this, label, x, y);

    let iangles = getInputAngles(typeconf.itypes.length);
    let oangles = getOutputAngles(typeconf.otypes.length);

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

class NodeMethod extends Node {
  static get basetype() { return "method"; }
  get basetype() { return NodeMethod.basetype; }
  static get prefix() { return "m"; }
  constructor(x, y, id, name, label, typeconf) {
    super(x, y, id, name, label, typeconf);
  }
  _getGNType() {
    return GraphicsNodeHexagonal;
  }
  _getAnchorType() {
    return AnchorCircular;
  }
  isConnected(connectivity) {
    return connectivity.indexOf(false) == -1 && this.gNode.hasCenterConnection();
  }
  isActive() {
    // assumed to be associated with an underlying function object
    return true;
  }
  onConnect(link, isInput) {
    let gateKept = ["object", "object_idata", "object_ifunc", "method"];
    let t1 = gateKept.indexOf(link.d1.owner.owner.basetype) != -1;
    let t2 = gateKept.indexOf(link.d2.owner.owner.basetype) != -1;
    let t3 = link.d1.idx == -1 && link.d2.idx == -1;
    if (t1 && t2 && t3 && !isInput) {
      this.gNode.attachMoveToCenterLink(link);
    }
  }
  onDisconnect(link, isInput) {
    this.gNode.detachMove();
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
    return GraphicsNodeFluffySmall;
  }
  _getAnchorType() {
    return AnchorCircularNoext;
  }
  isConnected(connectivity) {
    if (connectivity.length > 0) {
      return connectivity[0];
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
  isActive() {
    let val = this.obj != null && this.userdata != null;
    return val;
  }
  get label() {
    return this.gNode.label;
  }
  set label(value) {
    // just ignore external set-label calls
  }
  onConnect(link, isInput) {
    this.gNode.attachMoveTo(link.d2);
    link.recalcPathAnchors();
  }
  onDisconnect(link, isInput) {
    this.gNode.detachMove();
  }
}

/*
* Connection Rules
*/
class ConnectionRulesBase {
  // defines the interface of ConnectionRules derivations
  static canConnect(a1, a2) {}
  static couldConnect(a1, a2) {}
}

/*
* GraphTree types
*
* The GraphTree is a data structure for storing nodes, which incapsulates
* the specific node types and graphics implementations to a large extent,
* exposing an abstract, id-based, interface to the nodes and their links.
*/
class NodeTypeHelper {
  // node construction helper functions
  constructor() {
    this.idxs = {};
  }
  static _nodeClasses() {
    return [
      NodeObject,
      NodeObjectLiteral,
      NodeFunction,
      NodeFunctionNamed,
      NodeMethodAsFunction,
      NodeMethod,
      NodeIData,
      NodeIFunc
    ];
  }
  getId(basetype, existingids) {
    let prefix = null;
    let id = null;

    let classes = NodeTypeHelper._nodeClasses();
    let prefixes = classes.map(name => name.prefix);
    let basetypes = classes.map(name => name.basetype);
    let i = basetypes.indexOf(basetype);
    if (i >= 0) prefix = prefixes[i]; else throw "NodeTypeHelper.getId: unknown basetype";

    if (prefix in this.idxs)
      id = prefix + (this.idxs[prefix] += 1);
    else
      id = prefix + (this.idxs[prefix] = 0);
    while (existingids.indexOf(id)!=-1) {
      if (prefix in this.idxs)
        id = prefix + (this.idxs[prefix] += 1);
      else
        id = prefix + (this.idxs[prefix] = 0);
    }
    return id;
  }
  static createNode(x, y, id, typeconf) {
    // get node class
    let cls = null
    let nodeclasses = NodeTypeHelper._nodeClasses();
    let basetypes = nodeclasses.map(cn => cn.basetype);
    let i = basetypes.indexOf(typeconf.basetype);
    if (i >= 0) cls = nodeclasses[i]; else throw "unknown typeconf.basetype: " + typeconf.basetype;

    // create the node
    // TODO: simplify this constructor
    let n = new cls(x, y, id,
      typeconf.name, // get rid of
      typeconf.label, // get rid of
      typeconf,
    );

    // TODO: move this into the Node constructor
    if (typeconf.data) {
      n.userdata = typeconf.data;
    }
    return n;
  }
}

class GraphTreeBranch {
  // unit level of the graph tree
  constructor(parent=null) {
    // tree
    this.parent = parent
    this.children = {} // corresponding rootnode instances are stored in .nodes
    // graph
    this.nodes = {}
    this.links = {}
  }
}

class GraphTree {
  // a node graph with vertical/tree potential
  constructor(connrules) {
    this._connrules = connrules;
    this._helper = new NodeTypeHelper();
    this._current = new GraphTreeBranch();
    this._viewLinks = [];
    this._viewNodes = [];
    this._viewForceLinks = [];
    this._viewAnchors = [];
    this._selectedNode = null;
  }

  // **********************************************
  // get interface - returns high-level information
  // **********************************************

  // returns a list of id's
  getNeighbours(id) {
    if (!this._current.links[id]) {
      return [];
    }
    let nbs = [];
    for (let id2 in this._current.links[id]) {
      if (this._current.links[id][id2].length > 0) nbs.push(id2);
    }
    return nbs;
  }
  // returns a list of [id1, idx1, id2, idx2] sequences
  getLinks(id) {
    if (!this._current.links[id]) {
      return [];
    }
    let lks = this._current.links;
    let seqs = [];
    let lst = null;
    let l = null
    for (let id2 in lks[id]) {
      lst = lks[id][id2];
      for (var j=0;j<lst.length;j++) {
        l = lst[j];
        seqs.push([l.d1.owner.owner.id, l.d1.idx, l.d2.owner.owner.id, l.d2.idx]);
      }
    }
    return seqs;
  }
  getExitLinks(id) {
    return this.getLinks(id).filter(cmd=>cmd[0]==id);
  }
  // returns a node object or null
  getNode(id) {
    let n = this._current.nodes[id]
    if (!n) return null;
    return n;
  }
  // graphdraw interface (low-level) - return lists of graphics-level objects
  getLinkObjs() {
    return this._viewLinks;
  }
  getGraphicsNodeObjs() {
    return this._viewNodes.map(n=>n.gNode);
  }
  getAnchors() {
    this._updateAnchors();
    return this._viewAnchors;
  }
  getForceLinks() {
    this._updateAnchors();
    return this._viewForceLinks;
  }
  _updateAnchors() {
    let links = this._viewLinks;
    let nodes = this._viewNodes;

    this._viewAnchors = [];
    this._viewForceLinks = [];
    for (let j=0;j<links.length;j++) {
      let lanchs = links[j].getAnchors();
      let fl = null;

      for (let i=0;i<lanchs.length;i++) {
        this._viewAnchors.push(lanchs[i]);
        if (i > 0) {
          fl = { 'source' : lanchs[i-1], 'target' : lanchs[i], 'index' : null }
          this._viewForceLinks.push(fl);
        }
      }
    }
    let g = null;
    for (let i=0;i<nodes.length;i++) {
      g = nodes[i].gNode;
      let anchors = g.anchors.concat(g.centerAnchor);
      this._viewAnchors = this._viewAnchors.concat(anchors);
    }
  }
  getAnchorsAndForceLinks(id) {
    // get anchors and forcelinks associated with a certain node
    let n = this._current.nodes[id];
    if (!n) return [[], []];

    let anchors = n.gNode.anchors.concat(n.gNode.centerAnchor);
    let forcelinks = [];

    let links = this._viewLinks.filter(l=>l.d1.owner.owner.id==id || l.d2.owner.owner.id==id);
    for (let j=0;j<links.length;j++) {
      let lanchs = links[j].getAnchors();
      let fl = null;

      for (let i=0;i<lanchs.length;i++) {
        anchors.push(lanchs[i]);
        if (i > 0) {
          fl = { 'source' : lanchs[i-1], 'target' : lanchs[i], 'index' : null }
          forcelinks.push(fl);
        }
      }
    }
    return [anchors, forcelinks];
  }

  // **************************
  // ui and graphdraw interface
  // **************************

  recalcPathAnchorsAroundNodeObj(g) {
    // called before anchors are used, triggers link.recalcPathAnchors
    let id = g.owner.id;
    let lks = [];
    for (let id2 in this._current.links[id]) {
      lks = lks.concat(this._current.links[id][id2]);
    };
    for (let i=0;i<lks.length;i++) {
      lks[i].recalcPathAnchors();
    }
  }
  getSelectedNode() {
    return this._selectedNode;
  } // perhaps: return a NodeRepr, not an Node obj?
  setSelectedNode(id) {
    let prev = this._selectedNode;
    if (prev) prev.gNode.active = false;

    if (!id) this._selectedNode = null;
    let n = this._current.nodes[id];
    if (!n) return null;

    n.gNode.active = true;
    this._selectedNode = n;
  }

  // set interface / _command impls
  // safe calls that return true on success
  nodeAdd(x, y, conf, id=null) {
    // will throw an error if the requested id already exists, as this should not happen
    if ((id == '') || !id || (id in this._current.nodes))
      id = this._helper.getId(conf.basetype, Object.keys(this._current.nodes));
    let n = NodeTypeHelper.createNode(x, y, id, conf);
    if (n) {
      this._viewNodes.push(n);
      this._current.nodes[id] = n;
    }
    else throw "could not create node of id: " + id
    return id;
  }
  nodeRm(id) {
    if (!(id in this._current.nodes)) return null;
    if (this.getNeighbours(id).length > 0) return null;
    remove(this._viewNodes, this._current.nodes[id]);
    delete this._current.nodes[id];
    return true;
  }
  linkAdd(addr1, idx1, addr2, idx2) {
    if (addr1.indexOf('.') != -1 && addr2.indexOf('.') != -1) throw "inter-level links not implemented: " + addr1 + ', ' + addr2;

    // get nodes
    let id1 = addr1;
    let id2 = addr2;
    let n1 = this._current.nodes[id1];
    let n2 = this._current.nodes[id2];
    if (!n1 || !n2) return null;

    // get anchors to be connected
    let a1 = n1.gNode.getAnchor(idx1, 1);
    let a2 = n2.gNode.getAnchor(idx2, 0);

    // check connection rules
    // NOTE: checks to avoid duplicate links must be implemented in canConnect
    if (!this._connrules.canConnect(a1, a2)) return null;

    // create link object
    let l = null;
    if (idx1 == -1 && idx2 == -1) {
      l = new LinkCenter(a1, a2);
    }
    else l = new LinkSingle(a1, a2);
    this._viewLinks.push(l);
    // store link object in connectivity structure, which may have to be updated
    let lks = this._current.links;
    if (!lks[id1]) { lks[id1] = {}; }
    if (!lks[id1][id2]) { lks[id1][id2] = []; }
    if (!lks[id2]) { lks[id2] = {}; }
    if (!lks[id2][id1]) { lks[id2][id1] = []; }
    lks[id1][id2].push(l);
    lks[id2][id1].push(l);

    // update
    this.updateNodeState(n1);
    this.updateNodeState(n2);
    n1.gNode.onConnect(l, false);
    let isinput = true;
    if (idx1 == -1 && idx2 == -1) isinput = false; // center-link targets
    n2.gNode.onConnect(l, isinput);
    return true;
  }
  linkRm(addr1, idx1, addr2, idx2) {
    if (addr1.indexOf('.') != -1 && addr2.indexOf('.') != -1) throw "inter-level links not implemented: " + addr1 + ', ' + addr2;

    let id1 = addr1;
    let id2 = addr2;
    let n1 = this._current.nodes[id1];
    let n2 = this._current.nodes[id2];
    if (!n1 || !n2) return null;

    // fetch stored link object
    let l = null;
    let lks = this._current.links;
    try {
      // NOTE: l1 and l2 are in fact lists of links, not links
      let l1 = lks[id1][id2];
      let l2 = lks[id2][id1];
      // l1 and l2 may not have been assigned
      if (!l1 && !l2) return null;
      // l1 and l2 may have been assigned then emptied
      l1 = l1.filter(l => l.d1.idx==idx1 && l.d2.idx==idx2);
      l2 = l2.filter(l => l.d1.idx==idx1 && l.d2.idx==idx2);
      if (l1.length == 0 && l2.length ==0 ) return null;
      // idx-filtered l1 and l2 must never be different
      if (l2[0] != l2[0]) throw "error";
      // object found
      l = l1[0];
    }
    catch (e) {
      throw "internal link data inconsistency";
    }

    // remove and detatch
    remove(this._viewLinks, l);
    remove(lks[id1][id2], l);
    remove(lks[id2][id1], l);
    l.detatch();

    // update
    this.updateNodeState(n1);
    this.updateNodeState(n2);
    n1.gNode.onDisconnect(l, false);
    n2.gNode.onDisconnect(l, true);
    return true;
  }
  nodeLabel(id, label) {
    let n = this._current.nodes[id];
    if (!n) return null;
    n.label = label;
    return true;
  }
  nodeData(id, data_str) {
    let n = this._current.nodes[id];
    n.userdata = JSON.parse(data_str);
    this.updateNodeState(n);
    return true;
  }

  _link2Params(l) {
    return [l.d1.owner.id, l.d1.idx, l.d2.owner.id, l.d2.idx];
  }
  _connectivity(n) {
    let connectivity = [];
    let anchors = n.gNode.anchors;
    let a = null;
    for (var j=0; j<anchors.length; j++) {
      a = anchors[j];
      connectivity.push(a.numconnections>0);
    }
    return connectivity;
  }
  updateNodeState(n) {
    let conn = this._connectivity(n);
    if (n.isActive()) {
      n.gNode.state = NodeState.ACTIVE;
    }
    else if (!n.isConnected(conn)){
      n.gNode.state = NodeState.DISCONNECTED;
    }
    else {
      n.gNode.state = NodeState.PASSIVE;
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
    let lk_keys = [];
    let n = null;
    for (let key in this._current.nodes) {
      n = this._current.nodes[key];

      // NODES
      nodes[n.id] = [n.gNode.x, n.gNode.y, n.id, n.name, n.label, n.address];

      // DATA
      if (['object_literal', 'function_named', 'method_as_function', 'method'].indexOf(n.basetype) != -1)
        datas[n.id] = btoa(JSON.stringify(n.userdata));

      // EXIT-LINKS BY NODE
      links[n.id] = [];
      let elks = this.getExitLinks(n.id);
      let cmd = null;
      for (var j=0;j<elks.length;j++) {
        cmd = elks[j];
        links[n.id].push([cmd[0], cmd[1], cmd[2], cmd[3]]);
      }
    }
    let def_text = JSON.stringify(def);
    //console.log(JSON.stringify(def, null, 2));
    console.log(def_text);
    return def_text;
  }
  getCoords() {
    let coords = {};
    let n = null;
    for (let key in this._current.nodes) {
      n = this._current.nodes[key];
      coords[key] = [n.gNode.x, n.gNode.y];
    }
    return coords;
  }
}
