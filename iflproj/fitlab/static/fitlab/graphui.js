//
// Graph-based user interface. Uses d3.js for svg manipulation.
//
// Written by Jakob Garde 2017-2019.
//


// utility

function remove(lst, element) {
  // removes an element from a list
  let index = lst.indexOf(element);
  if (index > -1) {
    lst.splice(index, 1);
  }
}
function isString(value) {
  // checks if value is a string
  let b1 = (typeof value === 'string' || value instanceof String);
  return b1;
}

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
function nodeTypeReadTree(address, tree) {
  // reads and returns an item from a TreeJsonAddr, given a dot-address
  let branch = tree;
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
    throw "no item found at address: " + key;
  }
}
function cloneConf(conf) {
  return Object.assign({}, conf);
}


//
// Graphics Nodes, Anchor and Link types
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
function getNodeStateCSSClass(state) {
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

const nodeRadius = 30;
const extensionLength = 40;
const anchSpace = 40;
const arrowHeadLength = 12;
const arrowHeadAngle = 25;

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
      .classed(getNodeStateCSSClass(this.state), true)
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

class GraphicsNodeDiamond extends GraphicsNode {
  constructor(owner, label, x, y) {
    super(owner, label, x, y);
    this.r = 0.85 * nodeRadius; // this is now the half height/width of the square
  }
  draw(branch, i) {
    let r = 1.2 * this.r;
    let alpha;
    let points = [];
    for (i=0; i<4; i++) {
      alpha = i*Math.PI*2/4;
      points.push( {x : r*Math.cos(alpha), y : - r*Math.sin(alpha) } );
    }
    // return path to starting point
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
    // return path to starting point
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

// Link types are always "graphics links" although they are registered equivalently
// to the "base" or conceptual type nodes, not the graphics classes.
class Link {
  constructor(d1, d2) {
    this.d1 = d1;
    this.d2 = d2;
    this.pathAnchors = [];
    this.recalcPathAnchors();

    d1.numconnections += 1;
    d2.numconnections += 1;
  }
  static get basetype() { throw "Link: basetype property must be overridden"; }
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
  static get basetype() { return "link_single"; }
  get basetype() { return LinkSingle.basetype; }
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
  static get basetype() { return "link_double"; }
  get basetype() { return LinkDouble.basetype; }
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

class LinkStraight extends Link {
  // becomes a single straight line
  static get basetype() { return "link_straight"; }
  get basetype() { return LinkStraight.basetype; }
  recalcPathAnchors() { /* don't */ }
  getAnchors() { return [this.d1, this.d2]; }
  draw(branch, i) {
    let anchors = this.getAnchors();
    return branch
      .append('path')
      .datum(anchors)
      .attr("class", "arrow")
      .attr('d', d3.line()
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
        .x( function(p) { return p.x; } )
        .y( function(p) { return p.y; } )
      );
  }
}

class LinkDoubleCenter extends Link {
  // becomes a straight double line
  constructor(d1, d2) {
    super(d1, d2);
  }
  static get basetype() { return "link_double_center"; }
  get basetype() { return LinkDoubleCenter.basetype; }
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


//
// Base/Abstract Node types.
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


//
// Connection Rules determine how and if nodes can be connected.
// Keep free of node and link class names, use aliases known as
// "basetype" instead.
//
class ConnectionRulesBase {
  // can anchors be directly connected?
  static canConnect(a1, a2) {}
  // could anchors be connected if they were free of current links?
  static couldConnect(a1, a2) {}
  // get appropriate base type of link between anchors
  static getLinkBasetype(a1, a2) {}
}

class NodeLinkConstrucionHelper {
  // Node and Link construction helper functions.
  // Registers object types and pairs the types with their aliases.
  static getId(basetype, existingids) {
    let prefix = null;
    let id = null;
    let nclss = NodeLinkConstrucionHelper._nodeclasses;
    let idxs = NodeLinkConstrucionHelper._idxs;

    let prefixes = nclss.map(name => name.prefix);
    let basetypes = nclss.map(name => name.basetype);
    let i = basetypes.indexOf(basetype);
    if (i >= 0) prefix = prefixes[i]; else throw "NodeLinkConstrucionHelper.getId: unknown basetype";

    if (prefix in idxs)
      id = prefix + (idxs[prefix] += 1);
    else
      id = prefix + (idxs[prefix] = 0);
    while (existingids.indexOf(id)!=-1) {
      if (prefix in idxs)
        id = prefix + (idxs[prefix] += 1);
      else
        id = prefix + (idxs[prefix] = 0);
    }
    return id;
  }
  static createNode(x, y, id, typeconf) {
    // get node class
    let cls = null
    let nclss = NodeLinkConstrucionHelper._nodeclasses;
    let basetypes = nclss.map(cn => cn.basetype);
    let i = basetypes.indexOf(typeconf.basetype);
    if (i >= 0) cls = nclss[i];
    else throw "unknown typeconf.basetype: " + typeconf.basetype;

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
  static createLink(a1, a2, link_basetype) {
    let lclss = NodeLinkConstrucionHelper._linkclasses;
    let basetypes = lclss.map(cn => cn.basetype);
    let i = basetypes.indexOf(link_basetype);
    if (i < 0) throw "unknown typeconf.basetype: " + link_basetype;
    let lcls = lclss[i];
    return new lcls(a1, a2);
  }
  // node registration mechanism
  static register_node_class(cls) {
    NodeLinkConstrucionHelper._nodeclasses.push(cls);
  }
  static register_link_class(cls) {
    NodeLinkConstrucionHelper._linkclasses.push(cls);
  }
}
// static members - this class is a singleton after all
NodeLinkConstrucionHelper._idxs = {};
NodeLinkConstrucionHelper._nodeclasses = [];
NodeLinkConstrucionHelper._linkclasses = [];


// register node types
NodeLinkConstrucionHelper.register_node_class(NodeObject);
NodeLinkConstrucionHelper.register_node_class(NodeObjectLiteral);
NodeLinkConstrucionHelper.register_node_class(NodeFunction);
NodeLinkConstrucionHelper.register_node_class(NodeFunctionNamed);
NodeLinkConstrucionHelper.register_node_class(NodeMethodAsFunction);
NodeLinkConstrucionHelper.register_node_class(NodeMethod);


// register link types
NodeLinkConstrucionHelper.register_link_class(LinkSingle);
NodeLinkConstrucionHelper.register_link_class(LinkStraight);
NodeLinkConstrucionHelper.register_link_class(LinkDouble);
NodeLinkConstrucionHelper.register_link_class(LinkDoubleCenter);


//
// GraphTree is a data structure for storing nodes, which incapsulates
// the specific node types and graphics implementations to a large extent,
// exposing an abstract, id-based, interface to the nodes and their links.
//
class GraphTreeBranch {
  constructor(parent=null) {
    // tree
    this.parent = parent
    this.children = {} // node instances are stored in .nodes
    // graph
    this.nodes = {}
    this.links = {}
  }
}

class GraphTree {
  constructor(connrules) {
    this._connrules = connrules;
    this._current = new GraphTreeBranch();
    this._viewLinks = [];
    this._viewNodes = [];
    this._viewForceLinks = [];
    this._viewAnchors = [];
    this._selectedNode = null;
  }

  // get interface, returns high-level information
  getNeighbours(id) {
    // returns a list of id's
    if (!this._current.links[id]) {
      return [];
    }
    let nbs = [];
    for (let id2 in this._current.links[id]) {
      if (this._current.links[id][id2].length > 0) nbs.push(id2);
    }
    return nbs;
  }
  getLinks(id) {
    // returns a list of [id1, idx1, id2, idx2] sequences
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
  getNode(id) {
    // returns a node object or null
    let n = this._current.nodes[id]
    if (!n) return null;
    return n;
  }

  // graphdraw interface (low-level), return lists of graphics-level objects
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

  // ui and graphdraw interface
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
  }
  setSelectedNode(id) {
    let prev = this._selectedNode;
    if (prev) prev.gNode.active = false;

    if (!id) this._selectedNode = null;
    let n = this._current.nodes[id];
    if (!n) return null;

    n.gNode.active = true;
    this._selectedNode = n;
  }

  // set interface / _command impls, safe calls that return non-null on success
  nodeAdd(x, y, conf, id=null) {
    // will throw an error if the requested id already exists, as this should not happen
    if ((id == '') || !id || (id in this._current.nodes))
      id = NodeLinkConstrucionHelper.getId(conf.basetype, Object.keys(this._current.nodes));
    let n = NodeLinkConstrucionHelper.createNode(x, y, id, conf);
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

    // use helpers to create link object
    if (!this._connrules.canConnect(a1, a2)) throw "requested link creation was against the rules"; // double check this
    let lbtpe = this._connrules.getLinkBasetype(a1, a2);
    let l = NodeLinkConstrucionHelper.createLink(a1, a2, lbtpe);

    // add link to viewed objects
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
    // DB: handy
    //console.log(JSON.stringify(def, null, 2));
    //console.log(def_text);
    return def;
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


// *************************************
// Higher level classes below this line.
// *************************************

// global setting
const anchorRadius = 6; // required by the copy-pasta of nodetypemenu


class LinkHelper {
  // Helper line shown while users drag to connect.
  // TODO: FIX LinkHelper to check for self-destruction at every mouse move, use
  // mouse state as a determinant.
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


function fireEvents(lst, sCaller, ...args) {
  // Utility function to help listener interfaces.
  let f = null;
  for (i=0;i<lst.length;i++) {
    f = lst[i];
    try {
      f(...args);
    }
    catch(error) {
      console.log("fail calling " + sCaller + " listener: ", error);
    }
  }
}


class GraphLayout {
  // layout simulation delegate
  constructor(updateCB, getNodes, getAnchors, getForceLinks, getAnchorsAndForceLinks) {
    // layout settings
    this._pathChargeStrength = -10;
    this._distanceChargeStrength = -10;
    this._pathLinkStrength = 1;
    this._distance = 20;

    // this is the (only and only) graphics redraw requred by layout sims
    this.updateCB = updateCB;
    this.getNodes = getNodes;
    this.getAnchors = getAnchors;
    this.getForceLinks = getForceLinks;
    this.getAnchorsAndForceLinks = getAnchorsAndForceLinks;

    // force layout simulations
    this.collideSim = d3.forceSimulation()
      .force("collide",
        d3.forceCollide( function(d) { return d.colliderad; } )
      )
      .stop()
      .on("tick", this.updateCB);
    this.centeringSim = d3.forceSimulation()
      .force("centering",
        d3.forceCenter(0, 0)
      )
      .stop()
      .on("tick", this.updateCB);
    this.pathSim = d3.forceSimulation()
      .force("link",
        d3.forceLink()
          .strength(this._pathLinkStrength)
          .distance( function(d) { return this._distance; }.bind(this) )
      )
      // force to keep links out of node centers and anchors
      .force("pathcharge",
        d3.forceManyBody()
          .strength(this._pathChargeStrength)
      )
      .stop()
      .on("tick", this.updateCB);
    this.distanceSim = null;
  }
  beforeChange() {
    let nodes = this.getNodes();
    let anchors = this.getAnchors();
    this.collideSim.stop();
    this.collideSim.nodes(nodes);
    this.collideSim.alpha(1).restart();
    // path anchors go into the center-sim only
    this.centeringSim.stop();
    this.centeringSim.nodes(nodes.concat(anchors));
    this.centeringSim.alpha(1).restart();

  }
  afterChangeDone(gNode=null) {
    let nodes = this.getNodes();
    let anchors = null;
    let forceLinks = null;
    if (gNode == null) {
      anchors = this.getAnchors();
      forceLinks = this.getForceLinks();
    }
    else {
      let tmp = this.getAnchorsAndForceLinks(gNode);
      anchors = tmp[0];
      forceLinks = tmp[1];
    }

    // the charge force seems to have to reset like this for some reason
    this.distanceSim = d3.forceSimulation(nodes)
      .force("noderepulsion",
        d3.forceManyBody()
          .strength(this._distanceChargeStrength)
          .distanceMin(0)
          .distanceMax(75))
      .stop()
      .on("tick", this.updateCB);
    this.distanceSim.stop();
    this.distanceSim.alpha(1).restart();

    this.pathSim.stop();
    this.pathSim.nodes(anchors);
    this.pathSim.force("link").links(forceLinks);
    this.pathSim.alpha(1);
    for (var i=0; i < 30; i++) {
      this.pathSim.tick();
    }
  }
  resize() {
    let nodes = this.getNodes();
    let anchors = this.getAnchors();
    this.centeringSim.stop();
    this.centeringSim.force("centering").x(window.innerWidth/2);
    this.centeringSim.force("centering").y(window.innerHeight/2);
    this.centeringSim.nodes(nodes.concat(anchors));
    this.centeringSim.alpha(1).restart();
  }
}


class GraphDraw {
  // The main drawing class.

  // listener interface
  // mouse and node events
  rgstrMouseAddLink(f) { this._mouseAddLinkListeners.push(f); }
  deregMouseAddLink(f) { remove(this._mouseAddLinkListeners, f); }
  fireMouseAddLink(...args) { fireEvents(this._mouseAddLinkListeners, "mouseAddLink", ...args); }
  rgstrDblClickNode(f) { this._dblClickNodeListeners.push(f); }
  deregDblClickNode(f) { remove(this._dblClickNodeListeners, f); }
  fireDblClickNode(...args) { fireEvents(this._dblClickNodeListeners, "dblClickNode", ...args); }
  rgstrClickSVG(f) { this._clickSVGListeners.push(f); }
  deregClickSVG(f) { remove(this._clickSVGListeners, f); }
  fireClickSVG(...args) { fireEvents(this._clickSVGListeners, "clickSVG", ...args); }
  rgstrClickNode(f) { this._clickNodeListeners.push(f); }
  deregClickNode(f) { remove(this._clickNodeListeners, f); }
  fireClickNode(...args) { fireEvents(this._clickNodeListeners, "selectNode", ...args); }
  rgstrCtrlClickNode(f) { this._ctrlClickNodeListeners.push(f); }
  deregCtrlClickNode(f) { remove(this._ctrlClickNodeListeners, f); }
  fireCtrlClickNode(...args) { fireEvents(this._ctrlClickNodeListeners, "deleteNode", ...args); }
  rgstrMouseDownNode(f) { this._mouseDownNodeListeners.push(f); }
  deregMouseDownNode(f) { remove(this._mouseDownNodeListeners, f); }
  fireMouseDownNode(...args) { fireEvents(this._mouseDownNodeListeners, "mouseDownNode", ...args); }
  rgstrResize(f) { this._resizeListeners.push(f); }
  deregResize(f) { remove(this._resizeListeners, f); }
  fireResize(...args) { fireEvents(this._resizeListeners, "resize", ...args); }
  rgstrDragStarted(f) { this._dragStartedListn.push(f); }
  deregDragStarted(f) { remove(this._dragStartedListn, f); }
  fireDragStarted(...args) { fireEvents(this._dragStartedListn, "dragStarted", ...args); }
  rgstrDragEnded(f) { this._dragEndedListn.push(f); }
  deregDragEnded(f) { remove(this._dragEndedListn, f); }
  fireDragEnded(...args) { fireEvents(this._dragEndedListn, "dragEnded", ...args); }
  // graphics events (re)draw and update
  rgstrDrawUpdate(f) { this._updateListn.push(f); }
  deregDrawUpdate(f) { remove(this._updateListn, f); }
  fireDrawUpdate(...args) { fireEvents(this._updateListn, "drawUpdate", ...args); }
  rgstrDraw(f) { this._drawListn.push(f); }
  deregDraw(f) { remove(this._drawListn, f); }
  fireDraw(...args) { fireEvents(this._drawListn, "draw", ...args); }

  constructor(graphData) {
    self = this;
    const svgwidth = 790;
    const svgheight = 700;

    // listener interface
    this._mouseAddLinkListeners = [];
    this._dblClickNodeListeners = [];
    this._clickSVGListeners = [];
    this._clickNodeListeners = [];
    this._ctrlClickNodeListeners = [];
    this._mouseDownNodeListeners = [];
    this._resizeListeners = [];
    this._dragStartedListn = [];
    this._dragEndedListn = [];
    this._updateListn = [];
    this._drawListn = [];

    // delegates
    this.graphData = graphData; // access anchors and nodes for drawing and simulations

    // svg
    this.svg = d3.select('body')
      .append('svg')
      .attr('width', svgwidth)
      .attr('height', svgheight)

    // TODO: upgrade this failed global zoom attampt
      //.append("g")
      //.call(d3.zoom().on("zoom", function () {
      //  this.svg.attr("transform", d3.event.transform);
      //}.bind(this)));

      .on("click", function() {
        //console.log(d3.event); // enables debugging of click event in various browsers
        self.graphData.setSelectedNode(null);
        self.fireClickNode(null);
        self.update();
        let m = d3.mouse(this)
        let svg_x = m[0];
        let svg_y = m[1];
        self.fireClickSVG(svg_x, svg_y);
      } );

    this.draggable = null;
    this.dragAnchor = null;
    this.dragNode = null;

    // named svg branches (NOTE: the ordering matters)
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
    let svgresize = function() {
      this.svg.attr("width", window.innerWidth-20).attr("height", window.innerHeight-25);
      this.fireResize();
    }.bind(this);
    window.onresize = svgresize;
    svgresize();

    // specific selections
    this.nodes = null;
    this.paths = null;
    this.anchors = null;
    this.arrowHeads = null;

    this.linkHelperBranch = this.svg.append("g");
    this.h = null;
  }
  dragged(d) {
    d.x += d3.event.dx;
    d.y += d3.event.dy;
  }
  dragstarted(d) {
    self.fireDragStarted(d);
  }
  dragended(d) {
    self.fireDragEnded(d);
  }
  anchorMouseDown(d) {
    self.dragAnchor = d;
    self.h = new LinkHelper(self.svg, self.linkHelperBranch, [d.x, d.y], function() { self.h = null; }.bind(self) );
  }
  anchorMouseUp(d, branch) {
    let s = self.dragAnchor;
    if (s && s != d && s.owner != d.owner) self.fireMouseAddLink(s, d);
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

    self.fireDrawUpdate();
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
      .on("contextmenu", function () {  d3.event.preventDefault(); })
      .on("click", function () {
        let node = d3.select(this).datum();
        d3.event.stopPropagation();
        if (d3.event.ctrlKey) {
          self.fireCtrlClickNode(node);
        }
        else {
          self.graphData.setSelectedNode(node.owner.id);
          self.fireClickNode( node );
          self.update();
        }
      })
      .on("dblclick", function() {
        let node = d3.select(this).datum();
        self.fireDblClickNode(node);
      })
      .on("mousedown", function(d) {
        self.fireMouseDownNode(d);
        self.dragNode = d;
        //self.h = new LinkHelper(self.svg, self.linkHelperBranch, [d.x, d.y], function() { self.h = null; }.bind(self) );
      })
      .on("mouseup", function(d) {
        let n = self.dragNode;
        if (n == null || n == d) return;
        // d and n are here nodes, handlers connect anchors
        self.fireMouseAddLink(n.centerAnchor, d.centerAnchor);
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
    self.fireDraw();

    // resize everything
    self.fireResize();
    // update data properties
    self.update();
  }
}


class GraphInterface {
  // High-level interface.
  //
  // Implements an undo-redo enabled interface to the graph data and drawing
  // classes. Use as the base class for graph manipulation and communication.

  // listener interface, native
  addNodeDataUpdateListener(l) { this._nodeDataUpdateListn.push(l); }
  addNodeCreateListener(l) { this._nodeCreateListn.push(l); }
  addNodeDeletedListener(l) { this._nodeDeletedListn.push(l); }
  // listener interface, delegate
  addUiDrawAllListener(l) { this.draw.rgstrDraw(l); }
  addNodeSelectionListener(l) { this.draw.rgstrClickNode(gNode => { l(gNode==null ? null : gNode.owner); }); }
  addNodeMouseDownListn(l) { this.draw.rgstrMouseDownNode(gNode => { l(gNode==null ? null : gNode.owner); }); }

  constructor(gs_id, tab_id, conn_rules) {
    // listener interface
    this._nodeCreateListn = [];
    this._nodeDeletedListn = [];
    this._nodeDataUpdateListn = [];

    // setup
    this.gs_id = gs_id;
    this.tab_id = tab_id;
    this.isalive = true;

    // delegates
    this.graphData = new GraphTree(conn_rules);
    this.draw = new GraphDraw(this.graphData);
    this.draw.rgstrMouseAddLink(this._tryCreateLink.bind(this));
    this.draw.rgstrCtrlClickNode(this._delNodeAndLinks.bind(this));
    this.draw.rgstrClickNode(this._selNodeCB.bind(this));
    this.draw.rgstrDblClickNode(this._dblclickNodeCB.bind(this));
    this.draw.rgstrClickSVG(this._createNodeCB.bind(this));
    this.draw.rgstrResize(this._resizeCB.bind(this));
    this.layout = new GraphLayout(
      this.draw.update.bind(this.draw), // updateCB
      this.draw.graphData.getGraphicsNodeObjs.bind(this.graphData), // getNodes
      this.draw.graphData.getAnchors.bind(this.graphData), // getAnchors
      this.draw.graphData.getForceLinks.bind(this.graphData), // getForceLinks
      ((gNode) => { // getAnchorsAndForceLinks
        this.graphData.recalcPathAnchorsAroundNodeObj(gNode);
        return this.graphData.getAnchorsAndForceLinks(gNode.owner.id);
      }).bind(this)
    );
    this.draw.rgstrResize(this.layout.resize.bind(this.layout)); // must be called @ recenter
    this.draw.rgstrDragStarted(this.layout.beforeChange.bind(this.layout));
    this.draw.rgstrDragEnded(this.layout.afterChangeDone.bind(this.layout));
    // TODO: reintroduce this functionality somehow:
    // reheat check - collision protection can expire during long drags
    // (code was in draw.dragged)
    //if (self.layout.collideSim.alpha() < 0.1) { self.layout.restartCollideSim(self.graphData); }

    // node connection logics
    this.truth = conn_rules;

    // id, node dict,for high-level nodes
    this.nodes = {};
    // create-node id uniqueness counter - dict'ed by key 'basetype prefix'
    this.idxs = {};

    // undo-redo stack
    this.undoredo = new UndoRedoCommandStack();

    // locks all undoable commands, and also a few others (js is single-threaded in most cases)
    this.locked = false;

    // node create conf pointer
    this._createConf = null;

    // error node
    this._errorNode = null;
  }
  // event handlers
  _resizeCB() {
    // implement _resizeCB in descendant to reposition app-specific elements
  }
  _selNodeCB(node) {
    let n = null;
    if (node) n = node.owner;
  }
  _createNodeCB(x, y) {
    let conf = this._createConf;
    if (conf == null) return;

    let id = this.node_add(x, y, "", "", conf.label, conf.address);

    this.layout.afterChangeDone(this.graphData.getNode(id));

    this._createConf = null;

    // update
    fireEvents(this._nodeCreateListn, "createNode", id);
    this.updateUi();
  }
  _dblclickNodeCB(gNode) {
    console.log("GraphInterface: Implement _dblclickNodeCB in descendants.");
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

    fireEvents(this._nodeDeletedListn, "deleteNode", id);
    this.updateUi();
  }
  _tryCreateLink(s, d) {
    let createLink = function(a1, a2) {
      this.link_add(a1.owner.owner.id, a1.idx, a2.owner.owner.id, a2.idx);

      this.layout.afterChangeDone(a1.owner);
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

  // utility interface
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
  }
  injectGraphDefinition(def) {
    // NODES
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
    // LINKS
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
    // DATAS
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
      fireEvents(this._nodeDataUpdateListn, "dataUpdate", m);
    }
    this.updateUi();
  }

  // graph manipulation and serialization interface
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

  // selection listeners
  rgstrClickConf(l) { this._clickConfListn.push(l); }
  fireClickConf(...args) { fireEvents(this._clickConfListn, "clickConf", ...args); }

  constructor(rootelementid, branchname, typeobj) {
    this._clickConfListn = [];

    this.menus = [];
    this.root = d3.select("#"+rootelementid);
    this.root
      .append("div")
      .attr("style","background-color:white;font-size:small;text-align:center;")
      .html(branchname.toUpperCase());

    let address = null;
    let addresses = typeobj["addresses"];
    let tree = typeobj["tree"];
    let conf = null;
    let c = null;
    for (var i=0; i<addresses.length; i++) {
      address = addresses[i];
      if (address.split('.')[0] == branchname) {
        conf = nodeTypeReadTree(address, tree);
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
    let n = NodeLinkConstrucionHelper.createNode(50, 50, "", conf);
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
      .on("click", function(d) { this.fireClickConf(d); }.bind(this) )
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
