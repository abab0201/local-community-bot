/**
 * Discord司令塔 × LINE一斉配信システム v3.2 (Refactored)
 */

function flushQueue() {
  console.log('🌅 朝の定時配信処理を開始します...');
  const bot = new BotApp();
  bot.processQueue();
}

function setup() {
  const sheetRepo = new SheetRepository();
  sheetRepo.ensureSheets();
  setTrigger('triggerSync', 10);
  setDailyTrigger('flushQueue', 7, 5);
  console.log('✅ セットアップ完了: ' + sheetRepo.ss.getUrl());
}

function setTrigger(funcName, m) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(funcName).timeBased().everyMinutes(m).create();
}

function setDailyTrigger(funcName, h, m) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(funcName).timeBased().atHour(h).nearMinute(m).everyDays(1).create();
}

function doPost(e) {
  const bot = new BotApp();
  try { bot.handleLineEvent(e); } catch (err) { console.error(err); }
  return ContentService.createTextOutput(JSON.stringify({content: "post ok"})).setMimeType(ContentService.MimeType.JSON);
}

function triggerSync() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try { (new BotApp()).syncDiscordToLine(); } catch (e) { console.error(e); } finally { lock.releaseLock(); }
}

class BotApp {
  constructor() {
    this.sheetRepo = new SheetRepository();
    this.lineService = new LineService();
    this.discordService = new DiscordService();
  }
  processQueue() {
    const items = this.sheetRepo.getAndClearQueue();
    if (items.length === 0) return;
    this.discordService.sendAlert(`🌅 夜間の保留 ${items.length}件 を配信します。`);
    items.forEach(item => this.executeBroadcast(item.sender, item.roleKey, item.body, item.imageUrl, null, true));
  }
  handleLineEvent(e) {
    if (!e || !e.postData) return;
    const events = JSON.parse(e.postData.contents).events;
    events.forEach(event => {
      if (event.type === 'message' && event.message.type === 'text') {
        const text = event.message.text.trim();
        const userId = event.source.userId;
        if (CONFIG.REGISTER_KEYWORDS[text]) {
          this.handleRegistration(userId, text, event.replyToken);
        } else if (text === '統計確認') {
          this.handleStatistics(userId, event.replyToken);
        } else {
          const cmd = this.findCommand(text);
          if (cmd) {
            this.handleLineBroadcast(userId, text, cmd, event.replyToken);
          } else {
            forwardToDiscord(event);
          }
        }
      }
    });
  }
  handleRegistration(uid, kw, rt) {
    const rk = CONFIG.REGISTER_KEYWORDS[kw];
    const p = this.lineService.getProfile(uid);
    const n = p ? p.displayName : 'Unknown';
    this.sheetRepo.upsertUser(uid, n, rk);
    this.lineService.reply(rt, [{ type: 'text', text: `登録完了: ${CONFIG.ROLES[rk].name}` }]);
    this.discordService.sendAlert(`🆕 登録: ${n} (${CONFIG.ROLES[rk].name})`);
  }
  handleStatistics(uid, rt) {
    if (this.sheetRepo.getUserRole(uid) !== 'SanYaku') return;
    const stats = this.sheetRepo.getUserStats();
    let msg = '📊 登録状況\n';
    for(const r in stats) msg += `${CONFIG.ROLES[r].name}: ${stats[r]}名\n`;
    this.lineService.reply(rt, [{ type: 'text', text: msg }]);
  }
  handleLineBroadcast(uid, txt, cmd, rt) {
    if (this.sheetRepo.getUserRole(uid) !== 'SanYaku') return;
    const body = txt.replace(cmd.key, '').trim() || '(本文なし)';
    const p = this.lineService.getProfile(uid);
    const res = this.executeBroadcast(p ? p.displayName : '三役', cmd.targetRole, body, null, uid);
    this.lineService.reply(rt, [{ type: 'text', text: res.status === 'queued' ? '🌙 夜間予約完了' : '✅ 配信完了' }]);
  }
  syncDiscordToLine() {
    const msgs = this.discordService.fetchRecentMessages();
    msgs.reverse().forEach(msg => {
      const cmd = this.findCommand(msg.content.trim());
      if (cmd) {
        const body = msg.content.replace(cmd.key, '').trim() || '(本文なし)';
        const res = this.executeBroadcast(msg.author.username, cmd.targetRole, body, null);
        this.discordService.sendMessage(res.status === 'queued' ? '🌙 夜間予約' : '✅ LINE転送完了');
      }
    });
  }
  executeBroadcast(s, rk, b, img, ex, f = false) {
    const isNight = this.isNightTime();
    if (isNight && !b.includes(CONFIG.NIGHT_MODE.URGENT_KEYWORD) && !f) {
      this.sheetRepo.addToQueue(s, rk, b, img);
      return { status: 'queued' };
    }
    const targetIds = this.sheetRepo.getUsersByRole(rk).filter(u => u.userId !== ex).map(u => u.userId);
    if (targetIds.length > 0) {
      const h = b.includes(CONFIG.NIGHT_MODE.URGENT_KEYWORD) ? '🚨【緊急】' : `【${CONFIG.ROLES[rk].name}連絡】`;
      this.lineService.multicast(targetIds, [{ type: 'text', text: `${h}\n発信者: ${s}\n\n${b}` }]);
    }
    return { status: 'sent', count: targetIds.length };
  }
  findCommand(t) {
    for (const [k, v] of Object.entries(CONFIG.COMMANDS)) { if (t.startsWith(k)) return { key: k, ...v }; }
    return null;
  }
  isNightTime() {
    const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours();
    const { START_HOUR: s, END_HOUR: e } = CONFIG.NIGHT_MODE;
    return s > e ? (h >= s || h < e) : (h >= s && h < e);
  }
}

class SheetRepository {
  constructor() { this.ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('DB_SPREADSHEET_ID')); }
  ensureSheets() {
    const s = CONFIG.SHEET_NAMES;
    this._init(s.USERS, ['UserID', 'DisplayName', 'Role', 'RegisteredAt', 'UpdatedAt']);
    this._init(s.QUEUE, ['Timestamp', 'Sender', 'RoleKey', 'Body', 'ImageUrl']);
  }
  _init(n, h) { if (!this.ss.getSheetByName(n)) this.ss.insertSheet(n).appendRow(h); }
  addToQueue(s, r, b, i) { this.ss.getSheetByName(CONFIG.SHEET_NAMES.QUEUE).appendRow([new Date(), s, r, b, i || '']); }
  getAndClearQueue() {
    const sheet = this.ss.getSheetByName(CONFIG.SHEET_NAMES.QUEUE);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    const items = data.slice(1).map(r => ({ sender: r[1], roleKey: r[2], body: r[3], imageUrl: r[4] }));
    if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
    return items;
  }
  upsertUser(uid, n, r) {
    const s = this.ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
    const d = s.getDataRange().getValues();
    for (let i = 1; i < d.length; i++) { if (d[i][0] === uid) { s.getRange(i + 1, 2, 1, 4).setValues([[n, r, d[i][3], new Date()]]); return; } }
    s.appendRow([uid, n, r, new Date(), new Date()]);
  }
  getUsersByRole(rk) {
    const lv = CONFIG.ROLES[rk].level;
    return this.ss.getSheetByName(CONFIG.SHEET_NAMES.USERS).getDataRange().getValues().slice(1)
      .filter(r => CONFIG.ROLES[r[2]] && CONFIG.ROLES[r[2]].level >= lv).map(r => ({ userId: r[0], name: r[1] }));
  }
  getUserRole(uid) {
    const r = this.ss.getSheetByName(CONFIG.SHEET_NAMES.USERS).getDataRange().getValues().find(r => r[0] === uid);
    return r ? r[2] : 'Member';
  }
  getUserStats() {
    const s = {};
    this.ss.getSheetByName(CONFIG.SHEET_NAMES.USERS).getDataRange().getValues().slice(1).forEach(r => { s[r[2]] = (s[r[2]] || 0) + 1; });
    return s;
  }
}

class LineService {
  constructor() { this.u = 'https://api.line.me/v2/bot'; }
  reply(t, m) { UrlFetchApp.fetch(`${this.u}/message/reply`, { headers: { Authorization: `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, method: 'post', payload: JSON.stringify({ replyToken: t, messages: m }) }); }
  multicast(ids, msgs) {
    for (let i = 0; i < ids.length; i += 500) {
      UrlFetchApp.fetch(`${this.u}/message/multicast`, { headers: { Authorization: `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, method: 'post', payload: JSON.stringify({ to: ids.slice(i, i + 500), messages: msgs }) });
    }
  }
  getProfile(id) { try { return JSON.parse(UrlFetchApp.fetch(`${this.u}/profile/${id}`, { headers: { Authorization: `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}` } })); } catch(e) { return null; } }
}

class DiscordService {
  sendAlert(c) { if (CONFIG.DISCORD_WEBHOOK_URL) UrlFetchApp.fetch(CONFIG.DISCORD_WEBHOOK_URL, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ content: c }) }); }
  sendMessage(c) { if (CONFIG.DISCORD_BOT_TOKEN) UrlFetchApp.fetch(`https://discord.com/api/v10/channels/${CONFIG.DISCORD_CHANNEL_ID}/messages`, { method: 'post', headers: { Authorization: `Bot ${CONFIG.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, payload: JSON.stringify({ content: c }) }); }
  fetchRecentMessages() {
    const p = PropertiesService.getScriptProperties();
    const lastId = p.getProperty('DISCORD_LAST_MESSAGE_ID');
    const url = `https://discord.com/api/v10/channels/${CONFIG.DISCORD_CHANNEL_ID}/messages?limit=5${lastId ? `&after=${lastId}` : ''}`;
    try {
      const res = UrlFetchApp.fetch(url, { headers: { Authorization: `Bot ${CONFIG.DISCORD_BOT_TOKEN}` }, muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) return [];
      const msgs = JSON.parse(res.getContentText()).filter(m => !m.author.bot);
      if (msgs.length > 0) p.setProperty('DISCORD_LAST_MESSAGE_ID', msgs[0].id);
      return msgs;
    } catch(e) { return []; }
  }
}
