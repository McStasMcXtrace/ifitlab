//
//  A plain jquery ui lib to accompany graphui
//
function testCreateDivs() {
  let container = $('<div id="' + "hest" + '">')
    .css({
      "background-color":"#8888a0",
      position:"absolute",
      width:"330px",
      height:"20px",
    })
    .appendTo('body');
}

function createSubWindow(id, title="test_title", xpos=100, ypos=100) {
  let headerwidth = 300;
  let headerheight = 25;
  let container_id = id + "_container";
  let container = $('<div id="ID">'.replace("ID", container_id))
    .css({
      position:"absolute",
      left:xpos+"px",
      top:ypos+"px",
    })
    .appendTo('body');
  let header_id = id + "_header";
  let header = $('<div id="ID">'.replace("ID", header_id))
    .css({
      position:"relative",
      width:"330px",
      height:"20px",
      cursor:"grab",
      "background-color":"#8888a0",
      "border-style":"solid",
      "border-color":"gray",
      display:"inline-block",
    })
    .appendTo('#'+container_id)
    .html(title);
  let minmiz_id = id + "_minmiz";
  let minsquare = $('<div id="ID">'.replace("ID", minmiz_id))
    .css({
      position:"relative",
      left: "310px",
      top:"0px",
      width:"20px",
      height:"20px",
      "margin-top":"-22px",
      "margin-left":"-3px",
      cursor:"pointer",
      "background-color":"white",
      "border-style":"solid",
    })
    .appendTo('#'+header_id);
  let winbody_id = id + "_body";
  let winbody = $('<div id="ID">'.replace("ID", winbody_id))
    .css({
      position:"relative",
      width:"330px",
      height:"220px",
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
  return winbody_id;
}
