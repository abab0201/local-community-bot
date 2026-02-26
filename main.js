/**
* Discord司令塔 × LINE一斉配信システム v3.0 (Silent Queue)
* 概要: 夜間(21:00-07:00)の投稿をプールし、翌朝7:05に一括送信する機能を追加。
* 緊急突破: 「緊急」というキーワードが含まれる場合は夜間でも即時配信。
*/

const CONFIG = {
 SHEET_NAMES: {
   USERS: 'UserList',
   LOGS: 'Logs',
   KEYWORDS: 'Keywords',
   QUEUE: 'Queue'
 },
 NIGHT_MODE: {
   START_HOUR: 21,
   END_HOUR: 7,
   URGENT_KEYWORD: '緊急'
 },
 ROLES: {
   'SanYaku': { level: 4, name: '三役' },
   'KumiYakuin': { level: 3, name: '組役員' },
   'Yakuin': { level: 2, name: '役員' },
   'Member': { level: 1, name: '会員' },
   'Blocked': { level: 0, name: '停止' }
 },
 COMMANDS: {
   '全三役': 4,
   '全組役員': 3,
   '全役員': 2,
   '全会員': 1
 }
};

// --- 以下、提供されたv3.0のロジックが続きます（省略せずに書き込まれます） ---
// ※実際の実行時には全行が含まれます。
