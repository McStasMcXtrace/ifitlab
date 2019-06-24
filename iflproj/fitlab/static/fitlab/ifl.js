//
//  IFL extension to graphui.js.
//


class ConnectionRulesIfl extends ConnectionRulesBase {
  // bare-bones rules determining whether and how nodes can be connected
  static canConnect(a1, a2) {
    if (a1.idx==-1 && a2.idx==-1) {
      let tpe1 = a1.owner.owner.basetype;
      let tpe2 = a2.owner.owner.basetype;
      let t1 = ["object_idata", "object_ifunc", "obj"].indexOf(tpe1) != -1 && tpe2 == "method";
      let t2 = tpe1 == "method" && ["object_idata", "object_ifunc", "obj"].indexOf(tpe2) != -1;
      let t3 = a1.numconnections == 0;
      let t4 = a2.numconnections == 0;
      return t1 && t4 || t2 && t3;
    }

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
  static couldConnect(a1, a2) {
    // could a1 and a2 be connected if a2 was unoccupied?
    //  a2 input anchor, a1 output
    let t1 = a2.i_o;
    let t2 = !a1.i_o;
    // both anchors must be of the same type
    let t6 = a1.type == a2.type;
    let t7 = a1.type == '' || a2.type == '';
    let t8 = a1.type == 'obj' || a2.type == 'obj';

    let ans = ( t1 && t2 ) && (t6 || t7 || t8);
    return ans;
  }
  static getLinkBasetype(a1, a2) {
    if (a1.idx==-1 && a2.idx==-1) return "link_double_center"; else return "link_single";
  }
}


class GraphInterfaceIFL extends GraphInterface {
  /*
  *  Adds IFL functionality. Mainly ajax backend communication,
  *  including run/execute which affects the graph.
  */
  constructor(gs_id, tab_id) {
    super(gs_id, tab_id, ConnectionRulesIfl);

    // error node
    this._errorNode = null;
  }

  // overloaded _dblclickNodeCB becomes run/execute node
  _dblclickNodeCB(gNode) {
    this.run(gNode.owner.id);
  }
  // overloaded _recenterCB
  _recenterCB() {
    let btnsmenu = d3.select("#buttons");
    btnsmenu.style("left", window.innerWidth/2-btnsmenu.node().clientWidth/2 + "px");
    let btnsmenu_2 = d3.select("#buttons_2");
    btnsmenu_2.style("left", window.innerWidth/2-btnsmenu_2.node().clientWidth/2 + "px");
  }

  // extended IFL interface, backend communicattion
  loadSession() {
    $("body").css("cursor", "wait");

    this.ajaxcall("/ifl/ajax_load_session/", null, function(obj) {
      this.reset();
      this.injectGraphDefinition(obj["graphdef"]);
      this.graph_update(obj["dataupdate"]);
      $("body").css("cursor", "default");
    }.bind(this));
  }
  revertSession() {
    $("body").css("cursor", "wait");

    this.ajaxcall("/ifl/ajax_revert_session/", null, function(obj) {
      this.reset();
      this.injectGraphDefinition(obj["graphdef"]);
      this.graph_update(obj["dataupdate"]);
      $("body").css("cursor", "default");
    }.bind(this));
  }
  saveSession() {
    $("body").css("cursor", "wait");

    let post_data = {};
    post_data["sync"] = this.undoredo.getSyncSet();
    post_data["coords"] =  this.graphData.getCoords();

    this.ajaxcall("/ifl/ajax_save_session/", post_data, function(obj) {
      $("body").css("cursor", "default");
    }.bind(this));
  }
  clearSessionData() {
    $("body").css("cursor", "wait");

    this.ajaxcall("/ifl/ajax_clear_data/", null, function(obj) {
      this.graph_update(obj["dataupdate"]);
      $("body").css("cursor", "default");
    }.bind(this));
  }
  updateSession() {
    if (!this.isalive) return;

    let post_data = {};
    post_data["sync"] = this.undoredo.getSyncSet();
    post_data["coords"] =  this.graphData.getCoords();

    this.ajaxcall_noerror("/ifl/ajax_update/", post_data, function(obj) {
      // empty
    }.bind(this));
  }
  runSelectedNode() {
    if (this.graphData.getSelectedNode()) {
      this.run(this.graphData.getSelectedNode().id);
    }
    else {
      console.log("GraphInterfaceIFL.runSelectedNode: selected node is null");
      return;
    }
  }

  // server communication
  ajaxcall(url, data, success_cb, fail_cb=null) {
    this.isalive = simpleajax(url, data, this.gs_id, this.tab_id, success_cb, fail_cb, true);
  }
  ajaxcall_noerror(url, data, success_cb) {
    // call with showfail=false, which turns off django and offline fails
    this.isalive = simpleajax(url, data, this.gs_id, this.tab_id, success_cb, null, false);
  }

  // execute node, communicates with backend
  run(id) {
    // safeties
    if (id == null) throw "run arg must be a valid id"
    if (this.lock == true) { console.log("GraphInterface.run call during lock (id: " + id + ")" ); return; }
    let n = this.graphData.getNode(id);
    if (n.executable == false) { console.log("GraphInterface.run call on non-executable node (id: " + id + ")"); return; }

    // clear the state of any error node, we can hope users have now fixed the problem and we do not want any hangover error nodes
    if (this._errorNode)
    {
      this.graphData.updateNodeState(this._errorNode);
      this._errorNode = null;
    }

    // lock the ui and set running node state
    this.lock = true;
    n.gNode.state = NodeState.RUNNING;
    this.updateUi();

    let post_data = {};
    post_data["sync"] = this.undoredo.getSyncSet();
    post_data["run_id"] = id;

    this.ajaxcall("/ifl/ajax_run_node/", post_data,
      function(obj) {
        this.lock = false;

        // fail section
        let failmsg = obj['error'];
        if (failmsg != null) {
          this.graphData.updateNodeState(n);
          let sourceid = obj['errorid'];
          if (sourceid) {
            let m = this.graphData.getNode(sourceid);
            this._errorNode = m;
            m.gNode.state = NodeState.FAIL;
            m.info = failmsg;
            this.updateUi();
            alert(m.label + " " + sourceid + " " + failmsg);
          }
          else {
            console.log("fallback alert used")
            alert(failmsg);
          }
        }

        // success section
        let datasets = obj['dataupdate'];
        this.graph_update(datasets);
      }.bind(this),
      function() {
        // unhandled server exception section
        this.lock = false;
        this.graphData.updateNodeState(n);
        this.updateUi();
      }.bind(this)
    );
  }
}


// ajax setup with session id and tab id security built in
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


// nodes
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


// register node types
NodeLinkConstrucionHelper.register_node_class(NodeIData);
NodeLinkConstrucionHelper.register_node_class(NodeIFunc);
