//
//  A plain jquery ui lib to accompany graphui
//
function removeSubWindow(wname) {
  let pos = $("#"+wname+"_container").position();
  $("#"+wname+"_container").remove();
  if (pos) return [pos.left, pos.top];
}
function createSubWindow(mouseupCB, mouseMoveCB, closeCB, wname, title, xpos, ypos, width, height) {
  let headerheight = 20;
  let container_id = wname + "_container";
  let container = $('<div id="ID">'.replace("ID", container_id))
    .css({
      position:"absolute",
      left:xpos+"px",
      top:ypos+"px",
    })
    .appendTo('body');
  let header_id = wname + "_header";
  let header = $('<div id="ID">'.replace("ID", header_id))
    .css({
      position:"relative",
      width:width+"px",
      height:headerheight+"px",
      cursor:"grab",
      "background-color":"#8888a0",
      "border-style":"solid",
      "border-color":"gray",
      display:"inline-block",
    })
    .appendTo('#'+container_id)
    .html(title)
    .addClass("noselect");
  let smallsquare_id = wname + "_minmiz";
  let minsquare = $('<div id="ID">'.replace("ID", smallsquare_id))
    .css({
      position:"relative",
      left: (width-20)+"px",
      top:"0px",
      width:headerheight+"px",
      height:headerheight+"px",
      "margin-top":"-22px",
      "margin-left":"-3px",
      cursor:"pointer",
      "background-color":"white",
      "border-style":"solid",
    })
    .appendTo('#'+header_id);
  let winbody_id = wname + "_body";
  let winbody = $('<div id="ID">'.replace("ID", winbody_id))
    .css({
      position:"relative",
      width:width+"px",
      height:height+"px",
      "background-color":"white",
      "border-style":"dotted",
      "border-top":"none",
    })
    .appendTo('#'+container_id)
    .mouseup(mouseupCB);

  $("#"+header_id).dblclick(() => {
      $("#"+winbody_id).toggle();
  });
  $("#"+smallsquare_id).click(() => {
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

  return [winbody_id, container_id];
}

class PlotWindow {
  // keeps track of, draws and updates, all helper lines going from nodes to plot windows
  constructor(mouseUpCB, dragWindowCB, closeOuterCB, wname, xpos, ypos, nodeid=null, plotdata=null) {
    this.wname = wname;
    this._closeOuterCB = closeOuterCB;

    let title = wname;
    if (nodeid) title = nodeid;
    let mouseupCB = function() { mouseUpCB(this); }.bind(this);
    let dragCB = function() { dragWindowCB(this) }.bind(this);
    let closeCB = this.close.bind(this);
    this.width = 330;
    this.height = 220;
    this.body_container = createSubWindow(mouseupCB, dragCB, closeCB, wname, title, xpos, ypos, this.width, this.height);

    this.plotbranch = null;
    this.plot = null; // Plot1D instance or svg branch if 2D
    this.ndims = null;
    this.data = {}; // { id : plotdata }

    if (nodeid != null && plotdata != null) {
      this.addPlot(nodeid, plotdata)
    }
  }
  get x() {
    let pos = $("#"+this.body_container[1]).position();
    if (pos) return pos.left + this.width/2;
  }
  get y() {
    let pos = $("#"+this.body_container[1]).position();
    if (pos) return pos.top + this.height/2;
  }
  addPlot(nodeid, plotdata) {
    // safeties
    if (!plotdata || !nodeid) {
      console.log("empty addPlot requested");
      return;
    }
    if (nodeid in this.data) return;
    if (this.ndims == null) this.ndims = plotdata.ndims;
    else if (this.ndims != plotdata.ndims) return;

    // init
    if (this.plotbranch == null) {
      this.plotbranch = d3.select('#'+this.body_container[0]).append("svg");
    }
    this.data[nodeid] = plotdata;

    // plot
    plotdata.title='';
    plotdata.w = this.width;
    plotdata.h = this.height;

    if (this.plot == null) {
      if (this.ndims == 1) this.plot = new Plot1D(plotdata, this.plotbranch, () => {});
      if (this.ndims == 2) plot_2d(pltdata, plotbranch);
    } else {
      if (plotdata.ndims == 1) this.plot.plotOneMore(plotdata);
      if (plotdata.ndims == 2) throw "2D multiplot is not supported";
    }

    // TODO: update window title
  }
  removePlot(nodeid) {
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
  }
  close() {
    removeSubWindow(this.wname);
    this._closeOuterCB(this);
  }
  numPlots() {
    let n = 0
    for (let id in this.data) n++;
    return n;
  }
}

class PlotLines {
  constructor(svg_root) {
    this.svg = svg_root;
    this.lines = svg_root.append("g")
      .lower();

    this.ids = [];
    this.coords = [];
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
      .classed("plotLine", true);
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
    this.clearLineFrom();

    this.draw();
  }
  removeLinesByNid(node_id) {
    let node_ids = this.ids.map(e => e[0]);
    while (node_ids.indexOf(node_id) >= 0) {
      let idx = node_ids.indexOf(node_id);
      this.ids.splice(idx, 1);
      this.coords.splice(idx, 1);
      node_ids.splice(idx, 1);
    }
  }
  removeLinesByWid(window_id) {
    let w_ids = this.ids.map(e => e[1]);
    while (w_ids.indexOf(window_id) >= 0) {
      let idx = w_ids.indexOf(window_id);
      this.ids.splice(idx, 1);
      this.coords.splice(idx, 1);
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
  newPlotwindow(xpos, ypos, nodeid=null, plotdata=null, gNode=null) {
    let wname = "window_" + String(this.idx++);
    if (nodeid != null && plotdata != null) {
      let pltw = new PlotWindow(
        this._pwMouseUpCB.bind(this),
        this._pwDragCB.bind(this),
        this._closePltWindowCleanup.bind(this),
        wname, xpos, ypos, nodeid, plotdata);
      this.plotWindows.push(pltw);
      if (gNode != null) {
        this.plotlines.dragFromNode(nodeid, gNode);
        this.plotlines.setLineToAndCloseData(pltw.wname, pltw);
      }
    } else {
      this.plotWindows.push(new PlotWindow(
        this._pwMouseUpCB.bind(this),
        this._closePltWindowCleanup.bind(this),
        wname, xpos, ypos));
    }
  }
  removePlots(id) {
    for (let i=0;i<this.plotWindows.length;i++) {
      let pltw = this.plotWindows[i];
      let didremove = pltw.removePlot(id);
      if (didremove && pltw.numPlots() == 0) pltw.close();
    }
    this.plotlines.removeLinesByNid(id);
  }
  getAllPlots() {
    // just returns all plots with data in them, as they are
  }
  nodeMouseDown(nid, gNode, plotdata) {
    this.tmpPlotdata = plotdata;
    this.tmpNodeid = nid;
    this.plotlines.dragFromNode(nid, gNode);
  }
  _closePltWindowCleanup(pltw) {
    this.plotlines.removeLinesByWid(pltw.wname);
    this.plotlines.draw();
  }
  _pwDragCB(pltw) {
    this.plotlines.update();
  }
  _pwMouseUpCB(pltw) {
    pltw.addPlot(this.tmpNodeid, this.tmpPlotdata);
    this.plotlines.setLineToAndCloseData(pltw.wname, pltw);
  }
}
