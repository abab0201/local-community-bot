/**
 * LINEメッセージをDiscordへ転送
 */
function forwardToDiscord(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  const text = event.message.text;

  // 設定からコマンドリストを取得
  const commandKeys = Object.keys(CONFIG.COMMANDS);
  const ignorePattern = new RegExp(`^(${commandKeys.join('|')}|${CONFIG.NIGHT_MODE.URGENT_KEYWORD})`);
  if (text.match(ignorePattern)) return;

  const { DISCORD_WEBHOOK_URL: webhook, DISCORD_THREAD_ID: threadId, LINE_CHANNEL_ACCESS_TOKEN: token } = CONFIG;
  if (!webhook || !threadId) return;

  let userName = "LINEユーザー";
  if (token) {
    try {
      const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/profile/" + event.source.userId, {
        "headers": { "Authorization": `Bearer ${token}` }
      });
      userName = JSON.parse(res.getContentText()).displayName;
    } catch (e) { console.error(e); }
  }

  const payload = { "content": text, "username": `${userName} 📱(LINE自動転送)` };
  const options = { "method": "post", "headers": { "Content-Type": "application/json" }, "payload": JSON.stringify(payload), "muteHttpExceptions": true };

  UrlFetchApp.fetch(`${webhook}?thread_id=${threadId}`, options);
}
