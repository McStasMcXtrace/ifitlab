//
//  A plain jquery ui lib to accompany graphui
//
function removeSubWindow(wname) {
  let pos = $("#"+wname+"_container").position();
  $("#"+wname+"_container").remove();
  if (pos) return [pos.left, pos.top];
}
function createSubWindow(wname, title, xpos, ypos, width=330) {
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
    .html(title);
  let minmiz_id = wname + "_minmiz";
  let minsquare = $('<div id="ID">'.replace("ID", minmiz_id))
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
      "background-color":"white",
      "border-style":"dotted",
      "border-top":"none",
    })
    .appendTo('#'+container_id);

  $("#"+minmiz_id).click(() => {
      $("#"+winbody_id).toggle(200);
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
    this.mouseUpCB = () => { mouseUpCB(this) };

    let title = wname;
    if (nodeid) title = nodeid;
    this.body_container = createSubWindow(wname, title, xpos, ypos)

    this.plotbranch = null;
    this.plot = null; // Plot1D instance or svg branch if 2D
    this.ndims = null;
    this.data = {}; // contains id: plotdata

    if (nodeid != null && plotdata != null) {
      this.addPlot(nodeid, plotdata)
    }
  }
  addPlot(nodeid, plotdata) {
    // safeties
    if (this.ndims == null) this.ndims = plotdata.ndims;
    else if (this.ndims != plotdata.ndims) return;

    // init
    if (this.plotbranch == null) {
      this.plotbranch = d3.select('#'+this.body_container[0]).append("svg");
    }
    this.data[nodeid] = plotdata;

    // plot
    plotdata.title='';
    plotdata.w = 330;
    plotdata.h = 220;

    if (this.plot == null) {
      if (this.ndims == 1) this.plot = new Plot1D(plotdata, this.plotbranch);
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

class PlotWindowHandler {
  constructor(geIdPlotdataCB) {
    this.idx = 0;
    this.plotWindows = [];

    this.getIdPlotdataCB = geIdPlotdataCB; // expected to return node drag-from id and plotdata
  }
  newPlotwindow(xpos, ypos, nodeid=null, plotdata=null) {
    let wname = "window_" + String(this.idx++);
    if (nodeid!=null &&plotdata != null) {
      this.plotWindows.push(new PlotWindow(this._pwMouseUpCB, wname, xpos, ypos, nodeid, plotdata));
    } else {
      this.plotWindows.push(new PlotWindow(this._pwMouseUpCB, wname, xpos, ypos));
    }
  }
  removePlots(id) {
    for (let i=0;i<this.plotWindows.length;i++) {
      let pltw = this.plotWindows[i];
      pltw.removePlot(id);
      if (pltw.numPlots() == 0) pltw.close();
    }
  }
  getAllPlots() {
    // just returns all plots with data in them, as they are
  }
  _pwMouseUpCB(pltw) {
    // add a plot to this window if a drag is active
    let uisays = this.getIdPlotdataCB();
    if (uisays) {
      let id = idPlotData.id;
      let plotdata = idPlotData.plotdata;
      wdw.addPlot(id, plotdata);
    }
  }
}
