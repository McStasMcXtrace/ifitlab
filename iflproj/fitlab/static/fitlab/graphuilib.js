/*
*
*
*
*/
class NodeTypeHelper {
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
    while (id in existingids) {
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
    return this._current.links[id].keys();
  }
  // returns a list of [id1, idx1, id2, idx2] sequences
  getLinks(id) {
    if (!this._current.links[id]) {
      return [];
    }
    let lks = this._current.links;
    let seqs = [];
    for (id2 in lks[id]) {
      let lst = lks[id2];
      for (var j=0;j<lst.length;j++) {
        seqs.push([id, lst[j].d1.idx, id2, lst[j].d2.idx]);
      }
    }
    return seqs;
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
  // should be private
  _updateAnchors(maybe=false) {
    this._viewAnchors = [];
    this._viewForceLinks = [];
    for (let j=0;j<this._viewLinks.length;j++) {
      let lanchs = this._viewLinks[j].getAnchors();
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
    for (let i=0;i<this._viewNodes.length;i++) {
      g = this._viewNodes[i].gNode;
      this._viewAnchors.push(g.centerAnchor);
      for (let j=0;j<g.anchors.length;j++) {
        this._viewAnchors.push(g.anchors[j]);
      }
    }
  }

  // **************************
  // ui and graphdraw interface
  // **************************

  setSelectedNode(n) {
    let m = this._selectedNode;
    if (m) m.active = false;
    this._selectedNode = n;
    if (n) n.active = true;
  }
  getSelectedNode() {
    return this._selectedNode;
  } // perhaps ...return a NodeRepr, not an Node obj?
  setSelectedNode(id) {
    let n = this._current.nodes[id];
    if (!n) return null;
    self._selectedNode = n;
  } // id must be accessible even from gNode

  // set interface / _command impls
  // safe calls that return true on success
  nodeAdd(x, y, conf, id=null) {
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
    let l = new LinkSingle(a1, a2);
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
    catch {
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
    return true;
  }
  nodeLabel(id, label) {
    let n = this.nodes[id];
    if (!n) return null;
    n.label = label;
    return true;
  }
  nodeData(id, data_str) {
    let n = this._current.nodes[id];
    if (n.edit != true) return null;
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
  // NOTE 1: updateNodeState() and things like updateAnchors() should always be done internally whenever needed
  // NOTE 2: messages such as the above two may be put on a qeue, to avoid overcalling them, which might be
  // triggered by g.e. processInternal(), but this should preferably be avoided, as such a call relies upon
  // knowledge about the internals of GraphTree
  extractGraphDefinition() {
    // NOTE: this is untested
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
      if (n.basetype == 'object_literal') datas[n.id] = btoa(JSON.stringify(n.userdata));

      let elks = n.gNode.exitLinks;
      if (elks.length == 0) continue;

      links[n.id] = [];
      let l = null;
      for (var j=0;j<elks.length;j++) {
        l = elks[j];
        links[n.id].push([n.id, l.d1.idx, l.d2.owner.owner.id, l.d2.idx]);
      }
    }
    let def_text = JSON.stringify(def);
    //console.log(JSON.stringify(def, null, 2));
    console.log(def_text);
    return def_text;
  }
}
