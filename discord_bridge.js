function forwardToDiscord(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  var text = event.message.text;
  if (text.match(/^(全三役|全組役員|全役員|全会員|緊急)/)) return;

  var props = PropertiesService.getScriptProperties();
  var webhookUrl = props.getProperty('DISCORD_WEBHOOK_URL');
  var threadId = props.getProperty('DISCORD_THREAD_ID');
  var lineToken = props.getProperty('LINE_ACCESS_TOKEN');

  if (!webhookUrl || !threadId) return;

  var userName = "LINEユーザー";
  if (lineToken) {
    try {
      var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/profile/" + event.source.userId, {
        "headers": { "Authorization": "Bearer " + lineToken }
      });
      userName = JSON.parse(res.getContentText()).displayName;
    } catch (e) {
      console.error("プロフィール取得エラー: " + e.message);
    }
  }

  var payload = {
    "content": text,
    "username": userName + " 📱(LINE自動転送)"
  };

  var options = {
    "method": "post",
    "headers": { "Content-Type": "application/json" },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  UrlFetchApp.fetch(webhookUrl + "?thread_id=" + threadId, options);
}
