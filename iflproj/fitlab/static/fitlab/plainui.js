//
//  A plain jquery ui lib to accompany graphui
//
class PlotWindow {
  constructor(mouseUpCB, dragWindowCB, closeOuterCB, clickPlotCB, wname, xpos, ypos, titleadd=null, nodeid=null, plotdata=null) {
    this.wname = wname;
    this.title = wname; if (nodeid) this.title = nodeid;
    this.titleadd = titleadd;
    this._closeOuterCB = closeOuterCB;

    this.mouseupCB = function() { mouseUpCB(this); }.bind(this);
    this.dragCB = function() { dragWindowCB(this) }.bind(this);
    this.clickPlotCB = clickPlotCB;
    this.closeCB = this.close.bind(this);
    this.logscaleCB = this._logscaleCB.bind(this);
    this.sizeCB = this._toggleSizeCB.bind(this);

    this.large = false;
    this.sizes = [330, 220, 900, 600];
    this._removeSubWindow();
    this._createSubWindow(xpos, ypos, this.sizes[0], this.sizes[1]);

    this.plotbranch = null;
    this.plot = null; // Plot1D instance or svg branch if 2D
    this.ndims = null;
    this.data = {}; // { id : plotdata }

    this.logscale = false;

    if (nodeid != null && plotdata != null) {
      this.dropNode(nodeid, null, plotdata)
    }
  }
  _toggleSizeCB() {
    let prev_w = this.w;
    let prev_h = this.h;
    this.large = !this.large;
    let w = this.w;
    let h = this.h;
    let left = this.left + prev_w/2 - w/2;
    let top = this.top + prev_h/2 - h/2;
    left = Math.max(left, 0);
    top = Math.max(top, 0);

    this._removeSubWindow();
    this._createSubWindow(left, top, w, h);

    this.plotbranch = null;
    if (this.ndims == 1) {
      let logscale = this.plot.logscale;
      this.plot = null;

      let data = [];
      for (let id in this.data) {
        data.push(this.data[id]);
      }

      data[0].title='';
      data[0].w = this.w;
      data[0].h = this.h;

      this._resetPlotBranch();
      this.plot = new Plot1D(data[0], this.wname, this.clickPlotCB, this.plotbranch, logscale);

      this.plot.rePlotMany(data);
    }
    else if (this.ndims == 2) {
      this.plot = null;

      let cnt = 0;
      let nid = null;
      for (let id in this.data) {
        cnt++;
        nid = id;
      }
      if (cnt == 1) {
        this.dropNode(nid, null, this.data[nid], true);
      } else {
        throw "PlotWindow: more than one 2d plot is present, misconfigured";
      }
    }
  }
  _resetPlotBranch() {
    this.plotbranch = d3.select('#'+this.body_container[0])
      .selectAll("svg")
      .remove();
    this.plotbranch = d3.select('#'+this.body_container[0]).append("svg");
  }
  _logscaleCB() {
    this.logscale = !this.logscale;
    if (this.ndims == 1) {
      this.plot.toggleLogscale();
    }
    else if (this.ndims == 2) {
      this.plot = null;
      this._resetPlotBranch();
      let id = Object.keys(this.data)[0];
      this.dropNode(id, null, this.data[id], true);
    }
  }
  get w() {
    if (this.large) return this.sizes[2]
    return this.sizes[0];
  }
  get h() {
    if (this.large) return this.sizes[3]
    return this.sizes[1];
  }
  get x() {
    let pos = $("#"+this.body_container[1]).position();
    if (pos) return pos.left + this.w/2;
  }
  get y() {
    let pos = $("#"+this.body_container[1]).position();
    if (pos) return pos.top + this.h/2;
  }
  get left() {
    let pos = $("#"+this.body_container[1]).position();
    if (pos) return pos.left;
  }
  get top() {
    let pos = $("#"+this.body_container[1]).position();
    if (pos) return pos.top;
  }
  dropNode(nodeid, gNode, plotdata, override=false) {
    // safeties
    if (!plotdata || !nodeid) {
      return false;
    }
    if (nodeid in this.data && !override) {
      return false;
    }
    if (this.ndims == null) {
      this.ndims = plotdata.ndims;
    }
    else if (this.ndims != plotdata.ndims) {
      return false;
    }
    if (this.plot != null && plotdata.ndims == 2) {
       console.log("PlotWindow: 2D multiplot is not supported");
      return false
    }

    // init
    if (this.plotbranch == null) {
      this.plotbranch = d3.select('#'+this.body_container[0]).append("svg");
    }
    if (!override) {
      this.data[nodeid] = plotdata;
    }

    // plot
    plotdata.title='';
    plotdata.w = this.w;
    plotdata.h = this.h;

    if (this.plot == null) {
      if (this.ndims == 1) { this.plot = new Plot1D(plotdata, this.wname, this.clickPlotCB, this.plotbranch); }
      if (this.ndims == 2) plot_2d(plotdata, this.plotbranch, this.logscale);
    } else {
      if (plotdata.ndims == 1) this.plot.plotOneMore(plotdata);
      if (plotdata.ndims == 2) throw "2D multiplot is not supported";
    }

    // update window title
    let ids = [];
    for (let nid in this.data) {
      ids.push(nid)
    }
    let title = ids[0];
    for (let i=0;i<ids.length-1;i++) {
      title = title + ", " + ids[i+1];
    }
    this._setWindowTitle("(" + title + ")");

    // signal caller proceed
    return true;
  }
  _setWindowTitle(title) {
    if (this.titleadd) title = title + ": " + this.titleadd;
    $("#"+this.wname+"_header")
      .html(title);
    this.title = title;
  }
  extractNode(nodeid, force=false) {
    if (this.data[nodeid] == undefined) return false;

    delete this.data[nodeid];
    if (this.ndims == 1) {
      let pltdatas = [];
      for (let id in this.data) {
        let plotdata = this.data[id];
        pltdatas.push(plotdata);
      }
      this.plot.rePlotMany(pltdatas);
      return true;
    }
    else if (this.ndims == 2) {
      return true;
    }
  }
  close() {
    this._removeSubWindow();
    this.body_container = null;
    this._closeOuterCB(this);
  }
  numClients() {
    let n = 0;
    for (let id in this.data) n++;
    return n;
  }
  _removeSubWindow() {
    $("#"+this.wname+"_container").remove();
  }
  _createSubWindow(xpos, ypos, width, height) {
    let mouseupCB = this.mouseupCB;
    let mouseMoveCB = this.dragCB;
    let closeCB = this.closeCB;
    let logscaleCB = this.logscaleCB;
    let sizeCB = this.sizeCB;
    let wname = this.wname;
    let title = this.title;

    let headerheight = 20;
    let container_id = wname + "_container";
    let container = $('<div id="ID">'.replace("ID", container_id))
      .css({
        position : "absolute",
        left : xpos+"px",
        top : ypos+"px",
      })
      .appendTo('body');

    // header
    let header_id = wname + "_header";
    let header = $('<div id="ID">'.replace("ID", header_id))
      .css({
        position : "relative",
        width : width+"px",
        height : headerheight+"px",
        cursor : "grab",
        "background-color" : "#9C9CDE",
        "border-style" : "solid",
        "border-width" : "1px",
        "border-color" : "gray",
        display : "inline-block",
      })
      .appendTo(container)
      .html(title)
      .addClass("noselect");

    // close button
    let closebtn_id = wname + "_minmiz";
    let closebtn = $('<div id="ID">'.replace("ID", closebtn_id))
      .css({
        position : "absolute",
        left : (width-20)+"px",
        top : "0px",
        width : headerheight+"px",
        height : headerheight+"px",
        cursor:"pointer",
        "background-color":"white",
        "border-width":"1px",
        "border-style":"solid",
      })
      .appendTo(container);
    let closebtn_tooltip = null
    closebtn
      .mouseover(() => {
        closebtn_tooltip = $('<div>close</div>')
          .css({
            position:"absolute",
            top:"-30px",
            left:"-20px",
            width:"50px",
            height:"20px",
            "padding-left":"6px",
            "z-index":"666",
            "background-color":"white",
            "border-width":"1px",
            "border-style":"solid",
            "user-select":"none",
          })
          .appendTo(closebtn)
      })
      .mouseout(() => {
        if (closebtn_tooltip) closebtn_tooltip.remove();
      });

    // log toggle button
    let logbtn_id = null;
    let logbtn = null;
    logbtn_id = wname + "_logbtn";
    logbtn = $('<div id="ID" title="Toggle logscale">'.replace("ID", logbtn_id))
      .css({
        position:"absolute",
        left: (width-40)+"px",
        top:"0px",
        width:headerheight+"px",
        height:headerheight+"px",
        cursor:"pointer",
        "background-color":"lightgray",
        "border-width":"1px",
        "border-style":"solid",
      })
      .appendTo(container);
    let logbtn_tooltip = null
    logbtn
      .mouseover(() => {
        logbtn_tooltip = $('<div>log</div>')
          .css({
            position:"absolute",
            top:"-30px",
            left:"-20px",
            width:"40px",
            height:"20px",
            "padding-left":"12px",
            "z-index":"666",
            "background-color":"lightgray",
            "border-width":"1px",
            "border-style":"solid",
            "user-select":"none",
          })
          .appendTo(logbtn)
      })
      .mouseout(() => {
        if (logbtn_tooltip) logbtn_tooltip.remove();
      });


    // log toggle button
    let resizebtn_id = null;
    let resizebtn = null;
    resizebtn_id = wname + "_resizebtn";
    resizebtn = $('<div id="ID" title="Toggle logscale">'.replace("ID", resizebtn_id))
    .css({
      position:"absolute",
      left: (width-60)+"px",
      top:"0px",
      width:headerheight+"px",
      height:headerheight+"px",
      cursor:"pointer",
      "background-color":"gray",
      "border-width":"1px",
      "border-style":"solid",
    })
    .appendTo(container);
    let resizebtn_tooltip = null
    resizebtn
      .mouseover(() => {
        resizebtn_tooltip = $('<div>size</div>')
          .css({
            position:"absolute",
            top:"-30px",
            left:"-20px",
            width:"40px",
            height:"20px",
            "padding-left":"10px",
            "z-index":"666",
            "background-color":"gray",
            "border-width":"1px",
            "border-style":"solid",
            "user-select":"none",
          })
          .appendTo(resizebtn)
      })
      .mouseout(() => {
        if (resizebtn_tooltip) resizebtn_tooltip.remove();
      });

    // window body area
    let winbody_id = wname + "_body";
    let winbody = $('<div id="ID">'.replace("ID", winbody_id))
      .css({
        position:"relative",
        width:width+"px",
        height:height+"px",
        "background-color":"white",
        "border-style":"solid",
        "border-width":"1px",
        "border-top":"none",
      })
      .appendTo('#'+container_id)
      .mouseup(mouseupCB);

    $("#"+header_id).dblclick(() => {
        $("#"+winbody_id).toggle();
    });
    $("#"+closebtn_id).click(() => {
        closeCB();
    });
    $("#"+logbtn_id).click(() => {
      logscaleCB();
    });
    $("#"+resizebtn_id).click(() => {
      sizeCB();
    });

    var isDragging = false;
    let maybeDragging = false;
    $("#"+container_id)
    .draggable({
      cancel: "#"+winbody_id,
      containment: "body",
    })
    .mousedown(function() {
      isDragging = false;
      maybeDragging = true;
    })
    .mousemove(() => {
      if (maybeDragging && isDragging) mouseMoveCB(); else isDragging = true;
    })
    .mouseup(function() {
      maybeDragging = false;
      var wasDragging = isDragging;
      isDragging = false;
      if (!wasDragging) {
          $("#throbble").toggle();
      }
    });

    this.body_container = [winbody_id, container_id];
  }
}


class IdxEditWindow {
  // can be connected to two nodes at the time, used for editing the index given by the first one, of the other one's list data
  constructor(node_dataCB, mouseUpCB, dragWindowCB, closeOuterCB, wname, xpos, ypos) {
    this.wname = wname;
    this.title = wname;
    this._closeOuterCB = closeOuterCB;

    this.node_dataCB = node_dataCB;
    this.mouseupCB = function() { mouseUpCB(this); }.bind(this);
    this.dragCB = function() { dragWindowCB(this) }.bind(this);
    this.closeCB = this.close.bind(this);

    this.w = 380;
    this.h = 210;
    this._removeSubWindow();
    this._createSubWindow(xpos, ypos, this.w, this.h);
    this._setWindowTitle("Index Editor - add iterator obj and literal");

    // input
    this.idxnode = null;
    this.index = null;
    this.shape = null;
    this.length = null;
    // output
    this.targetnode = null;
    this.values = null;
  }
  _idx2midx(idx) {
    // converts an index and a datashape into a multiindex

    function dimfactor(k, m, shape) {
      // calculate nd-box volume factors
      let f = 1;
      for (let j=k+1;j<m+1;j++) {
        f = f*shape[j-1];
      }
      return f;
    }

    let shape = this.shape;

    let m = shape.length; // number of dimensions
    let f = Array(m);
    f.fill(1);
    for (let k=0;k<m-1;k++) {
      f[k] = dimfactor(k+1, m, shape);
    }

    // calculate indices and remainders iteratively
    let midx = Array(m);
    midx.fill(0);
    let remainders = Array(m);
    remainders.fill(0);
    midx[0] = Math.floor(idx / f[0]);
    remainders[0] = idx % f[0];
    for (let i=1;i<m;i++) {
      midx[i] = Math.floor(remainders[i-1] / f[i]);
      remainders[i] = remainders[i-1] % f[i];
    }
    return midx;
  }
  dropNode(id, gNode, plotData) {
    if (gNode == null) return; // ignore duds
    let n = gNode.owner;
    if (this.idxnode != null && this.targetnode != null) {
      return false;
    }
    else if (n.type == "obj"
        && this.idxnode == null
        && n.info != null
        && n.info["length"] != null
        && n.info["index"] != null) {
      this.idxnode = n;
      this.length = this.idxnode.info["length"];
      this._transition();
      return true;
    }
    else if (n.type == "literal" && this.targetnode == null) {
      if (this.shape != null && lstIsOfShape(n.userdata, this.shape)) {
        this.values = JSON.parse(JSON.stringify(n.userdata)); // this will deep-copy the list

        let tarea = $('#'+this.wname+"_textarea");
        let newval = this._getValue(this.index);
        if (newval == null) tarea.val(""); else tarea.val(JSON.stringify(newval, null, 2));
      }
      this.targetnode = n;
      return true;
    }
    else if (this.idxnode == null) {
      alert('Please add "obj" node with index information.');
      return false;
    }
    else {
      alert('Please add a "literal" node.');
      return false;
    };
  }
  extractNode(nodeid, force=false) {
    if (force == true && this.idxnode != null &&this.idxnode.id == nodeid) {
      this.idxnode = null;
      return true;
    }
    if (this.idxnode != null && this.idxnode.id == nodeid) {
      this._transition();
      return false;
    }
    else if (this.targetnode != null && this.targetnode.id == nodeid) {
      this.targetnode = null;
      return true;
    }
    else return false;
  }
  _transition() {
    // universal idxnode change handler - attach or run return triggered in extractnode
    if (this.idxnode.info != null) {
      let newindex = this.idxnode.info["index"];
      let tarea = $('#'+this.wname+"_textarea");

      if (this.shape == null && this.values == null) {
        // init
        this.shape = JSON.parse(this.idxnode.info["shape"]);
        this.values = createNDimArray(this.shape);
      } else {
        // pull index value to vievmodel
        let val = tarea.val();
        if (val == "") val = null;
        try {
          val = JSON.parse(val);
        }
        catch {
          console.log("IdxEditWindow: Not a json value, ", val);
        }
        if ($.isNumeric(val)) this._setValue(this.index, parseFloat(val)); else this._setValue(this.index, val);
      }
      // clear tarea
      let newval = this._getValue(newindex);
      if (newval == null) tarea.val(""); else tarea.val(JSON.stringify(newval, null, 2));
      this.index = newindex;
      let midxtitle = JSON.stringify(this._idx2midx(this.index), null, 2).replace(/\s/g, "");
      let onedtitle = this.idxnode.info["wtitle"];
      this._setWindowTitle("Editing " + onedtitle + " (multi index " + midxtitle + ")");
    }
  }
  _getValue(idx) {
    // nd get by oned index
    let midx = this._idx2midx(idx);
    // eval is bad, but in this case it is a good way to transform an m-length midx into an array index
    let eval_idx = JSON.stringify(midx).replace(",", "][");
    let eval_str = "this.values" + eval_idx + ";";
    return eval(eval_str);
  }
  _setValue(idx, val) {
    // nd set by one-d index
    let midx = this._idx2midx(idx);
    // eval is bad, but in this case it is a good way to transform an m-length midx into an array index
    let eval_idx = JSON.stringify(midx).replace(",", "][");
    let eval_str = "this.values" + eval_idx + " = " + JSON.stringify(val) + ";";
    eval(eval_str);
  }
  _copyToAll() {
    if (this.values != null) {
      this._transition();
      let value = this._getValue(this.index);
      for (let i=0;i<this.length;i++) {
        this._setValue(i, value);
      }
    }
  }
  _submit() {
    if (this.idxnode == null) {
      alert('Please add an "obj" node with index information.');
    } else if (this.targetnode == null) {
      alert('Please add a "literal" node.');
    } else {
      this._transition(); // this just pulls the value from tarea
      this.node_dataCB(this.targetnode.id, JSON.stringify(this.values));
    }
  }
  numClients() {
    if (this.targetnode != null && this.idxnode != null) return 2;
    if (this.targetnode != null || this.idxnode != null) return 1;
    return 0
  }
  get x() {
    let pos = $("#"+this.body_container[1]).position();
    if (pos) return pos.left + this.w/2;
  }
  get y() {
    let pos = $("#"+this.body_container[1]).position();
    if (pos) return pos.top + this.h/2;
  }
  get left() {
    let pos = $("#"+this.body_container[1]).position();
    if (pos) return pos.left;
  }
  get top() {
    let pos = $("#"+this.body_container[1]).position();
    if (pos) return pos.top;
  }
  _setWindowTitle(title) {
    $("#"+this.wname+"_header")
      .html(title);
    this.title = title;
  }
  close() {
    this._removeSubWindow();
    this.body_container = null;
    this._closeOuterCB(this);
  }
  _removeSubWindow() {
    $("#"+this.wname+"_container").remove();
  }
  _createSubWindow(xpos, ypos, width, height) {
    let mouseupCB = this.mouseupCB;
    let mouseMoveCB = this.dragCB;
    let closeCB = this.closeCB;
    let title = this.title;

    let headerheight = 20;
    let container_id = this.wname + "_container";
    let container = $('<div id="ID">'.replace("ID", container_id))
      .css({
        position : "absolute",
        left : xpos+"px",
        top : ypos+"px",
      })
      .appendTo('body');

    // header
    let header_id = this.wname + "_header";
    let header = $('<div id="ID">'.replace("ID", header_id))
      .css({
        position : "relative",
        width : width+"px",
        height : headerheight+"px",
        cursor : "grab",
        "background-color" : "#9C9CDE",
        "border-style" : "solid",
        "border-width" : "1px",
        "border-color" : "gray",
        display : "inline-block",
      })
      .appendTo(container)
      .html(title)
      .addClass("noselect");

    // close button
    let closebtn_id = this.wname + "_minmiz";
    let closebtn = $('<div id="ID"></div>'.replace("ID", closebtn_id))
      .css({
        position : "absolute",
        left : (width-20)+"px",
        top : "0px",
        width : headerheight+"px",
        height : headerheight+"px",
        cursor:"pointer",
        "background-color":"white",
        "border-width":"1px",
        "border-style":"solid",
      })
      .appendTo(container);
    let closebtn_tooltip = null
    closebtn
      .mouseover(() => {
        closebtn_tooltip = $('<div>close</div>')
          .css({
            position:"absolute",
            top:"-30px",
            left:"-20px",
            width:"50px",
            height:"20px",
            "padding-left":"6px",
            "z-index":"666",
            "background-color":"white",
            "border-width":"1px",
            "border-style":"solid",
            "user-select":"none",
          })
          .appendTo(closebtn)
      })
      .mouseout(() => {
        if (closebtn_tooltip) closebtn_tooltip.remove();
      });

    // window body - div containing textarea
    let winbody_id = this.wname + "_body";
    let winbody = $('<div style="text-align:right" id="ID"></div>'.replace("ID", winbody_id))
      .css({
        position:"relative",
        width:width+"px",
        height:height+"px",
        "background-color":"white",
        "border-style":"solid",
        "border-width":"1px",
        "border-top":"none",
      })
      .appendTo('#'+container_id)
      .mouseup(mouseupCB);
    $('<textarea rows=11 id='+ this.wname + "_textarea" +'></textarea>')
      .css({
        resize: "none",
        width: "99%",
        border: "none",
      })
      .appendTo(winbody);
    let tarea = $('#'+this.wname+"_textarea");

    $('<button id="'+ this.wname + '_btn2"' +'>Current Value to All</button>')
      .appendTo(winbody);
    let copy_btn = $('#'+ this.wname +"_btn2")
      .click(this._copyToAll.bind(this));

    $('<button id="'+ this.wname + '_btn"' +'>Submit List</button>')
      .appendTo(winbody);
    let submit_btn = $('#'+ this.wname +"_btn")
      .click(this._submit.bind(this));

    $("#"+header_id).dblclick(() => {
        $("#"+winbody_id).toggle();
    });
    $("#"+closebtn_id).click(() => {
        closeCB();
    });

    var isDragging = false;
    let maybeDragging = false;
    $("#"+container_id)
    .draggable({
      cancel: "#"+winbody_id,
      containment: "body",
    })
    .mousedown(function() {
      isDragging = false;
      maybeDragging = true;
    })
    .mousemove(() => {
      if (maybeDragging && isDragging) mouseMoveCB(); else isDragging = true;
    })
    .mouseup(function() {
      maybeDragging = false;
      var wasDragging = isDragging;
      isDragging = false;
      if (!wasDragging) {
          $("#throbble").toggle();
      }
    });

    this.body_container = [winbody_id, container_id];
  }
}

class IdxEdtData {
  constructor() {
    this.dta_node = null;
    this.val_node = null;
    this.data = [];
    this.shape = null
    this.idx = null;
    this.values = null;
    this.stat = 0; // empty=0 || single-plt=1 || multi-plt=2 || edt=3 || plt-edt=4
  }
  _get_value(idx) {
    if (this.shape == null) return this.values;
    // nd get by oned index
    let midx = this._idx2midx(idx);
    // eval is bad, but in this case it is an easy way to transform an m-length midx into an array index
    let eval_idx = JSON.stringify(midx).replace(",", "][");
    let eval_str = "this.values" + eval_idx + ";";
    return eval(eval_str);
  }
  _set_value(idx, val) {
    if (this.shape == null) { this.values = val; return; }
    // nd set by one-d index
    let midx = this._idx2midx(idx);
    // eval is bad, but in this case it is an easy way to transform an m-length midx into an array index
    let eval_idx = JSON.stringify(midx).replace(",", "][");
    let eval_str = "this.values" + eval_idx + " = " + JSON.stringify(val) + ";";
    eval(eval_str);
  }
  _idx2midx(idx) {
    function dimfactor(k, m, shape) {
      let f = 1;
      for (let j=k+1;j<m+1;j++) {
        f = f*shape[j-1];
      }
      return f;
    }
    let shape = this.shape;
    let m = shape.length; // number of dimensions
    let f = Array(m);
    f.fill(1);
    for (let k=0;k<m-1;k++) {
      f[k] = dimfactor(k+1, m, shape);
    }
    // calculate indices and remainders iteratively
    let midx = Array(m);
    midx.fill(0);
    let remainders = Array(m);
    remainders.fill(0);
    midx[0] = Math.floor(idx / f[0]);
    remainders[0] = idx % f[0];
    for (let i=1;i<m;i++) {
      midx[i] = Math.floor(remainders[i-1] / f[i]);
      remainders[i] = remainders[i-1] % f[i];
    }
    return midx;
  }
  // external interface
  get_idx() {
    return this.idx;
  }
  try_set_idx(idx) {
    return false;
  }
  try_add_val_node(n) {
    if (n == null) return false; // ignore duds
    if (n.type != "literal") return false; // ignore non-literals

    let shape = this._get_shape(n.obj);
    let state = this.state();
    if (state == 0) {
      if (shape != null) {
        throw "IdxEdtData: implement 'continue editing shaped literal'"
      }
      this.val_node = n;
      return true;
    }
    else if ((state == 1 || state == 2) && lstIsOfShape(n.obj, this.shape)) {
      this.val_node = n;
      return true;
    }
    return false;
  }
  try_add_dta_node(n) {
    if (n == null) return; // ignore duds
    let valid_dta_node = n.type == "obj"
      && n.info != null
      && n.info["length"] != null
      && n.info["index"] != null;
    let state = this.state();
    if ((state == 0 || state == 3) && valid_dta_node) {
      this.dta_node = n;
      return true;
    }
    return false;
  }
  get_state() {
    if (this.dta_node == null && this.val_node == null) return 0;
    else if (this.dta_node != null && this.shape == null) return 1;
    else if (this.dta_node != null && this.val_node == null) return 2;
    else if (this.dta_node == null && this.val_node != null && this.shape != null) return 3;
    else if (this.dta_node != null && this.val_node != null && this.shape != null) return 4;
    else throw "IdxEdtData: undefined state";
  }
  try_get_submit_obj() {
    // NOTE: the user will have to create the node_data event, and make sure the proper
    // conditions for data submission to that node are satisfied.
    if (this.val_node != null) {
      return this.values;
    }
  }
  _do_copy_to_all() {
    if (this.values != null) {
      this._transition();
      let value = this._getValue(this.index);
      for (let i=0;i<this.length;i++) {
        this._setValue(i, value);
      }
    }
  }
  set_value(val) {
    this._set_value(this.idx, val);
  }
  get_value() {
    this._get_value(this.idx);
  }
}


class DragWindow {
  // very simple window with dragbar and double-click collaps, but no buttons
  constructor(xpos, ypos, width, height, title, content_div_id) {
    this.xpos = xpos;
    this.ypos = ypos;
    this.width = width;
    this.height = height;
    this.title = title;
    this.content_div_id = content_div_id;
    this.wname = title + "_debugwindowname";
    this.body_container = null;

    this._createSubWindow();
  }
  _createSubWindow() {
    let headerheight = 20;
    let container_id = this.wname + "_container";
    let container = $('<div id="ID">'.replace("ID", container_id))
      .css({
        position : "absolute",
        left : this.xpos + "px",
        top : this.ypos + "px",
      })
      .appendTo('body');

    // header
    let header_id = this.wname + "_header";
    let header = $('<div id="ID">'.replace("ID", header_id))
      .css({
        position : "relative",
        width : this.width + "px",
        //width : "300px",
        height : headerheight + "px",
        cursor : "grab",
        "background-color" : "#9C9CDE",
        "border-style" : "solid",
        "border-width" : "1px",
        "border-color" : "gray",
        display : "inline-block",
      })
      .appendTo(container)
      .html(this.title)
      .addClass("noselect");

    // window body area - insert given div
    let winbody = $('#' + this.content_div_id)
      .css({
        position:"relative",
        width: this.width + "px",
        height: this.height + "px",
        "background-color":"white",
        "border-style":"solid",
        "border-width":"1px",
        "border-top":"none",
      })
      .appendTo('#'+container_id)

    $("#" + header_id).dblclick(() => {
        $("#" + this.content_div_id).toggle();
    });

    var isDragging = false;
    let maybeDragging = false;
    $("#"+container_id)
    .draggable({
      cancel: "#" + this.content_div_id,
      containment: "body",
    })
    .mousedown(function() {
      isDragging = false;
      maybeDragging = true;
    })
    .mousemove(() => {
      if (maybeDragging && isDragging) ;/*mouseMoveCB();*/ else isDragging = true;
    })
    .mouseup(function() {
      maybeDragging = false;
      var wasDragging = isDragging;
      isDragging = false;
      if (!wasDragging) {
          $("#throbble").toggle();
      }
    });

    this.body_container = [this.content_div_id, container_id];
  }
}


class SubWindowLines {
  // keeps track of helper lines to/from nodes and subwindows such as PlotWindow and IdxEditWindow
  constructor(svg_root) {
    this.svg = svg_root;
    this.lines = svg_root.append("g")
      .lower();

    this.ids = [];
    this.coords = [];
    this.colours = [];
    this.gnodefrom = null;
    this.nidfrom = null;
  }
  draw() {
    this.lines.selectAll("line").remove();
    if (this.coords.length == 0) return;
    this.lines
      .selectAll("line")
      .data(this.coords)
      .enter()
      .append("line")
      .attr("x1", function(d) { return d[0].x })
      .attr("y1", function(d) { return d[0].y })
      .attr("x2", function(d) { return d[1].x })
      .attr("y2", function(d) { return d[1].y })
      .classed("plotLine", true)
      .attr("stroke", function(d,i) { return this.colours[i]; }.bind(this));
  }
  update() {
    this.lines
      .selectAll("line")
      .data(this.coords)
      .attr("x1", function(d) { return d[0].x })
      .attr("y1", function(d) { return d[0].y })
      .attr("x2", function(d) { return d[1].x })
      .attr("y2", function(d) { return d[1].y });
  }
  dragFromNode(id, gNode)  {
    this.gnodefrom = gNode;
    this.nidfrom = id;
    this.svg
      .on("mouseup", function() {
        this.clearLineFrom();
      }.bind(this) );
  }
  clearLineFrom() {
    this.gnodefrom = null;
    this.nidfrom = null;
  }
  setLineToAndCloseData(wid, pltw) {
    // safeties
    if (!this.nidfrom || !wid || !this.gnodefrom || !pltw) {
      console.log("new plotline skipped");
      return;
    }

    // clear and return if such a data entry already exists
    for (let i=0;i<this.ids.length;i++) {
      let nid_wid = this.ids[i];
      if (nid_wid[0] == this.nid && nid_wid[1] == wid) {
        this.clearLineFrom();
        return;
      }
    }

    this.ids.push([this.nidfrom, wid]);
    this.coords.push([this.gnodefrom, pltw]);
    this.colours.push(this.gnodefrom.colour);
    this.clearLineFrom();

    this.draw();
  }
  removeLinesByNid(node_id) {
    let node_ids = this.ids.map(e => e[0]);
    while (node_ids.indexOf(node_id) >= 0) {
      let idx = node_ids.indexOf(node_id);
      this.ids.splice(idx, 1);
      this.coords.splice(idx, 1);
      this.colours.splice(idx, 1);
      node_ids.splice(idx, 1);
    }
  }
  removeLinesByWid(window_id) {
    let w_ids = this.ids.map(e => e[1]);
    while (w_ids.indexOf(window_id) >= 0) {
      let idx = w_ids.indexOf(window_id);
      this.ids.splice(idx, 1);
      this.coords.splice(idx, 1);
      this.colours.splice(idx, 1);
      w_ids.splice(idx, 1);
    }
  }
  removeLine(node_id, window_id) {
    // allows to control more precisely when lines are removed
    for (let i=0; i<this.ids.length; i++) {
      let entry = this.ids[i];
      if (entry[0] == node_id && entry[1] == window_id) {
        this.ids.splice(i, 1);
        this.coords.splice(i, 1);
        this.colours.splice(i, 1);
      }
    }
  }
}


class SubWindowHandler {
  // NOTE: the .bind(this) stuff is an emulation of the pythonic callback function style
  constructor(subwindowlines) {
    this.subwindowlines = subwindowlines;
    this.idx = 0;
    this.plotWindows = [];

    // used for drag-and-drop plotting
    this.tmpPlotdata = null;
    this.tmpNodeid = null;
    this.tmpgNode = null;
  }
  newPlotwindow(xpos, ypos, clickPlotCB, titleadd=null, nodeid=null, plotdata=null, gNode=null) {
    let wname = "window_" + String(this.idx++);
    if (nodeid != null && plotdata != null) {
      let pltw = new PlotWindow(
        this._pwMouseUpCB.bind(this),
        this._pwDragCB.bind(this),
        this._closePltWindowCleanup.bind(this),
        clickPlotCB,
        wname, xpos, ypos, titleadd, nodeid, plotdata);
      this.plotWindows.push(pltw);
      if (gNode != null) {
        this.subwindowlines.dragFromNode(nodeid, gNode);
        this.subwindowlines.setLineToAndCloseData(pltw.wname, pltw);
      }
    } else {
      this.plotWindows.push(new PlotWindow(
        this._pwMouseUpCB.bind(this),
        this._pwDragCB.bind(this),
        this._closePltWindowCleanup.bind(this),
        clickPlotCB,
        wname, xpos, ypos));
    }
  }
  newIdxEdtWindow(xpos, ypos, node_dataCB) {
    let wname = "window_" + String(this.idx++);

    this.plotWindows.push(new IdxEditWindow(
      node_dataCB,
      this._pwMouseUpCB.bind(this),
      this._pwDragCB.bind(this),
      this._closePltWindowCleanup.bind(this),
      wname, xpos, ypos));
  }
  removePlots(id, force=false) {
    // Remove subwindows and lines by node id. At e.g. node deletion, use force==true to ensure removal.
    let x_y = null;
    let closeUs = [];
    for (let i=0;i<this.plotWindows.length;i++) {
      let pltw = this.plotWindows[i];
      let didremove = pltw.extractNode(id, force);

      if (didremove && pltw.numClients() == 0) {
        x_y = [pltw.left, pltw.top];
        closeUs.push(pltw);
        this.subwindowlines.removeLine(id, pltw.wname);
      } else if (force == true) {
        this.subwindowlines.removeLine(id, pltw.wname);
        if (pltw.numClients() == 0) closeUs.push(pltw);
      }
    }
    // warning: the close CB will remove items from this.plotWindows
    let len = closeUs.length;
    for (let i=0;i<len;i++) {
      closeUs[i].close();
    }

    return x_y;
  }
  getAllPlots() {
    // TODO: impl. for use with data reporting
    // just returns all plots with data in them, as they are
  }
  rePlot(id, gNode, plotdata) {
    this.subwindowlines.removeLinesByNid(id);
    for (let i=0;i<this.plotWindows.length;i++) {
      let pltw = this.plotWindows[i];
      let didremove = pltw.extractNode(id);
      if (didremove) {
        pltw.dropNode(id, gNode, plotdata);

        this.subwindowlines.dragFromNode(id, gNode);
        this.subwindowlines.setLineToAndCloseData(pltw.wname, pltw);
        this.subwindowlines.draw();
      }
    }
  }
  nodeMouseDown(nid, gNode, plotdata) {
    this.tmpNodeid = nid;
    this.tmpgNode = gNode;
    this.tmpPlotdata = plotdata;
    this.subwindowlines.dragFromNode(nid, gNode);
  }
  _closePltWindowCleanup(pltw) {
    remove(this.plotWindows, pltw);
    this.subwindowlines.removeLinesByWid(pltw.wname);
    this.subwindowlines.draw();
  }
  _pwDragCB(pltw) {
    this.subwindowlines.update();
  }
  _pwMouseUpCB(pltw) {
    if (pltw.dropNode(this.tmpNodeid, this.tmpgNode, this.tmpPlotdata)) {
      this.subwindowlines.setLineToAndCloseData(pltw.wname, pltw);
    }
    this.tmpNodeid = null;
    this.tmpgNode = null;
    this.tmpPlotdata = null;
  }
}

//
// Utility functions.
//
function createNDimArray(shape) {
  // courtesy of Barmar, SO
  if (shape.length > 0) {
    var dim = shape[0];
    var rest = shape.slice(1);
    var newArray = new Array();
    for (var i = 0; i < dim; i++) {
      newArray[i] = this._createNDimArray(rest);
    }
    return newArray;
  } else {
    return null;
  }
}
function lstIsOfShape(lst, shape) {
  if (shape == null) {
    console.log(lst.length);
    throw "lstIsOfShape: implement null shape comparisson";
  }
  // returns true if lst can accomodate shape. lst may not be wider than shape, but it may be deeper.
  function shapeRec(l, s) {
    if (l.length != s[0]) {
      throw "shape mismatch";
    }
    if (s.length > 1) {
      let snew = s.splice(1);
      for (let i=0;i<s[0];i++)  {
        shapeRec(l[i], snew);
      }
    }
  }
  try {
    shapeRec(lst, shape.slice()); // (shalow) copy list to avoid changing the incoming shape
    return true;
  }
  catch {
    return false;
  }
}
