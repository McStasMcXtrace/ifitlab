//
//  A plain jquery ui lib to accompany graphui
//
function removeSubWindow(wname) {
  let pos = $("#"+wname+"_container").position();
  $("#"+wname+"_container").remove();
  if (pos) return [pos.left, pos.top];
}
function createSubWindow(mouseupCB, closeCB, wname, title, xpos, ypos, width, height) {
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
  $("#"+container_id).draggable({
    cancel: "#"+winbody_id,
    containment: "body",
  });

  return [winbody_id, container_id];
}


class PlotWindow {
  constructor(mouseUpCB, wname, xpos, ypos, nodeid=null, plotdata=null) {
    this.wname = wname; // the jq window handle/id or similar

    let title = wname;
    if (nodeid) title = nodeid;
    let cb = function() { mouseUpCB(this); }.bind(this);
    let close = this.close.bind(this);
    this.width = 330;
    this.height = 220;
    this.body_container = createSubWindow(cb, close, wname, title, xpos, ypos, this.width, this.height);

    this.plotbranch = null;
    this.plot = null; // Plot1D instance or svg branch if 2D
    this.ndims = null;
    this.data = {}; // contains id: plotdata

    if (nodeid != null && plotdata != null) {
      this.addPlot(nodeid, plotdata)
    }
  }
  get x() {
    return $("#"+this.body_container[1]).position().left + this.width/2;
  }
  get y() {
    return $("#"+this.body_container[1]).position().top + this.height/2;
  }
  addPlot(nodeid, plotdata) {
    // safeties
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
  }
  numPlots() {
    let n = 0
    for (let id in this.data) n++;
    return n;
  }
}

class PlotLines {
  constructor() {
    this.lines = {} // { [nid, wid] : [x0, y0, x1, y1] }

    this.linefrom_x = null;
    this.linefrom_y = null;
    this.nid = null;
    this.lineto_x = null;
    this.lineto_y = null;
    // wid is not needed to be stored, and nid is cleared after us
  }
  getLineData() {
    data = [];
    for (nid_wid in this.lines) data.push(this.lines[nid_wid])
    return this.data;
  }
  setLineFrom(x, y, nid) {
    // x and y are pointers to a node position
    this.linefrom_x = x;
    this.linefrom_y = y;
    this.nid = nid;
  }
  clearLineFrom() {
    this.linefrom_x = null;
    this.linefrom_y = null;
    this.nid = null;
  }
  getLineFrom() {
    return { "x" : this.linefrom_x, "y" : this.linefrom_y }
  }
  setLineToAndCloseData(x, y, wid) {
    // x and y are pointers to a plotwindow position
    // clear and return if such a data entry already exists
    for (nid_wid in this.lines) {
      if (nid_wid[0] == this.nid && nid_wid[1] == wid) {
        this.clearLineFrom();
        return;
      }
    }
    this.data[ [this.nid, wid] ] = [this.linefrom_x, this.linefrom_y, this.lineto_x, this.lineto_y];
    this.clearLineFrom()
  }
  clearLinesNid(node_id) {
    for (nid_wid in this.lines) {
      if (nid_wid[0] == node_id) delete this.lines[nid_wid];
    }
  }
  clearLinesWid(window_id) {
    for (nid_wid in this.lines) {
      if (nid_wid[1] == node_id) delete this.lines[nid_wid];
    }
  }
}

class PlotWindowHandler {
  // NOTE: the .bind(this) stuff is an emulation of the pythonic callback function style
  constructor(getIdPlotdataCB) {
    this.idx = 0;
    this.plotWindows = [];
    this.getIdPlotdataCB = getIdPlotdataCB; // expected to return node drag-from id and plotdata
  }
  newPlotwindow(xpos, ypos, nodeid=null, plotdata=null) {
    let wname = "window_" + String(this.idx++);
    if (nodeid!=null &&plotdata != null) {
      this.plotWindows.push(new PlotWindow(this._pwMouseUpCB.bind(this), wname, xpos, ypos, nodeid, plotdata));
    } else {
      this.plotWindows.push(new PlotWindow(this._pwMouseUpCB.bind(this), wname, xpos, ypos));
    }
  }
  removePlots(id) {
    for (let i=0;i<this.plotWindows.length;i++) {
      let pltw = this.plotWindows[i];
      let didremove = pltw.removePlot(id);
      if (didremove && pltw.numPlots() == 0) pltw.close();
    }
  }
  getAllPlots() {
    // just returns all plots with data in them, as they are
  }
  _pwMouseUpCB(pltw) {
    let uisays = this.getIdPlotdataCB();
    if (uisays) pltw.addPlot(uisays.id, uisays.plotdata);
  }
}
