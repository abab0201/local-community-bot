// Local Community Discord-LINE Bridge
function doPost(e) {
  var json = JSON.parse(e.postData.contents);
  console.log("Success: " + JSON.stringify(json));
}
