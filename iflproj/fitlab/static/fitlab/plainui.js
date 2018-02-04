//
//  A plain jquery ui lib to accompany graphui
//
function createUserDataWindow() {
  let xpos = $("body").width()-510;
  let ypos = 10;
  let winbody_container_ids = createSubWindow("user_data", "User Data", xpos, ypos, 500);
  let wbody = $("#"+winbody_container_ids[0]);
  let wcontainer = $("#"+winbody_container_ids[1]);
  //wcontainer.css({ right:"0px", });
}
function removeSubWindow(id) {
  let pos = $("#"+id+"_container").position();
  $("#"+id+"_container").remove();
  if (pos) return [pos.left, pos.top];
}
function createSubWindow(id, title="test_title", xpos, ypos, width=330) {
  let headerheight = 20;
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
  let minmiz_id = id + "_minmiz";
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
  let winbody_id = id + "_body";
  let winbody = $('<div id="ID">'.replace("ID", winbody_id))
    .css({
      position:"relative",
      width:width+"px",
      //height:"220px",
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
