/*
* A nodespeak compatible graph ui using d3.js for drawing and force layouts.
*
* Written by Jakob Garde 2018.
*/
class NodeTypeHelper {
  constructor() {
    this.idxs = {};
    this.colourPickedIdx = 0;
    // this changes what starting colours are used - index doesn't
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
      NodeIFunc,
      NodeFunctional,
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
  createNode(x, y, id, typeconf) {
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
    let n = this._helper.createNode(x, y, id, conf);
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
    this._updateNodeState(n1);
    this._updateNodeState(n2);
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
    this._updateNodeState(n1);
    this._updateNodeState(n2);
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
    this._updateNodeState(n);
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
  _updateNodeState(n) {
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
