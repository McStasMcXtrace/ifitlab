//
//  A plain jquery ui lib to accompany graphui
//
class PlotWindow {
  // keeps track of, draws and updates, all helper lines going from nodes to plot windows
  constructor(mouseUpCB, dragWindowCB, closeOuterCB, wname, xpos, ypos, titleadd=null, nodeid=null, plotdata=null) {
    this.wname = wname;
    this.title = wname; if (nodeid) this.title = nodeid;
    this.titleadd = titleadd;
    this._closeOuterCB = closeOuterCB;

    this.mouseupCB = function() { mouseUpCB(this); }.bind(this);
    this.dragCB = function() { dragWindowCB(this) }.bind(this);
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

    if (nodeid != null && plotdata != null) {
      this.addPlot(nodeid, plotdata)
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

      // this made a difference
      this.plotbranch = d3.select('#'+this.body_container[0])
        .selectAll("svg")
        .remove();
      this.plotbranch = d3.select('#'+this.body_container[0]).append("svg");
      this.plot = new Plot1D(data[0], this.wname, this.plotbranch, logscale);

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
        this.addPlot(nid, this.data[nid], true);
      } else {
        throw "PlotWindow: more than one 2d plot is present, misconfigured";
      }
    }
  }
  _logscaleCB() {
    if (this.ndims == 1) this.plot.toggleLogscale();
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
  addPlot(nodeid, plotdata, override=false) {
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
      if (this.ndims == 1) { this.plot = new Plot1D(plotdata, this.wname, this.plotbranch); }
      if (this.ndims == 2) plot_2d(plotdata, this.plotbranch);
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
  removePlot(nodeid) {
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
      console.log("remove from 2d plot not supported");
    }
  }
  close() {
    this._removeSubWindow();
    this.body_container = null;
    this._closeOuterCB(this);
  }
  numPlots() {
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

class PlotLines {
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
}

class PlotWindowHandler {
  // NOTE: the .bind(this) stuff is an emulation of the pythonic callback function style
  constructor(plotlines) {
    this.plotlines = plotlines;
    this.idx = 0;
    this.plotWindows = [];

    // used for drag-and-drop plotting
    this.tmpPlotdata = null;
    this.tmpNodeid = null;
  }
  newPlotwindow(xpos, ypos, titleadd=null, nodeid=null, plotdata=null, gNode=null) {
    let wname = "window_" + String(this.idx++);
    if (nodeid != null && plotdata != null) {
      let pltw = new PlotWindow(
        this._pwMouseUpCB.bind(this),
        this._pwDragCB.bind(this),
        this._closePltWindowCleanup.bind(this),
        wname, xpos, ypos, titleadd, nodeid, plotdata);
      this.plotWindows.push(pltw);
      if (gNode != null) {
        this.plotlines.dragFromNode(nodeid, gNode);
        this.plotlines.setLineToAndCloseData(pltw.wname, pltw);
      }
    } else {
      this.plotWindows.push(new PlotWindow(
        this._pwMouseUpCB.bind(this),
        this._pwDragCB.bind(this),
        this._closePltWindowCleanup.bind(this),
        wname, xpos, ypos));
    }
  }
  removePlots(id, closeEmpty=true) {
    let x_y = null
    for (let i=0;i<this.plotWindows.length;i++) {
      let pltw = this.plotWindows[i];
      let didremove = pltw.removePlot(id);
      if (didremove && pltw.numPlots() == 0 && closeEmpty) {
        x_y = [pltw.left, pltw.top];
        pltw.close();
      }
    }
    this.plotlines.removeLinesByNid(id);
    return x_y;
  }
  getAllPlots() {
    // just returns all plots with data in them, as they are
  }
  rePlot(id, gNode, plotdata) {
    this.plotlines.removeLinesByNid(id);
    for (let i=0;i<this.plotWindows.length;i++) {
      let pltw = this.plotWindows[i];
      let didremove = pltw.removePlot(id);
      if (didremove) {
        pltw.addPlot(id, plotdata);

        this.plotlines.dragFromNode(id, gNode);
        this.plotlines.setLineToAndCloseData(pltw.wname, pltw);
        this.plotlines.draw();
      }
    }
  }
  nodeMouseDown(nid, gNode, plotdata) {
    this.tmpPlotdata = plotdata;
    this.tmpNodeid = nid;
    this.plotlines.dragFromNode(nid, gNode);
  }
  _closePltWindowCleanup(pltw) {
    remove(this.plotWindows, pltw);
    this.plotlines.removeLinesByWid(pltw.wname);
    this.plotlines.draw();
  }
  _pwDragCB(pltw) {
    this.plotlines.update();
  }
  _pwMouseUpCB(pltw) {
    if (pltw.addPlot(this.tmpNodeid, this.tmpPlotdata)) {
      this.plotlines.setLineToAndCloseData(pltw.wname, pltw);
    }
  }
}
