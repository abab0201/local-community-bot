// Local Community Discord-LINE Bridge
// 具体的処理の実装案

var LINE_NOTIFY_TOKEN = "YOUR_LINE_TOKEN"; // あとで自分のトークンを入れる場所

function doPost(e) {
  var json = JSON.parse(e.postData.contents);
  
  // Discordからのメッセージ内容を取得
  var userName = json.username;
  var message = json.content;
  
  if (message) {
    sendToLine(userName + ": " + message);
  }
}

function sendToLine(text) {
  // LINE Notifyなどを利用してメッセージを飛ばすロジック
  console.log("LINEへ送信中: " + text);
  // 実際にはここに UrlFetchApp.fetch() などを記述します
}
