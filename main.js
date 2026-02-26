/**
 * Discord司令塔 × LINE一斉配信システム v3.0 (Silent Queue)
 * * 概要: 夜間(21:00-07:00)の投稿をプールし、翌朝7:05に一括送信する機能を追加。
 * * 緊急突破: 「緊急」というキーワードが含まれる場合は夜間でも即時配信。
 */

// ==========================================
// 設定・定数定義
// ==========================================
const CONFIG = {
  SHEET_NAMES: {
    USERS: 'UserList',
    LOGS: 'Logs',
    KEYWORDS: 'Keywords',
    QUEUE: 'Queue' // 新設: 送信待ち行列
  },
  // 夜間モード設定
  NIGHT_MODE: {
    START_HOUR: 21, // 21時から
    END_HOUR: 7,    // 7時まで (7:00含む、7:01以降解除)
    URGENT_KEYWORD: '緊急' // この言葉が入っていれば夜間でも即時送信
  },
  ROLES: {
    'SanYaku': { level: 4, name: '三役' },
    'KumiYakuin': { level: 3, name: '組役員' },
    'Yakuin': { level: 2, name: '役員' },
    'Member': { level: 1, name: '会員' },
    'Blocked': { level: 0, name: '停止' }
  },
  COMMANDS: {
    '全三役連絡': { targetRole: 'SanYaku' },
    '全組役員連絡': { targetRole: 'KumiYakuin' },
    '全役員連絡': { targetRole: 'Yakuin' },
    '全町内回覧': { targetRole: 'Member' }
  },
  REGISTER_KEYWORDS: {
    '三役登録': 'SanYaku',
    '組役員登録': 'KumiYakuin',
    '役員登録': 'Yakuin',
    '役員退会': 'Member',
    '回覧退会': 'Blocked'
  },
  MAX_LINE_MULTICAST: 500
};

// ==========================================
// エントリーポイント
// ==========================================

/**
 * 毎朝 07:05 に実行されるトリガー関数
 * サイレント・キューに溜まったメッセージを放出する
 */
function flushQueue() {
  console.log('🌅 朝の定時配信処理を開始します...');
  const bot = new BotApp();
  bot.processQueue();
}

/**
 * セットアップ関数
 * シート作成と、監視トリガー・朝の配信トリガーの両方をセットする
 */
function setup() {
  console.log('セットアップを開始します...');
  const sheetRepo = new SheetRepository();
  sheetRepo.ensureSheets();
  
  // 1. Discord監視トリガー (10分間隔)
  setTrigger('triggerSync', 10);
  
  // 2. 朝の解放トリガー (毎日 07:05)
  setDailyTrigger('flushQueue', 7, 5);
  
  const ssUrl = sheetRepo.ss.getUrl();
  console.log('✅ セットアップが完了しました。');
  console.log('📁 データベース: ' + ssUrl);
}

// 監視用トリガー設定
function setTrigger(funcName, minutes) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(funcName).timeBased().everyMinutes(minutes).create();
}

// 朝の定時トリガー設定
function setDailyTrigger(funcName, hour, minute) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(funcName).timeBased().atHour(hour).nearMinute(minute).everyDays(1).create();
}

/**
 * LINE Webhook
 */
function doPost(e) {
  const bot = new BotApp();
  try {
    bot.handleLineEvent(e);
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput(JSON.stringify({content: "post ok"})).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Discord監視実行
 */
function triggerSync() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    console.log('🔍 Discord同期処理(v3.0)を実行中...');
    const bot = new BotApp();
    bot.syncDiscordToLine();
  } catch (e) {
    console.error('Sync Error:', e);
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 診断用
// ==========================================
function debugResetAndCheck() {
  console.log('🔄 強制リセット...');
  PropertiesService.getScriptProperties().deleteProperty('DISCORD_LAST_MESSAGE_ID');
  triggerSync();
}

// ==========================================
// ビジネスロジック層 (BotApp)
// ==========================================

class BotApp {
  constructor() {
    this.sheetRepo = new SheetRepository();
    this.lineService = new LineService();
    this.discordService = new DiscordService();
  }

  // 朝のキュー処理
  processQueue() {
    const queuedItems = this.sheetRepo.getAndClearQueue();
    if (queuedItems.length === 0) {
      console.log('📭 送信待ちのメッセージはありませんでした。');
      return;
    }

    console.log(`📬 ${queuedItems.length}件の保留メッセージを送信します...`);
    
    // Discordへ通知
    this.discordService.sendAlert(`🌅 おはようございます。夜間にプールされた ${queuedItems.length}件 のメッセージを配信します。`);

    queuedItems.forEach(item => {
      // item: { sender, roleKey, body, imageUrl, timestamp }
      const result = this.executeBroadcast(
        item.sender, 
        item.roleKey, 
        item.body, 
        item.imageUrl, 
        null, 
        true // forceSend: true (朝なので強制送信)
      );
      
      this.sheetRepo.log('Broadcast(Queue)', `Released: ${item.sender} -> ${item.roleKey}`, `Body: ${item.body}`);
    });
  }

  handleLineEvent(e) {
    if (!e || !e.postData) return;
    const events = JSON.parse(e.postData.contents).events;

    events.forEach(event => {
      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        const text = event.message.text.trim();
        const replyToken = event.replyToken;

        if (CONFIG.REGISTER_KEYWORDS[text]) {
          this.handleRegistration(userId, text, replyToken);
          return;
        }
        if (text === '統計確認') {
          this.handleStatistics(userId, replyToken);
          return;
        }
        const command = this.findCommand(text);
        if (command) {
          this.handleLineBroadcast(userId, text, command, replyToken);
          return;
        }
        const autoResponse = this.sheetRepo.findResponseByKeyword(text);
        if (autoResponse) {
          this.lineService.reply(replyToken, [{ type: 'text', text: autoResponse }]);
          return;
        }
        this.handleOtherMessage(userId, text);
      }
    });
  }

  handleStatistics(userId, replyToken) {
    const senderRole = this.sheetRepo.getUserRole(userId);
    if (senderRole !== 'SanYaku') {
      this.lineService.reply(replyToken, [{ type: 'text', text: '⛔ 権限なし' }]);
      return;
    }
    const stats = this.sheetRepo.getUserStats();
    let msg = '📊 登録状況\n';
    let total = 0;
    for(const r in stats) {
       msg += `${CONFIG.ROLES[r].name}: ${stats[r]}名\n`;
       total += stats[r];
    }
    msg += `総計: ${total}名`;
    this.lineService.reply(replyToken, [{ type: 'text', text: msg }]);
  }

  handleRegistration(userId, keyword, replyToken) {
    const newRoleKey = CONFIG.REGISTER_KEYWORDS[keyword];
    const newRoleName = CONFIG.ROLES[newRoleKey].name;
    const profile = this.lineService.getProfile(userId);
    const displayName = profile ? profile.displayName : 'Unknown';
    this.sheetRepo.upsertUser(userId, displayName, newRoleKey);
    this.lineService.reply(replyToken, [{ type: 'text', text: `登録完了: ${newRoleName}\n名前: ${displayName}` }]);
    this.discordService.sendAlert(`🆕 登録: ${displayName} (${newRoleName})`);
  }

  handleLineBroadcast(userId, fullText, commandObj, replyToken) {
    const senderRole = this.sheetRepo.getUserRole(userId);
    if (senderRole !== 'SanYaku') {
      this.lineService.reply(replyToken, [{ type: 'text', text: '⛔ 権限がありません。' }]);
      return;
    }
    let body = fullText.replace(commandObj.key, '').trim();
    if (!body) body = '(本文なし)';
    const profile = this.lineService.getProfile(userId);
    const senderName = profile ? profile.displayName : '三役';
    
    const result = this.executeBroadcast(senderName, commandObj.targetRole, body, null, userId);
    
    let replyMsg = '';
    if (result.status === 'queued') {
      replyMsg = `🌙 夜間モード中 (21:00-07:00)\nメッセージをお預かりしました。\n翌朝07:05に配信されます。\n(「${CONFIG.NIGHT_MODE.URGENT_KEYWORD}」を含めると即時送信されます)`;
    } else {
      replyMsg = `✅ 配信完了\n対象: ${CONFIG.ROLES[commandObj.targetRole].name}以上\n送信数: ${result.count}件`;
    }

    this.lineService.reply(replyToken, [{ type: 'text', text: replyMsg }]);
    
    // ログ通知
    const statusIcon = result.status === 'queued' ? 'zzz' : '📢';
    const logMsg = `${statusIcon} LINE経由: ${senderName} -> ${CONFIG.ROLES[commandObj.targetRole].name} (${result.status === 'queued' ? '予約' : result.count + '人'})`;
    this.discordService.sendAlert(logMsg);
    this.sheetRepo.log('Broadcast(LINE)', logMsg, `Body: ${body}`);
  }

  handleOtherMessage(userId, text) {
    const profile = this.lineService.getProfile(userId);
    const displayName = profile ? profile.displayName : 'Unknown';
    const role = this.sheetRepo.getUserRole(userId);
    this.sheetRepo.log('UserMessage', `From: ${displayName}`, text);
    this.discordService.sendAlert(`📩 受信: ${displayName}\n${text}`);
  }

  syncDiscordToLine() {
    let messages = [];
    try {
      messages = this.discordService.fetchRecentMessages();
    } catch (e) {
      console.warn('Discord Fetch Failed:', e.message);
      return;
    }
    
    if (messages.length === 0) return;

    messages.reverse().forEach(msg => {
      const content = msg.content.trim();
      const command = this.findCommand(content);

      if (command) {
        let body = content.replace(command.key, '').trim();
        const attachments = msg.attachments || [];
        let imageUrl = null;
        if (attachments.length > 0 && attachments[0].content_type.startsWith('image/')) {
          imageUrl = attachments[0].url;
        } else if (msg.embeds && msg.embeds.length > 0) {
           // Embed logic
           if(msg.embeds[0].image) imageUrl = msg.embeds[0].image.url;
        }

        if (!body && !imageUrl) body = '(画像または本文のみ)';

        const result = this.executeBroadcast(msg.author.username, command.targetRole, body, imageUrl);
        
        let discordReply = '';
        if (result.status === 'queued') {
          discordReply = `🌙 **Silent Queue**: 夜間モードのためスプレッドシートに保存しました。\n翌朝07:05に配信されます。\n(「${CONFIG.NIGHT_MODE.URGENT_KEYWORD}」を含めると即時配信)`;
        } else {
          discordReply = `✅ LINE転送完了: ${result.count}人に配信しました。`;
        }

        this.discordService.sendMessage(discordReply);
        this.sheetRepo.log('Broadcast(Discord)', `Author: ${msg.author.username} -> ${command.targetRole}`, `Result: ${result.status}`);
      }
    });
  }

  /**
   * 共通配信ロジック (夜間判定入り)
   * forceSend: trueなら夜間でも強制送信(朝の放出時用)
   */
  executeBroadcast(senderName, targetRoleKey, body, imageUrl, excludeUserId = null, forceSend = false) {
    // 1. 夜間モード判定
    const isNight = this.isNightTime();
    const isUrgent = body.includes(CONFIG.NIGHT_MODE.URGENT_KEYWORD);

    // 夜間 かつ 緊急でない かつ 強制送信フラグがない場合 -> キューに入れる
    if (isNight && !isUrgent && !forceSend) {
      this.sheetRepo.addToQueue(senderName, targetRoleKey, body, imageUrl);
      return { status: 'queued', count: 0, names: '' };
    }

    // 2. 通常配信処理
    const targetUsers = this.sheetRepo.getUsersByRole(targetRoleKey);
    if (targetUsers.length === 0) return { status: 'empty', count: 0, names: '' };

    let validUsers = targetUsers;
    if (excludeUserId) validUsers = targetUsers.filter(u => u.userId !== excludeUserId);
    if (validUsers.length === 0) return { status: 'empty', count: 0, names: '' };

    const userIds = validUsers.map(u => u.userId);
    const userNames = validUsers.map(u => u.name).join(', ');
    
    const messages = [];
    // ヘッダー (緊急時は目立たせる)
    const headerTitle = isUrgent ? `🚨【${CONFIG.ROLES[targetRoleKey].name} 緊急連絡】🚨` : `【${CONFIG.ROLES[targetRoleKey].name}連絡】`;
    
    messages.push({
      type: 'text',
      text: `${headerTitle}\n発信者: ${senderName}\n\n${body}`
    });

    if (imageUrl) {
      messages.push({
        type: 'image',
        originalContentUrl: imageUrl,
        previewImageUrl: imageUrl
      });
    }

    this.lineService.multicast(userIds, messages);
    return { status: 'sent', count: userIds.length, names: userNames };
  }

  findCommand(text) {
    for (const [key, val] of Object.entries(CONFIG.COMMANDS)) {
      if (text.startsWith(key)) return { key: key, ...val };
    }
    return null;
  }

  // 現在時刻が夜間モード内か判定 (JST)
  isNightTime() {
    const now = new Date();
    // 日本時間での時間を取得
    const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const hour = jstNow.getHours();
    
    const start = CONFIG.NIGHT_MODE.START_HOUR; // 21
    const end = CONFIG.NIGHT_MODE.END_HOUR;     // 7

    // 21時以降(21,22,23...) または 7時以前(0,1,...7)
    // ※7:00:00〜7:59:59も「7時」なので、7時を含めて止めたいなら hour <= end
    // ここでは 7:05に解除して送るので、7時台は「解除後」であるべきか？
    // 要件: 「07:05にトリガーで一斉送信」
    // つまり、07:05の時点では「夜間ではない」と判定される必要がある。
    // hour <= end (7) だと、7:05も夜間扱いになり、無限ループ(キューから出してまたキューに入る)する恐れがある。
    // なので、厳密には hour < end (7時になった瞬間に夜間終了) とする。
    
    if (start > end) {
      // 日付をまたぐ場合 (例: 21:00 〜 07:00)
      return (hour >= start || hour < end);
    } else {
      // 日付をまたがない場合 (例: 01:00 〜 05:00)
      return (hour >= start && hour < end);
    }
  }
}

// ==========================================
// データアクセス層
// ==========================================
class SheetRepository {
  constructor() {
    let ss = null;
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
    if (!ss) {
      const props = PropertiesService.getScriptProperties();
      const savedId = props.getProperty('DB_SPREADSHEET_ID');
      if (savedId) { try { ss = SpreadsheetApp.openById(savedId); } catch (e) {} }
    }
    if (!ss) {
      ss = SpreadsheetApp.create('連絡網システムDB');
      PropertiesService.getScriptProperties().setProperty('DB_SPREADSHEET_ID', ss.getId());
    }
    this.ss = ss;
  }

  ensureSheets() {
    this._initSheet(CONFIG.SHEET_NAMES.USERS, ['UserID', 'DisplayName', 'Role', 'RegisteredAt', 'UpdatedAt']);
    this._initSheet(CONFIG.SHEET_NAMES.LOGS, ['Timestamp', 'Category', 'Subject', 'Detail']);
    this._initSheet(CONFIG.SHEET_NAMES.KEYWORDS, ['Keyword', 'Response']);
    this._initSheet(CONFIG.SHEET_NAMES.QUEUE, ['Timestamp', 'Sender', 'RoleKey', 'Body', 'ImageUrl']); // Queueシート追加
  }

  _initSheet(name, headers) {
    let sheet = this.ss.getSheetByName(name);
    if (!sheet) {
      sheet = this.ss.insertSheet(name);
      sheet.appendRow(headers);
    }
  }

  // キューに追加
  addToQueue(sender, roleKey, body, imageUrl) {
    const sheet = this.ss.getSheetByName(CONFIG.SHEET_NAMES.QUEUE);
    sheet.appendRow([new Date(), sender, roleKey, body, imageUrl || '']);
  }

  // キューから全取得してクリア
  getAndClearQueue() {
    const sheet = this.ss.getSheetByName(CONFIG.SHEET_NAMES.QUEUE);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; // ヘッダーのみ

    const items = [];
    // 1行目はヘッダーなのでスキップ
    for (let i = 1; i < data.length; i++) {
      items.push({
        sender: data[i][1],
        roleKey: data[i][2],
        body: data[i][3],
        imageUrl: data[i][4]
      });
    }

    // データ部分のみ削除 (ヘッダーを残す)
    // 行数取得: getLastRow
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }

    return items;
  }

  findResponseByKeyword(text) {
    const sheet = this.ss.getSheetByName(CONFIG.SHEET_NAMES.KEYWORDS);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const keyword = String(data[i][0]).trim();
      if (keyword !== '' && text.includes(keyword)) return data[i][1];
    }
    return null;
  }

  upsertUser(userId, displayName, role) {
    const sheet = this.ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === userId) {
        sheet.getRange(i + 1, 2).setValue(displayName);
        sheet.getRange(i + 1, 3).setValue(role);
        sheet.getRange(i + 1, 5).setValue(now);
        return;
      }
    }
    sheet.appendRow([userId, displayName, role, now, now]);
  }

  getUserStats() {
    const sheet = this.ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const stats = {};
    for (let i = 1; i < data.length; i++) {
      const role = data[i][2]; 
      if (role) stats[role] = (stats[role] || 0) + 1;
    }
    return stats;
  }

  getUsersByRole(targetRoleKey) {
    const targetLevel = CONFIG.ROLES[targetRoleKey].level;
    const sheet = this.ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const users = [];
    for (let i = 1; i < data.length; i++) {
      const [uid, name, role] = [data[i][0], data[i][1], data[i][2]];
      const roleConfig = CONFIG.ROLES[role];
      if (roleConfig && roleConfig.level >= targetLevel) {
        users.push({ userId: uid, name: name });
      }
    }
    return users;
  }

  getUserRole(userId) {
    const sheet = this.ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === userId) return data[i][2];
    }
    return 'Member';
  }

  log(category, subject, detail = '') {
    const sheet = this.ss.getSheetByName(CONFIG.SHEET_NAMES.LOGS);
    sheet.appendRow([new Date(), category, subject, detail]);
  }
}

// ==========================================
// 外部APIサービス層
// ==========================================
class LineService {
  constructor() {
    this.token = PropertiesService.getScriptProperties().getProperty('LINE_ACCESS_TOKEN');
    this.apiUrl = 'https://api.line.me/v2/bot';
  }
  reply(replyToken, messages) {
    UrlFetchApp.fetch(`${this.apiUrl}/message/reply`, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
      method: 'post', payload: JSON.stringify({ replyToken: replyToken, messages: messages })
    });
  }
  multicast(userIds, messages) {
    const chunkSize = CONFIG.MAX_LINE_MULTICAST;
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);
      const uniqueIds = [...new Set(chunk)];
      try {
        UrlFetchApp.fetch(`${this.apiUrl}/message/multicast`, {
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
          method: 'post', payload: JSON.stringify({ to: uniqueIds, messages: messages })
        });
        Utilities.sleep(200); 
      } catch (e) {
        console.error('Line Multicast Error:', e);
        new SheetRepository().log('Error', 'Multicast Failed', e.toString());
      }
    }
  }
  getProfile(userId) {
    try {
      const res = UrlFetchApp.fetch(`${this.apiUrl}/profile/${userId}`, { headers: { 'Authorization': `Bearer ${this.token}` } });
      return JSON.parse(res.getContentText());
    } catch (e) { return null; }
  }
}

class DiscordService {
  constructor() {
    const props = PropertiesService.getScriptProperties();
    this.webhookUrl = props.getProperty('DISCORD_WEBHOOK_URL');
    this.botToken = props.getProperty('DISCORD_BOT_TOKEN');
    this.channelId = props.getProperty('DISCORD_CHANNEL_ID');
  }
  sendAlert(text) {
    if (!this.webhookUrl) return;
    try {
      UrlFetchApp.fetch(this.webhookUrl, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ content: text }) });
    } catch (e) {}
  }
  sendMessage(text) {
    if (!this.botToken || !this.channelId) return;
    try {
      UrlFetchApp.fetch(`https://discord.com/api/v10/channels/${this.channelId}/messages`, {
        method: 'post', headers: {
          'Authorization': `Bot ${this.botToken}`, 'Content-Type': 'application/json',
          'User-Agent': 'DiscordBot (https://google.com, v3.0) AppsScript/1.0' 
        }, payload: JSON.stringify({ content: text })
      });
    } catch (e) {}
  }
  fetchRecentMessages() {
    const props = PropertiesService.getScriptProperties();
    const lastId = props.getProperty('DISCORD_LAST_MESSAGE_ID');
    let url = `https://discord.com/api/v10/channels/${this.channelId}/messages?limit=5`;
    if (lastId) url += `&after=${lastId}`;
    try {
      const options = {
        headers: { 'Authorization': `Bot ${this.botToken}`, 'User-Agent': 'DiscordBot (https://google.com, v3.0) AppsScript/1.0' },
        muteHttpExceptions: true
      };
      const res = this.fetchWithRetry(url, options);
      if (res.getResponseCode() !== 200) throw new Error(res.getContentText());
      const messages = JSON.parse(res.getContentText());
      const validMessages = messages.filter(m => !m.author.bot);
      if (validMessages.length > 0) props.setProperty('DISCORD_LAST_MESSAGE_ID', messages[0].id);
      return validMessages;
    } catch (e) { throw e; }
  }
  fetchWithRetry(url, options, maxRetries = 2) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = UrlFetchApp.fetch(url, options);
        if (res.getResponseCode() === 200) return res;
        if (res.getResponseCode() === 429 || res.getResponseCode() === 403) {
          Utilities.sleep(10000); continue;
        }
        return res;
      } catch (e) { Utilities.sleep(10000); }
    }
    return UrlFetchApp.fetch(url, options);
  }
}



