const CONFIG = {
  LINE_CHANNEL_ACCESS_TOKEN: PropertiesService.getScriptProperties().getProperty('LINE_ACCESS_TOKEN'),
  DISCORD_WEBHOOK_URL: PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK_URL'),
  DISCORD_THREAD_ID: PropertiesService.getScriptProperties().getProperty('DISCORD_THREAD_ID'),
  DISCORD_BOT_TOKEN: PropertiesService.getScriptProperties().getProperty('DISCORD_BOT_TOKEN'),
  DISCORD_CHANNEL_ID: PropertiesService.getScriptProperties().getProperty('DISCORD_CHANNEL_ID'),
  SHEET_NAMES: { USERS: 'UserList', LOGS: 'Logs', KEYWORDS: 'Keywords', QUEUE: 'Queue' },
  NIGHT_MODE: { START_HOUR: 21, END_HOUR: 7, URGENT_KEYWORD: '緊急' },
  ROLES: { 'SanYaku': { level: 4, name: '三役' }, 'KumiYakuin': { level: 3, name: '組役員' }, 'Yakuin': { level: 2, name: '役員' }, 'Member': { level: 1, name: '会員' }, 'Blocked': { level: 0, name: '停止' } },
  COMMANDS: { '全三役連絡': { targetRole: 'SanYaku' }, '全組役員連絡': { targetRole: 'KumiYakuin' }, '全役員連絡': { targetRole: 'Yakuin' }, '全町内回覧': { targetRole: 'Member' } },
  REGISTER_KEYWORDS: { '三役登録': 'SanYaku', '組役員登録': 'KumiYakuin', '役員登録': 'Yakuin', '役員退会': 'Member', '回覧退会': 'Blocked' },
  MAX_LINE_MULTICAST: 500
};
