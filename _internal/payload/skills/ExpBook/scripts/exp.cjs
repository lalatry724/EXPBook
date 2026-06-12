#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- 常數（冒險者公會制）----
const LEVEL_STEP = 1000;
const EXP_OF = { task: 200, lesson: 20, chore: 1, fail: 1, regress: 1 }; // 預設值；config.json 可覆寫（見 loadConfig）
const KIND_LABEL = { task: '任務', lesson: '心法', chore: '練功', fail: '敗戰', regress: '常錯' };
const DEFAULT_DUNGEON = '日常訓練(雜項)';                 // 未指明地城時的預設
const DEFAULT_SKILLS = ['除錯', '架構', '實作', '重構', '研究', '工具', '知識']; // 面板恆顯示；可自由新增其他技能 tag

// ---- 技能分類（純 render-time 分組；不改 log.jsonl 原始 tag，僅面板彙總）----
// 結構：群組 → 分類 → 成員 tag。面板顯示「分類小計」，原始細 tag 保留為明細（history/report 不受影響）。
// 要新增/搬動分類：改這張表即可，純渲染可回溯。未列入任何分類的 tag 自動歸「未分類」群，提示待歸。
const SKILL_GROUPS = [
  { group: '核心', cats: [
    { name: '除錯', members: ['除錯', 'debugging', 'systematic-debugging'] },
    { name: '架構', members: ['架構', '規格設計', 'model-lock', 'done-gate'] },
    { name: '實作', members: ['實作', 'frontend', 'chatLog', 'payload封裝', 'skill格式'] },
    { name: '重構', members: ['重構', 'refactor'] },
    { name: '研究', members: ['研究', '程式碼研究', '跨工具比較'] },
    { name: '知識', members: ['知識', '版號治理'] },
  ] },
  { group: '工具鏈', cats: [
    { name: '版控', members: ['git', 'git-rebase', 'git-am', 'patch合併'] },
    { name: '部署', members: ['deploy', 'vercel'] },
    { name: '測試自動化', members: ['playwright', 'playwright-verify', 'crawler'] },
    { name: '環境設定', members: ['Windows-env', '設定檔', 'settings合併', 'Node', 'hook'] },
    { name: '工具·其它', members: ['工具', '工具開發', 'security'] },
  ] },
];

// ---- v2.5 衍生層常數 ----
const BILLABLE = (u) => (u.input_tokens||0) + (u.output_tokens||0) + (u.cache_creation_input_tokens||0); // 排除 cache_read
// 委託界線（v2.5-doc 改：委託＝「每日」計費等效 token；4 Gate 500萬/1000萬/3000萬/5000萬，不浮灌）
const QUEST_FLOOR = 100000; // 委託下限：當日有效 token < 10 萬不算委託（連 D 都不給）
const QUEST_TIERS = [
  { tier: 'D', lo: 0,         hi: 5000000 },
  { tier: 'C', lo: 5000000,   hi: 10000000 },
  { tier: 'B', lo: 10000000,  hi: 30000000 },
  { tier: 'A', lo: 30000000,  hi: 50000000 },
  { tier: 'S', lo: 50000000,  hi: Infinity },
];
const ELITE_WEIGHT = { D: 1, C: 2, B: 3, A: 5, S: 25 }; // 精英分權重（v2.8：S 8→25，高價值主貨幣）
function projectsRoot() { return path.join(os.homedir(), '.claude', 'projects'); }
const ACTIVE_GAP_MS = 15 * 60000;           // 使用時間：相鄰訊息 gap<15 分才累加
// 定價（每百萬 token，2026-06；查 claude-api skill 為準，變動只重算展示欄、不影響等級）
const PRICING = {
  opus:   { in: 5,  out: 25, cc: 6.25, cr: 0.5 },
  sonnet: { in: 3,  out: 15, cc: 3.75, cr: 0.3 },
  haiku:  { in: 1,  out: 5,  cc: 1.25, cr: 0.1 },
};

// ---- v2.5 顯示層常數 ----
const ELITE_STEP = 50;        // 精英每級門檻（v2.8 平線：cost=50/級，Lv_n 累計門檻=50n）
const ELITE_GATE = { D: 20, C: 50, B: 100 }; // 精英化逐階退役 Gate：達該精英級後，該階委託停止記分（愈精英愈只認高價值）
const BOOK_CHARS = 100000;    // 10 萬字 = 1 本（design §4.3 #027）
const BOOK_RATE = 0.7;        // 計費等效 × 0.7 字/token
const FLOW_LABEL = { input: '輸入', output: 'AI寫出', cacheCreation: '首次建快取', cacheRead: '重複讀歷史' }; // design §4.2

// ---- v2.5 Plan3 四元素常數 ----
const RARITY_RANK = { N: 1, R: 2, SR: 3, UR: 4, LR: 5 };
const DRAGON_TOKEN = 3e7;       // v2.7 re-anchor：單日委託 > 3000 萬 token（原 1000 萬 per-day 下天天觸發、失稀有性）
const BOOK_EQUIV = (billable) => Math.floor((billable || 0) * BOOK_RATE / BOOK_CHARS); // 等效藏書（計費等效×0.7字÷10萬字）
const REGRESS_BADGE_MIN = 3;
const TERSE_MAX_CHARS = 10;
const TALKATIVE_MIN = 50;
const NIGHT_END = 5;
const MORNING_START = 5, MORNING_END = 8;
const MARATHON_HR = 6;
const SLEEPLESS_HR = 12;
const STREAK_CELEBRATE = [7, 30];
const RARE_LINES = [
  '⋯⋯系統深處傳來一聲微弱的嘆息。',
  '一隻像素貓悄悄走過你的終端機。',
  '你彷彿聽見遠方傳來編譯成功的鐘聲。',
  '螢幕角落閃過一行不存在的 log，再看已消失。',
];

// ---- v2.5 Plan3 徽章表（宣告式，比照 SKILL_GROUPS；cond 純比較）----
// v2.7 大擴充：25→47 枚、8 類。B 投入改錨「對話/打字 raw 里程碑」（原 level 門檻在大除數下永久鎖死，已 supersede）。
// 全部純衍生·零 EXP·cond 只讀既有 ctx 指標 → 不新增可刷分管道。高階門檻一律錨在 live 真實值之上做梯度、不灌水。
const ACHIEVEMENTS = [
  // A 戰績（任務量）
  { id: 'first_task',    name: '初試啼聲', rarity: 'N',  cat: 'A 戰績', desc: '完成首個任務',     cond: (c) => c.taskCount >= 1 },
  { id: 'veteran_100',   name: '百戰之身', rarity: 'R',  cat: 'A 戰績', desc: '累積 100 個任務',   cond: (c) => c.taskCount >= 100 },
  { id: 'centurion_500', name: '身經百戰', rarity: 'R',  cat: 'A 戰績', desc: '累積 500 個任務',   cond: (c) => c.taskCount >= 500 },
  { id: 'master_1000',   name: '千錘百鍊', rarity: 'SR', cat: 'A 戰績', desc: '累積 1000 個任務',  cond: (c) => c.taskCount >= 1000 },
  { id: 'legend_10000',  name: '萬卷功成', rarity: 'LR', cat: 'A 戰績', desc: '累積 10000 個任務', cond: (c) => c.taskCount >= 10000 },
  // B 投入（對話 raw 里程碑；原 cmd_10/cmd_50 supersede）
  { id: 'talk_1k',  name: '見習指揮官', rarity: 'N',  cat: 'B 投入', desc: '累積 1,000 次對話',  cond: (c) => c.conversations >= 1000 },
  { id: 'talk_5k',  name: '健談老兵',   rarity: 'R',  cat: 'B 投入', desc: '累積 5,000 次對話',  cond: (c) => c.conversations >= 5000 },
  { id: 'talk_20k', name: '沙場宿將',   rarity: 'SR', cat: 'B 投入', desc: '累積 20,000 次對話', cond: (c) => c.conversations >= 20000 },
  { id: 'talk_50k', name: '言出法隨',   rarity: 'UR', cat: 'B 投入', desc: '累積 50,000 次對話', cond: (c) => c.conversations >= 50000 },
  // B 投入（純打字字數 raw 里程碑；原 slay_25/slay_50 supersede）
  { id: 'type_1m',  name: '筆耕不輟', rarity: 'N',  cat: 'B 投入', desc: '純打字累積 100 萬字',   cond: (c) => c.pureTyped >= 1e6 },
  { id: 'type_5m',  name: '筆鋒如刃', rarity: 'R',  cat: 'B 投入', desc: '純打字累積 500 萬字',   cond: (c) => c.pureTyped >= 5e6 },
  { id: 'type_20m', name: '著作等身', rarity: 'SR', cat: 'B 投入', desc: '純打字累積 2,000 萬字', cond: (c) => c.pureTyped >= 2e7 },
  { id: 'type_50m', name: '一字千軍', rarity: 'UR', cat: 'B 投入', desc: '純打字累積 5,000 萬字', cond: (c) => c.pureTyped >= 5e7 },
  // C 委託
  { id: 'first_s',       name: '首級',       rarity: 'N',  cat: 'C 委託', desc: '完成首個 S 級委託',         cond: (c) => c.tiers.S >= 1 },
  { id: 'all_tiers',     name: '全階通吃',   rarity: 'R',  cat: 'C 委託', desc: 'D~S 各至少 1 件',            cond: (c) => c.tiers.D >= 1 && c.tiers.C >= 1 && c.tiers.B >= 1 && c.tiers.A >= 1 && c.tiers.S >= 1 },
  { id: 'quest_30',      name: '委託熟手',   rarity: 'R',  cat: 'C 委託', desc: '累積 30 個委託日',          cond: (c) => c.questDays >= 30 },
  { id: 'quest_100',     name: '公會柱石',   rarity: 'SR', cat: 'C 委託', desc: '累積 100 個委託日',         cond: (c) => c.questDays >= 100 },
  { id: 'a_hunter_5',    name: '精銳獵人',   rarity: 'SR', cat: 'C 委託', desc: '累積 5 個 A 級委託',        cond: (c) => c.tiers.A >= 5 },
  { id: 's_hunter_10',   name: 'S級獵人',    rarity: 'SR', cat: 'C 委託', desc: '累積 10 個 S 級委託',       cond: (c) => c.tiers.S >= 10 },
  { id: 'dragon_slayer', name: '巨龍討伐者', rarity: 'UR', cat: 'C 委託', desc: '單日委託 > 3000 萬 token',  cond: (c) => c.maxQuest > DRAGON_TOKEN },
  // D 代價（負面自嘲）
  { id: 'mage_yi',        name: '億級法師',         rarity: 'R',  cat: 'D 代價', desc: '有效 token 破 1 億',        cond: (c) => c.billable >= 1e8 },
  { id: 'token_10yi',     name: '吞噬者',           rarity: 'SR', cat: 'D 代價', desc: '有效 token 破 10 億',       cond: (c) => c.billable >= 1e9 },
  { id: 'burn_1k',        name: '燒錢如焚',         rarity: 'SR', cat: 'D 代價', desc: '等效成本破 $1000',          cond: (c) => c.costUSD >= 1000 },
  { id: 'burn_3k_secret', name: '你知道燒了多少嗎', rarity: 'SR', cat: 'D 代價', desc: '等效成本破 $3000（隱藏）',  hidden: true, cond: (c) => c.costUSD >= 3000 },
  { id: 'burn_5k',        name: '揮金如土',         rarity: 'UR', cat: 'D 代價', desc: '等效成本破 $5000',          cond: (c) => c.costUSD >= 5000 },
  { id: 'burn_10k',       name: '富可敵國',         rarity: 'LR', cat: 'D 代價', desc: '等效成本破 $10000',         cond: (c) => c.costUSD >= 10000 },
  // E 習慣（時段/耐力）
  { id: 'night_mage',      name: '夜術士',     rarity: 'R',  cat: 'E 習慣', desc: '0–5 點完成任務',     cond: (c) => c.night },
  { id: 'morning_adv',     name: '晨型冒險者', rarity: 'R',  cat: 'E 習慣', desc: '5–8 點完成任務',     cond: (c) => c.morning },
  { id: 'weekend_warrior', name: '假日狂戰士', rarity: 'R',  cat: 'E 習慣', desc: '週末完成任務',       cond: (c) => c.weekend },
  { id: 'sleepless',       name: '不眠騎士',   rarity: 'SR', cat: 'E 習慣', desc: '單日使用 > 12 小時',  cond: (c) => c.maxDayActiveHours > SLEEPLESS_HR },
  { id: 'marathon',        name: '馬拉松',     rarity: 'SR', cat: 'E 習慣', desc: '單 session > 6 小時', cond: (c) => c.maxSessionHours > MARATHON_HR },
  { id: 'iron_will',       name: '鋼鐵意志',   rarity: 'SR', cat: 'E 習慣', desc: '生涯使用 ≥ 500 小時', cond: (c) => c.careerHours >= 500 },
  // F 幽默/隱藏
  { id: 'phoenix',      name: '浴火重生',   rarity: 'R',  cat: 'F 幽默', desc: '連 3 敗後達成任務',     cond: (c) => c.phoenix },
  { id: 'terse',        name: '惜字如金',   rarity: 'N',  cat: 'F 幽默', desc: '< 10 字完成任務',       cond: (c) => c.terse },
  { id: 'talkative',    name: '話癆',       rarity: 'N',  cat: 'F 幽默', desc: '單日 > 50 次對話',       cond: (c) => c.maxDayConv > TALKATIVE_MIN },
  { id: 'butterfinger', name: '手滑藝術家', rarity: 'N',  cat: 'F 幽默', desc: '常錯累積 3 次',         cond: (c) => c.regressCount >= REGRESS_BADGE_MIN },
  { id: 'recidivist',   name: '慣犯',       rarity: 'R',  cat: 'F 幽默', desc: '常錯累積 10 次',        cond: (c) => c.regressCount >= 10 },
  { id: 'caffeine',     name: '咖啡因中毒', rarity: 'SR', cat: 'F 幽默', desc: '單日 > 200 次對話（隱藏）', hidden: true, cond: (c) => c.maxDayConv > 200 },
  // G 技藝（廣度）
  { id: 'jack_of_trades',    name: '多才',       rarity: 'R',  cat: 'G 技藝', desc: '用過 ≥ 5 種技能',  cond: (c) => c.distinctSkills >= 5 },
  { id: 'polymath',          name: '博學者',     rarity: 'SR', cat: 'G 技藝', desc: '用過 ≥ 10 種技能', cond: (c) => c.distinctSkills >= 10 },
  { id: 'dungeon_explorer',  name: '地城探索者', rarity: 'R',  cat: 'G 技藝', desc: '踏足 ≥ 5 個地城',   cond: (c) => c.distinctDungeons >= 5 },
  { id: 'dungeon_conqueror', name: '地城征服者', rarity: 'SR', cat: 'G 技藝', desc: '踏足 ≥ 15 個地城',  cond: (c) => c.distinctDungeons >= 15 },
  { id: 'scholar',           name: '求道者',     rarity: 'R',  cat: 'G 技藝', desc: '心法累積 ≥ 50',     cond: (c) => c.lessonCount >= 50 },
  // H 里程（生涯量級）
  { id: 'library_1k',  name: '圖書館長',   rarity: 'R',  cat: 'H 里程', desc: '等效閱讀 ≥ 1,000 本',     cond: (c) => c.books >= 1000 },
  { id: 'library_5k',  name: '萬卷藏書',   rarity: 'SR', cat: 'H 里程', desc: '等效閱讀 ≥ 5,000 本',     cond: (c) => c.books >= 5000 },
  { id: 'data_flood',  name: '資料洪流',   rarity: 'SR', cat: 'H 里程', desc: '總處理量 ≥ 100 億 token', cond: (c) => c.totalProcessed >= 1e10 },
  { id: 'centenarian', name: '百日老兵',   rarity: 'R',  cat: 'H 里程', desc: '活躍 ≥ 100 天',           cond: (c) => c.distinctActiveDays >= 100 },
];
function badgeById(id) { return ACHIEVEMENTS.find((b) => b.id === id) || null; }

function buildBadgeContext(state, log, d) {
  const tasks = log.filter((e) => e.kind === 'task');
  const taskCount = tasks.length;
  const regressCount = log.filter((e) => e.kind === 'regress').length;
  let night = false, morning = false, weekend = false, terse = false;
  for (const t of tasks) {
    const ts = t.ts || '';
    const hh = Number(ts.slice(11, 13));
    if (hh >= 0 && hh < NIGHT_END) night = true;
    if (hh >= MORNING_START && hh < MORNING_END) morning = true;
    const dt = new Date(ts.replace(' ', 'T'));
    if (!Number.isNaN(dt.getTime())) { const wd = dt.getDay(); if (wd === 0 || wd === 6) weekend = true; }
    if ([...(t.reason || '')].length < TERSE_MAX_CHARS) terse = true;
  }
  const ordered = [...log].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  let fails = 0, phoenix = false;
  for (const e of ordered) {
    if (e.kind === 'fail') fails++;
    else if (e.kind === 'task') { if (fails >= 3) phoenix = true; fails = 0; }
  }
  // v2.7 新增 ctx 欄（純讀 log+derived，零副作用）：B 投入改錨 raw、G 技藝廣度、H 生涯里程
  const lessonCount = log.filter((e) => e.kind === 'lesson').length;
  const skillSet = new Set(), dungeonSet = new Set(), daySet = new Set();
  for (const e of log) {
    if (Array.isArray(e.skills)) for (const s of e.skills) skillSet.add(s);
    if (e.dungeon) dungeonSet.add(e.dungeon);
    if (e.ts) daySet.add(e.ts.slice(0, 10));
  }
  const tiers = d.tierCount || { D: 0, C: 0, B: 0, A: 0, S: 0 };
  const questDays = (tiers.D || 0) + (tiers.C || 0) + (tiers.B || 0) + (tiers.A || 0) + (tiers.S || 0);
  return {
    taskCount, regressCount, night, morning, weekend, terse, phoenix,
    maxDayConv: d.maxDayConversations || 0, maxDayActiveHours: d.maxDayActiveHours || 0, maxSessionHours: d.maxSessionHours || 0,
    billable: d.billable || 0, costUSD: d.costUSD || 0, commandLevel: d.commandLevel || 0, slayLevel: d.slayLevel || 0,
    tiers, maxQuest: d.maxQuestBillable || 0,
    // v2.7
    conversations: d.conversations || 0,
    pureTyped: Math.max(0, (d.typedChars || 0) - (d.codeChars || 0)),
    totalProcessed: d.totalProcessed || 0,
    careerHours: d.activeHours || 0,
    books: BOOK_EQUIV(d.billable || 0),
    questDays, lessonCount,
    distinctSkills: skillSet.size, distinctDungeons: dungeonSet.size, distinctActiveDays: daySet.size,
  };
}
function evalBadges(ctx) {
  return ACHIEVEMENTS.filter((b) => { try { return !!b.cond(ctx); } catch { return false; } }).map((b) => b.id);
}
// 稱號：已解鎖徽章中「最高稀有度 → 同稀有度取最新解鎖 ts」；隱藏徽章不列入稱號候選；pin 非空直接覆寫（config.json title_pin）
function deriveTitle(unlocked, pin) {
  if (pin) return pin;
  const ids = Object.keys(unlocked || {});
  let best = null;
  for (const id of ids) {
    const b = badgeById(id); if (!b || b.hidden) continue; // 隱藏徽章不作稱號
    const ts = unlocked[id] || '';
    if (!best) { best = { b, ts }; continue; }
    const dr = RARITY_RANK[b.rarity] - RARITY_RANK[best.b.rarity];
    if (dr > 0 || (dr === 0 && ts > best.ts)) best = { b, ts };
  }
  return best ? best.b.name : null;
}
// 個人 PR records 合併（只進不退，取 max）
function mergeRecords(prev, d) {
  const p = prev || {};
  return {
    maxDayToken: Math.max(p.maxDayToken || 0, d.maxDayToken || 0),
    maxDayChars: Math.max(p.maxDayChars || 0, d.maxDayChars || 0),
    maxQuest: Math.max(p.maxQuest || 0, d.maxQuestBillable || 0),
    longestStreak: Math.max(p.longestStreak || 0, (d.streak && d.streak.longest) || 0),
  };
}
// 回傳本次刷新的 PR 項（供 flush 即時播報）：[[label, value], ...]
function recordPRs(prev, next) {
  const p = prev || {}; const prs = [];
  if ((next.maxDayToken || 0) > (p.maxDayToken || 0)) prs.push(['單日最高 token', next.maxDayToken]);
  if ((next.maxDayChars || 0) > (p.maxDayChars || 0)) prs.push(['單日最多字', next.maxDayChars]);
  if ((next.maxQuest || 0) > (p.maxQuest || 0)) prs.push(['單委託最大', next.maxQuest]);
  if ((next.longestStreak || 0) > (p.longestStreak || 0)) prs.push(['最長連戰', next.longestStreak]);
  return prs;
}

// 隨機彩蛋（design §3.4）：flush 一行、薄 AI、全無 EXP。回傳一行字串（無→''）；就地更新 egg 狀態。
// 優先序：連擊慶祝 > 里程碑炸裂 > 暴擊(PR) > 每日寶箱 > 稀有遭遇(唯一隨機項)。
function pickEasterEgg(d, egg, prs, todayStr, rng = Math.random) {
  const cur = (d.streak && d.streak.current) || 0;
  if (STREAK_CELEBRATE.includes(cur)) return `🎉 連戰 ${cur} 日達成，這份堅持值得記上一筆。`;
  const yi = Math.floor((d.totalProcessed || 0) / 1e8);
  if (yi > (egg.lastYi || 0)) { egg.lastYi = yi; return `💥 魔力消耗跨越 ${yi} 億 token——燃料燒得轟轟烈烈。`; }
  if (prs && prs.length) return `⚡ 暴擊！刷新個人紀錄：${prs[0][0]}。`;
  if (egg.lastDay !== todayStr) { egg.lastDay = todayStr; return '🎁 每日寶箱：今天也辛苦了，繼續前進。'; }
  if (rng() < 0.03) { const i = Math.floor(rng() * RARE_LINES.length) % RARE_LINES.length; return RARE_LINES[i]; }
  return '';
}

// ---- v2.5 顯示層：數字格式 ----
function fmtYi(n, dp = 1) { return (Number(n || 0) / 1e8).toFixed(dp) + '億'; }      // token → 億（1 億=100M）
function fmtWan(chars) { return (Number(chars || 0) / 10000).toFixed(1) + '萬字'; }  // 字元 → 萬字
function fmtUSD(n) { return 'US$' + Math.round(Number(n || 0)).toLocaleString('en-US'); }

// 精英分 → 精英等級（v2.8 平線）：cost=ELITE_STEP/級，Lv = ⌊分/50⌋、預設 Lv0。
function eliteLevel(points) {
  const p = Number(points || 0);
  return p > 0 ? Math.floor(p / ELITE_STEP) : 0;
}
// 精英分（v2.8）：按「日序」逐筆 fold 加權委託分，套用逐階退役 Gate。
// 必須時序累計而非總分布×權重——因 Gate 後段令低階失效，當日得分取決於「入帳前已達第幾精英級」。
// quests 須已按日序（questsByDay 內已 sort）。只進不退：被 Gate 的日加 0、永不扣分；
// 過往日的貢獻由其時序位置固定（加未來日不改變過去判級）→ elitePoints 對真實時間單調不減、rebuild 可重現。
function eliteScore(quests) {
  let points = 0;
  for (const q of quests || []) {
    const lv = eliteLevel(points);                        // 入帳前的當前精英級
    const gate = ELITE_GATE[q.tier];                      // 該階的退役門檻（A/S 無 gate）
    if (gate != null && lv >= gate) continue;             // 已退役 → 本日 +0
    points += ELITE_WEIGHT[q.tier] || 0;
  }
  return points;
}

// ---- 路徑 ----
// 資料目錄跟著「本腳本所在的 CLI home」走（.claude 或 .gemini），雙 CLI 各自獨立。
// 本檔位於 <HOME>/skills/ExpBook/scripts/exp.cjs → 上溯 3 層即 CLI home。
// EXPBOOK_HOME 環境變數可顯式覆寫（最高優先）。
function cliHome() {
  return path.resolve(__dirname, '..', '..', '..');
}
function resolveHome() {
  return process.env.EXPBOOK_HOME || path.join(cliHome(), 'expbook');
}
function paths(base = resolveHome()) {
  return {
    base,
    logFile: path.join(base, 'log.jsonl'),
    stateFile: path.join(base, 'state.json'),
    statusFile: path.join(base, 'STATUS.md'),
    viewsDir: path.join(base, 'views'),
    pendingFile: path.join(base, '_pending.jsonl'),
    lastFlushFile: path.join(base, '_last_flush.txt'),
    configFile: path.join(base, 'config.json'),
    achievementsFile: path.join(base, 'achievements.json'),
  };
}

// ---- 設定覆寫：使用者可在 expbook/config.json（Claude ~/.claude/expbook/、gemini ~/.gemini/expbook/，隨 CLI home）調整各 kind 的 EXP 數值 ----
// 格式：{ "exp_of": { "task": 150, "lesson": 30, ... } }；只覆寫已知 kind，其餘沿用預設。
// 注意：只影響「之後」新入帳的事件；歷史事件已把當時 EXP 存進 e.exp，不被回溯改動。
function loadConfig(p = paths()) {
  try {
    const c = JSON.parse(fs.readFileSync(p.configFile, 'utf8'));
    if (c && c.exp_of && typeof c.exp_of === 'object') {
      for (const k of Object.keys(EXP_OF)) {
        if (typeof c.exp_of[k] === 'number') EXP_OF[k] = c.exp_of[k];
      }
    }
    return c || {};
  } catch { return {}; }
}
loadConfig(); // 載入模組時即套用使用者覆寫（若 config.json 存在）

// 稱號釘選覆寫：config.json 的 title_pin（沿用既有 config 覆寫機制；STATUS.md 為輸出檔不可當輸入）
function loadTitlePin(p = paths()) {
  try { const c = JSON.parse(fs.readFileSync(p.configFile, 'utf8')); return c && typeof c.title_pin === 'string' && c.title_pin ? c.title_pin : null; }
  catch { return null; }
}

// ---- 等級數學 ----
function levelFor(exp) { return Math.floor(exp / LEVEL_STEP) + 1; }
function progressFor(exp) {
  const lv = levelFor(exp);
  const into = exp - (lv - 1) * LEVEL_STEP;
  return { lv, into, step: LEVEL_STEP, toNext: LEVEL_STEP - into };
}
// 通用 1-based 進度（給投入軸 指揮/殺敵 用任意除數，與 progressFor 同形）
function progressBy(value, step) {
  const v = Math.max(0, value);
  const lv = Math.floor(v / step) + 1;
  const into = v - (lv - 1) * step;
  return { lv, into, step, toNext: step - into };
}

// ---- 時間 ----
function pad(n) { return String(n).padStart(2, '0'); }
function fmtTs(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function now() { return fmtTs(new Date()); }

// ---- log IO ----
function ensureBase(p = paths()) {
  fs.mkdirSync(p.base, { recursive: true });
  fs.mkdirSync(p.viewsDir, { recursive: true });
}
function appendEvent(ev, p = paths()) {
  ensureBase(p);
  fs.appendFileSync(p.logFile, JSON.stringify(ev) + '\n');
}
function readLog(p = paths()) {
  if (!fs.existsSync(p.logFile)) return [];
  return fs.readFileSync(p.logFile, 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ---- computeState（三層：冒險者 global + 地城 dungeons + 技能 skills）----
function eventSkills(e) {
  if (Array.isArray(e.skills)) return e.skills;
  if (e.type) return [e.type]; // 向後相容：舊事件的 type 視為單一技能
  return [];
}
function applyEvent(state, e) {
  const amt = (typeof e.exp === 'number') ? e.exp : (EXP_OF[e.kind] ?? 0); // 優先用入帳當時存的值，rate 改動不回溯
  state.global.exp += amt;
  if (e.dungeon) {
    const d = state.dungeons[e.dungeon] || (state.dungeons[e.dungeon] = { exp: 0 });
    d.exp += amt;
  }
  for (const s of eventSkills(e)) {
    const sk = state.skills[s] || (state.skills[s] = { exp: 0 });
    sk.exp += amt;
  }
  state.updated = e.ts;
}
function computeState(events) {
  const state = { global: { exp: 0 }, dungeons: {}, skills: {}, updated: null };
  for (const s of DEFAULT_SKILLS) state.skills[s] = { exp: 0 }; // 7 技能恆在
  for (const e of events) applyEvent(state, e);
  return state;
}
function writeState(state, p = paths()) {
  ensureBase(p);
  fs.writeFileSync(p.stateFile, JSON.stringify(state, null, 2));
}
function readState(p = paths()) {
  if (!fs.existsSync(p.stateFile)) return computeState(readLog(p));
  return JSON.parse(fs.readFileSync(p.stateFile, 'utf8'));
}

// ---- 日期解析與篩選 ----
function dayStart(d) { return `${fmtTs(d).slice(0, 10)} 00:00:00`; }
function dayEnd(s) { return `${s} 23:59:59`; }
function parseSince(spec, ref = new Date()) {
  const to = fmtTs(ref);
  if (spec === '今日') return { from: dayStart(ref), to };
  if (spec === '本月') return { from: `${fmtTs(ref).slice(0, 7)}-01 00:00:00`, to };
  if (spec === '本週') {
    const day = (ref.getDay() + 6) % 7; // 週一=0
    const monday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - day);
    return { from: dayStart(monday), to };
  }
  if (/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(spec)) {
    const [a, b] = spec.split('..');
    return { from: `${a} 00:00:00`, to: dayEnd(b) };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(spec)) {
    return { from: `${spec} 00:00:00`, to: dayEnd(spec) };
  }
  return { from: '0000', to };
}
function filterEvents(events, f = {}) {
  return events.filter((e) => {
    if (f.from && e.ts < f.from) return false;
    if (f.to && e.ts > f.to) return false;
    if (f.dungeon && e.dungeon !== f.dungeon) return false;
    if (f.skill && !eventSkills(e).includes(f.skill)) return false;
    if (f.kind && e.kind !== f.kind) return false;
    return true;
  });
}

// ---- 渲染器 ----
function expDeltaOf(e) { return (typeof e.exp === 'number') ? e.exp : (EXP_OF[e.kind] ?? 0); }
function deltaLabel(e) { return '+' + String(expDeltaOf(e)).padEnd(3); }
function kindTag(e) { return KIND_LABEL[e.kind] || e.kind; }
function skillTag(e) { const s = eventSkills(e); return s.length ? `{${s.join('·')}} ` : ''; }
function lvLine(name, exp) {
  const p = progressFor(exp);
  return `  ${name} LV${p.lv} (${p.into}/${p.step}) Total:${exp}\n`;
}
function lvLineAt(name, exp, indent, detail) {
  const p = progressFor(exp);
  return `${indent}${name} LV${p.lv} (${p.into}/${p.step}) Total:${exp}${detail ? `  ‹${detail}›` : ''}\n`;
}
// 把 state.skills 依 SKILL_GROUPS 彙總成分類小計；未列入任何分類的 tag 收進「未分類」群。
function categorizeSkills(state) {
  const known = new Set();
  const groups = SKILL_GROUPS.map((g) => ({
    group: g.group,
    cats: g.cats.map((c) => {
      let exp = 0; const present = [];
      for (const m of c.members) {
        known.add(m);
        const e = (state.skills[m] || {}).exp || 0;
        exp += e;
        if (e > 0) present.push(m); // 只把有分數的成員列為明細
      }
      return { name: c.name, exp, members: present };
    }).sort((a, b) => b.exp - a.exp),
  }));
  const uncategorized = Object.entries(state.skills)
    .filter(([k, v]) => (v.exp || 0) > 0 && !known.has(k))
    .sort((a, b) => b[1].exp - a[1].exp)
    .map(([k, v]) => ({ name: k, exp: v.exp }));
  return { groups, uncategorized };
}

// 一行式四等級面板（design §2.3）：左=會升級的榮譽（成果+投入），右=只增的代價
function renderPanelLine(state, d) {
  const g = progressFor(state.global.exp);                      // 冒險者等級 + 該級進度（當前/升級所需）
  // 精英＝隱藏等級（v2.8）：Lv1（≥50 精英分）才現身，列於冒險者後（成果組 ①②）
  const eLv = eliteLevel(d.elitePoints);
  let lvs = `[等級] 冒險者${g.lv}(${g.into}/${g.step})` + (eLv >= 1 ? ` 精英${eLv}` : '') + ` 指揮${d.commandLevel} 殺敵${d.slayLevel}`;
  if (d.streak) {                                              // v2.5 Plan3 連勤顯示
    const { current = 0, longest = 0 } = d.streak;
    lvs += ` 🔥${current}` + (longest > current ? `(PR${longest})` : '');
  }
  const cost = `[消耗] 魔力${fmtYi(d.totalProcessed, 1)}(有效${fmtYi(d.billable, 2)}) 金幣${fmtUSD(d.costUSD)}`;
  return `${lvs}   ${cost}`;
}

// 燃料儀表板（design §4）：生涯統計、人話化、不升級、負面框架代價
function renderFuelDashboard(d) {
  const tc = d.tierCount || { D: 0, C: 0, B: 0, A: 0, S: 0 };
  const f = d.flows || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  const books = Math.round((d.billable || 0) * BOOK_RATE / BOOK_CHARS);
  const codePct = Math.round((d.codePct || 0) * 100);
  let out = `\n🔥 燃料儀表板（生涯統計·不升級）\n`;
  out += `  委託討伐：D${tc.D} C${tc.C} B${tc.B} A${tc.A} S${tc.S}（精英分 ${d.elitePoints || 0}）\n`;
  out += `  token 流量：${FLOW_LABEL.input} ${fmtYi(f.input, 2)}｜${FLOW_LABEL.output} ${fmtYi(f.output, 2)}｜`
       + `${FLOW_LABEL.cacheCreation} ${fmtYi(f.cacheCreation, 2)}｜${FLOW_LABEL.cacheRead} ${fmtYi(f.cacheRead, 1)}\n`;
  out += `  書本換算：約 ${books.toLocaleString('en-US')} 本（計費等效 × ${BOOK_RATE} 字/token，10 萬字=1 本）\n`;
  out += `  使用時間 ${(d.activeHours || 0).toFixed(1)} hr｜對話 ${d.conversations || 0} 次｜`
       + `打字 ${fmtWan(d.typedChars)}(code ${codePct}%)\n`;
  out += `  代價：魔力 ${fmtYi(d.totalProcessed, 1)}(有效 ${fmtYi(d.billable, 2)})｜金幣 ${fmtUSD(d.costUSD)}\n`;
  return out;
}

// 徽章區塊（design §3.1/3.5）：依類別列；隱藏徽章解鎖後才現身；附 PR 個人紀錄列
function renderBadges(ach) {
  const unlocked = ach.unlocked || {};
  const ids = new Set(Object.keys(unlocked));
  const visible = ACHIEVEMENTS.filter((b) => !b.hidden || ids.has(b.id));
  let out = `\n🏅 徽章（${ids.size}/${visible.length}）\n`;
  const cats = [];
  for (const b of visible) if (!cats.includes(b.cat)) cats.push(b.cat);
  for (const cat of cats) {
    const items = visible.filter((b) => b.cat === cat);
    out += `  〔${cat}〕 ` + items.map((b) => `${b.name}(${b.rarity})${ids.has(b.id) ? '✓' : '·'}`).join(' ') + '\n';
  }
  const r = ach.records || {};
  out += `🏆 個人紀錄：單日最高 ${fmtYi(r.maxDayToken, 2)}｜單日最多字 ${fmtWan(r.maxDayChars)}｜`
       + `單委託最大 ${fmtYi(r.maxQuest, 2)}｜最長連戰 ${r.longestStreak || 0} 日\n`;
  return out;
}

function renderStatus(state, derived = null, ach = null) {
  const g = progressFor(state.global.exp);
  const title = ach ? deriveTitle(ach.unlocked, ach.titlePin) : null;
  let out = `# EXP 玩家面板（冒險者公會）\n\n`;
  if (derived) out += renderPanelLine(state, derived) + `\n\n`;
  out += `冒險者　LV${g.lv}${title ? `〈${title}〉` : ''} (${g.into}/${g.step}) Total:${state.global.exp}\n`;
  if (derived) {                                              // 成果軸②＋投入軸③④詳列（與冒險者同款）
    const ePts = derived.elitePoints || 0;
    const eLv = eliteLevel(ePts);
    if (eLv >= 1) out += `精英　　LV${eLv} (${ePts % ELITE_STEP}/${ELITE_STEP}) Total:${ePts} 分（高價值委託加權）\n`;
    const conv = derived.conversations || 0;
    const cmd = progressBy(conv, COMMAND_DIVISOR);
    const slayRaw = Math.max(0, (derived.typedChars || 0) - (derived.codeChars || 0));
    const sly = progressBy(slayRaw, SLAY_DIVISOR);
    out += `指揮　　LV${cmd.lv} (${cmd.into}/${cmd.step}) Total:${conv} 次對話\n`;
    out += `殺敵　　LV${sly.lv} (${fmtWan(sly.into)}/${fmtWan(sly.step)}) Total:${fmtWan(slayRaw)}（純打字）\n`;
  }
  out += `\n地城（專案）\n`;
  const dungeons = Object.entries(state.dungeons).sort((a, b) => b[1].exp - a[1].exp);
  if (!dungeons.length) out += `  （尚無）\n`;
  for (const [name, d] of dungeons) out += lvLine(`【${name}】`, d.exp);
  out += `\n技能（能力 · 依分類小計，‹…› 為原始細項明細）\n`;
  const { groups, uncategorized } = categorizeSkills(state);
  for (const grp of groups) {
    out += `  〔${grp.group}〕\n`;
    for (const c of grp.cats) out += lvLineAt(c.name, c.exp, '    ', c.members.join('·'));
  }
  if (uncategorized.length) {
    out += `  〔未分類〕← 建議補進 SKILL_GROUPS\n`;
    for (const u of uncategorized) out += lvLineAt(u.name, u.exp, '    ', '');
  }
  if (derived) out += renderFuelDashboard(derived);
  if (ach) out += renderBadges(ach);
  out += `\n更新時間：${state.updated || '—'}\n`;
  return out;
}

function historyLines(events, f = {}) {
  const limit = f.limit || 20;
  const sorted = filterEvents(events, f).slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return sorted.slice(-limit).reverse();
}
function renderHistory(events, f = {}) {
  const rows = historyLines(events, f);
  let out = `# EXP 歷程`;
  const cond = [
    f.dungeon && `地城=${f.dungeon}`,
    f.skill && `技能=${f.skill}`,
    f.kind && `kind=${f.kind}`,
    f.since && `since=${f.since}`,
  ].filter(Boolean);
  out += cond.length ? `（${cond.join('，')}）\n\n` : `\n\n`;
  for (const e of rows) {
    out += `${e.ts.slice(0, 16)}  ${deltaLabel(e)}  [${kindTag(e)}]  (${e.dungeon || '—'})  ${skillTag(e)}${e.reason}\n`;
  }
  out += `\n共 ${rows.length} 筆\n`;
  return out;
}

function renderDungeon(events, state, name) {
  const d = state.dungeons[name] || { exp: 0 };
  const p = progressFor(d.exp);
  let out = `# 地城報告：${name}\n\n`;
  out += `LV${p.lv} (${p.into}/${p.step}) Total:${d.exp}\n\n## 事件\n`;
  for (const e of historyLines(events, { dungeon: name, limit: 50 })) {
    out += `${e.ts.slice(0, 16)}  ${deltaLabel(e)}  [${kindTag(e)}]  ${skillTag(e)}${e.reason}\n`;
  }
  return out;
}

function renderSkill(events, state, name) {
  const s = state.skills[name] || { exp: 0 };
  const p = progressFor(s.exp);
  let out = `# 技能報告：${name}\n\n`;
  out += `LV${p.lv} (${p.into}/${p.step}) Total:${s.exp}\n\n## 事件\n`;
  for (const e of historyLines(events, { skill: name, limit: 50 })) {
    out += `${e.ts.slice(0, 16)}  ${deltaLabel(e)}  [${kindTag(e)}]  (${e.dungeon || '—'})  ${e.reason}\n`;
  }
  return out;
}

function renderReport(events, range, label) {
  const rows = filterEvents(events, range);
  const count = (k) => rows.filter((e) => e.kind === k).length;
  const expSum = rows.reduce((s, e) => s + expDeltaOf(e), 0);
  const byDun = {}; const bySkill = {};
  for (const e of rows) {
    if (e.dungeon) byDun[e.dungeon] = (byDun[e.dungeon] || 0) + 1;
    for (const s of eventSkills(e)) bySkill[s] = (bySkill[s] || 0) + 1;
  }
  const fmtMap = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、') || '—';
  let out = `# ${label || '期間'}彙總 ${range.from.slice(0, 10)} ~ ${range.to.slice(0, 10)}\n`;
  out += `任務 ${count('task')}｜心法 ${count('lesson')}｜練功 ${count('chore')}｜敗戰 ${count('fail')}｜常錯 ${count('regress')}｜共 +${expSum} EXP\n`;
  out += `依地城：${fmtMap(byDun)}\n依技能：${fmtMap(bySkill)}\n`;
  return out;
}

// ---- 寫入指令 ----
function normName(s) { return s.toLowerCase().replace(/^[\d.\-_]+/, ''); }
function nearDup(name, existing) {
  if (existing.includes(name)) return null;
  const n = normName(name);
  return existing.find((e) => e !== name && normName(e) === n) || null;
}
function parseFlags(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[++i]; }
    else pos.push(argv[i]);
  }
  return { pos, flags };
}
function parseSkills(flags) {
  const raw = [flags.skill, flags.type].filter(Boolean).join(','); // --type 為舊別名
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
function persist(p) {
  const state = computeState(readLog(p));
  writeState(state, p);
  const ach = readAchievements(p);
  if (ach) ach.titlePin = loadTitlePin(p);
  fs.writeFileSync(p.statusFile, renderStatus(state, ach ? ach.derived : null, ach));
  return state;
}
function buildEvent(kind, reason, { dungeon, skills } = {}) {
  // log.jsonl key 順序：ts → dungeon → kind → skills → exp → reason → else(cwd)
  const ev = { ts: now() };
  if (dungeon) ev.dungeon = dungeon;
  ev.kind = kind;
  if (skills && skills.length) ev.skills = skills;
  ev.exp = EXP_OF[kind] ?? 0;
  ev.reason = reason;
  ev.cwd = process.cwd(); // #029: 記錄觸發 event 的專案資料夾，與 dungeon tag 並存
  return ev;
}

// ---- A+C：暫存(stage) 與 沖刷(flush) ----
function stagePending(entry, p = paths()) {
  ensureBase(p);
  fs.appendFileSync(p.pendingFile, JSON.stringify(entry) + '\n');
}
function readPending(p = paths()) {
  if (!fs.existsSync(p.pendingFile)) return [];
  return fs.readFileSync(p.pendingFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function flushSummaryText(evs) {
  const total = evs.reduce((s, e) => s + (e.exp ?? 0), 0);
  const ts = (evs[0] && evs[0].ts ? evs[0].ts : now()).slice(0, 16);
  let out = `# 本輪 EXP 入帳（${ts}）  共 +${total} EXP\n`;
  for (const e of evs) {
    out += `  +${String(e.exp ?? 0).padEnd(3)} [${KIND_LABEL[e.kind] || e.kind}] (${e.dungeon || '—'}) ${skillTag(e)}${e.reason}\n`;
  }
  return out;
}
function flushPending(p = paths()) {
  const items = readPending(p);
  if (!items.length) return 0;
  const evs = [];
  for (const it of items) {
    const ev = buildEvent(it.kind, it.reason, { dungeon: it.dungeon, skills: it.skills });
    appendEvent(ev, p);
    evs.push(ev);
  }
  persist(p);
  fs.writeFileSync(p.pendingFile, '');
  try { ensureBase(p); fs.writeFileSync(p.lastFlushFile, flushSummaryText(evs)); } catch {} // 本輪入帳摘要，供 lastflush / 下輪查看
  return items.length;
}

function removeEvents({ last, ts, match }, p = paths()) {
  const events = readLog(p);
  if (!events.length) return { removed: [], kept: [] };
  let toRemove;
  if (last) {
    toRemove = [events[events.length - 1]];
  } else if (ts) {
    toRemove = events.filter((e) => e.ts === ts);
  } else if (match) {
    toRemove = events.filter((e) => (e.reason || '').includes(match));
  } else {
    return { removed: [], kept: events };
  }
  const removeSet = new Set(toRemove.map((e) => JSON.stringify(e)));
  const kept = events.filter((e) => !removeSet.has(JSON.stringify(e)));
  fs.writeFileSync(p.logFile, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''));
  persist(p);
  return { removed: toRemove, kept };
}

function addEvent(kind, reason, { dungeon, skills } = {}, p = paths()) {
  const ev = buildEvent(kind, reason, { dungeon, skills });
  if (dungeon) {
    const dup = nearDup(dungeon, Object.keys(readState(p).dungeons || {}));
    if (dup) process.stderr.write(`⚠ 地城「${dungeon}」近似既有「${dup}」，確認是否同一個\n`);
  }
  appendEvent(ev, p);
  const state = persist(p);
  const g = progressFor(state.global.exp);
  const sk = (skills && skills.length) ? `｜技能 ${skills.join('·')}` : '';
  console.log(`✓ ${KIND_LABEL[kind] || kind} +${ev.exp}｜冒險者 Lv${g.lv} (${state.global.exp})｜地城 ${dungeon}${sk}｜${reason}`);
}

// ---- 檢視輔助 ----
function safeName(s) {
  // 防路徑穿越：去掉分隔符與 ..，僅保留檔名安全字元
  return String(s).replace(/[\/\\]/g, '_').replace(/\.\./g, '_').replace(/[:*?"<>|]/g, '_');
}
function writeView(p, file, content, summary) {
  ensureBase(p);
  const full = path.join(p.viewsDir, file);
  fs.writeFileSync(full, content);
  console.log(`→ views/${file}${summary ? '（' + summary + '）' : ''}`);
}

const HELP = `ExpBook 指令（冒險者公會制；冒險者等級 + 地城(專案) + 技能(能力)；門檻 ${LEVEL_STEP}/級）
  寫入（未給 --dungeon → 預設地城「${DEFAULT_DUNGEON}」；--skill 選填、可多項逗號分隔）：
    task    "<事由>"        [--dungeon <地城>] [--skill <技能,..>]   任務 +200
    lesson  "<心得>"        [--dungeon ..] [--skill ..]            心法 +20
    chore   "<做了什麼>"    [--dungeon ..] [--skill ..]            練功 +1
    fail    "<敗因>"        [--dungeon ..] [--skill ..]            敗戰 +1
    regress "<重犯的已知錯>" [--dungeon ..] [--skill ..]           常錯 +1
  檢視（產報告檔，只回指標）：
    show                       重算一次 → 只印面板第一行（等級＋消耗，不產報告檔）
    status                     → STATUS.md
    history [--dungeon|--skill|--kind|--since|--limit]  → views/history.md
    dungeon <地城>             → views/dungeon-<地城>.md
    skill <技能>               → views/skill-<技能>.md
    report --since <今日|本週|本月|YYYY-MM-DD[..YYYY-MM-DD]>  → views/report-<期間>.md
  暫存/沖刷（hook 用）：
    stage --kind <task|lesson|chore|fail|regress> "<事由>" [--dungeon ..] [--skill ..]   暫存到 _pending（回顯 +EXP）
    flush                      把 _pending 全部沖進 log（Stop hook 每輪呼叫）；印本輪入帳明細
    lastflush                  顯示最近一次 flush 的「本輪 EXP 入帳」明細（什麼原因加了多少）
  維運：rebuild ｜ derive ｜ init ｜ help
    derive                     掃 transcript 重算衍生指標 → achievements.json
    remove --last｜--ts "<時間戳>"｜--match "<事由片段>"   從 log 移除事件並重建 state（調整/回退某筆 EXP）
  調整 EXP 數值：編輯 ${path.join(resolveHome(), 'config.json')}  例 {"exp_of":{"task":150,"lesson":30}}（只影響之後新事件）
  預設 7 技能：${DEFAULT_SKILLS.join(' / ')}（可自由新增其他技能 tag）`;

// ---- v2.5 衍生層：等級公式（線性除數；不浮灌、等級該有深度）----
const COMMAND_DIVISOR = 1000;    // 指揮：每 1000 次對話 1 級
const SLAY_DIVISOR = 1000000;    // 殺敵：每 100 萬字（扣 code 純打字）1 級
// 1-based（與冒險者 levelFor 一致）：預設 Lv1，每滿一個除數 +1 級
function commandLevel(conversations) { return Math.floor(Math.max(0, conversations) / COMMAND_DIVISOR) + 1; }
function slayLevel(typedChars) { return Math.floor(Math.max(0, typedChars) / SLAY_DIVISOR) + 1; }
function _todayStr() { return now().slice(0, 10); }

// 日曆週桶（7 天，Monday 對齊；epoch day0=Thu，+4 使 Monday 起算為整數邊界）
function weekIndex(ms) { return Math.floor((Math.floor(ms / 86400000) + 4) / 7); }

// 連勤（design §3.3 反焦慮版）：活躍日=有 task event 的日期；護符＝每進入一個新日曆週發 1 枚，
// 斷 1 天消耗 1 枚護符不算斷；current=從今日往回的連勤，longest=全期最長（PR，永久保留）。
function computeStreak(log, todayStr) {
  const days = new Set(log.filter((e) => e.kind === 'task').map((e) => e.ts.slice(0, 10)));
  if (!days.size) return { current: 0, longest: 0 };
  const dayMs = 86400000;
  const toMs = (s) => Date.parse(s + 'T00:00:00Z');
  const active = new Set([...days].map(toMs));
  // current：今日往回，遇活躍日 +1；遇空缺日有護符則消耗跳過、否則斷。每進入新週 +1 護符。
  let current = 0, cursor = toMs(todayStr), amulets = 0;
  const weeksSeen = new Set();
  while (true) {
    const wk = weekIndex(cursor);
    if (!weeksSeen.has(wk)) { weeksSeen.add(wk); amulets++; }
    if (active.has(cursor)) { current++; cursor -= dayMs; }
    else if (amulets > 0) { amulets--; cursor -= dayMs; }
    else break;
    if (current > 100000) break;
  }
  // longest：對 [min..max] 整段日期向前掃，同護符規則；斷掉時重置 run 與護符預算（新區段重新計週）。
  const sorted = [...active].sort((a, b) => a - b);
  const min = sorted[0], max = sorted[sorted.length - 1];
  let longest = 0, run = 0, amu = 0;
  let seg = new Set();
  for (let c = min; c <= max; c += dayMs) {
    const wk = weekIndex(c);
    if (!seg.has(wk)) { seg.add(wk); amu++; }
    if (active.has(c)) { run++; if (run > longest) longest = run; }
    else if (amu > 0) { amu--; }
    else { run = 0; amu = 1; seg = new Set([wk]); }
  }
  return { current, longest };
}

// ---- v2.5 衍生層：掃 transcript 原始彙總 ----
function _txtOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let s = '';
    for (const b of content) if (b && b.type === 'text' && typeof b.text === 'string') s += b.text;
    return s;
  }
  return '';
}
function _isToolResult(content) {
  return Array.isArray(content) && content.some((b) => b && b.type === 'tool_result');
}
function _emptyScan() {
  return { tok: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }, byModel: {}, billable: 0, totalProcessed: 0,
    messages: [], tsList: [], perSession: [], perDay: {}, userTurns: 0, userChars: 0, codeChars: 0,
    msgCount: 0, fileCount: 0, minTs: null, maxTs: null,
    perDayTurns: {}, perDayChars: {}, sessionSpans: [] };
}
function scanTranscripts(root = projectsRoot()) {
  const tok = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  const byModel = {};
  const messages = [];                 // {ts:ms, billable} 供委託區間 join（僅含有 usage 的訊息）
  const tsList = [];                   // 所有訊息 timestamp（ms）供使用時間
  const perSession = [];               // 每檔計費等效
  const perDay = {};                   // 'YYYY-MM-DD' → 計費等效
  let userTurns = 0, userChars = 0, codeChars = 0, msgCount = 0, fileCount = 0;
  let minTs = null, maxTs = null;
  const perDayTurns = {};
  const perDayChars = {};
  const sessionSpans = [];
  if (!fs.existsSync(root)) return _emptyScan();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.jsonl')) continue;
      fileCount++;
      let sessBill = 0;
      let sessMin = null, sessMax = null;
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let o; try { o = JSON.parse(line); } catch { continue; }
        const msg = o.message || o;
        const role = msg.role || o.type;
        const u = msg.usage;
        const tsRaw = o.timestamp;
        const tsMs = tsRaw ? Date.parse(tsRaw) : null;
        if (tsMs != null && !Number.isNaN(tsMs)) {
          tsList.push(tsMs);
          if (minTs == null || tsMs < minTs) minTs = tsMs;
          if (maxTs == null || tsMs > maxTs) maxTs = tsMs;
          if (sessMin == null || tsMs < sessMin) sessMin = tsMs;
          if (sessMax == null || tsMs > sessMax) sessMax = tsMs;
        }
        if (u && role === 'assistant') {
          tok.input += u.input_tokens || 0;
          tok.output += u.output_tokens || 0;
          tok.cacheCreation += u.cache_creation_input_tokens || 0;
          tok.cacheRead += u.cache_read_input_tokens || 0;
          const m = msg.model || 'unknown';
          const bm = byModel[m] || (byModel[m] = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });
          bm.input += u.input_tokens || 0; bm.output += u.output_tokens || 0;
          bm.cacheCreation += u.cache_creation_input_tokens || 0; bm.cacheRead += u.cache_read_input_tokens || 0;
          const b = BILLABLE(u);
          sessBill += b;
          if (tsMs != null && !Number.isNaN(tsMs)) { messages.push({ ts: tsMs, billable: b }); perDay[tsRaw.slice(0, 10)] = (perDay[tsRaw.slice(0, 10)] || 0) + b; } // NaN guard 與 tsList 一致：壞 timestamp 不入區間 join
          msgCount++;
        }
        if (role === 'user' && msg.content != null && !_isToolResult(msg.content)) {
          const t = _txtOf(msg.content);
          if (t && !t.startsWith('<')) {            // 排除系統注入（startsWith('<') 粗濾）
            userTurns++; userChars += [...t].length;
            const day = tsRaw ? tsRaw.slice(0, 10) : null;
            if (day) { perDayTurns[day] = (perDayTurns[day] || 0) + 1; perDayChars[day] = (perDayChars[day] || 0) + [...t].length; }
            for (const f of (t.match(/```[\s\S]*?```/g) || [])) codeChars += [...f].length;
          }
        }
      }
      if (sessBill > 0) perSession.push(sessBill);
      if (sessMin != null && sessMax != null && sessMax > sessMin) sessionSpans.push(sessMax - sessMin); // 單 session(檔)時長
    }
  };
  walk(root);
  const billable = tok.input + tok.output + tok.cacheCreation;
  return { tok, byModel, billable, totalProcessed: billable + tok.cacheRead,
    messages, tsList, perSession, perDay, userTurns, userChars, codeChars, // perSession/perDay：Plan 2 分位校準/每日里程碑用
    msgCount, fileCount, minTs, maxTs,
    perDayTurns, perDayChars, sessionSpans };
}

// 使用時間：相鄰訊息 gap<15 分才累加，回傳小時
function activeHours(tsList) {
  const a = tsList.slice().sort((x, y) => x - y);
  let total = 0;
  for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1]; if (d > 0 && d < ACTIVE_GAP_MS) total += d; }
  return total / 3600000;
}
// 等效成本 $：每 model 各欄 × 單價（model 名以 opus/sonnet/haiku 子字串匹配；未知→不計）
function costOf(byModel) {
  let usd = 0;
  for (const [model, v] of Object.entries(byModel)) {
    const key = /opus/i.test(model) ? 'opus' : /sonnet/i.test(model) ? 'sonnet' : /haiku/i.test(model) ? 'haiku' : null;
    if (!key) continue;
    const pr = PRICING[key];
    usd += (v.input * pr.in + v.output * pr.out + v.cacheCreation * pr.cc + v.cacheRead * pr.cr) / 1e6;
  }
  return usd;
}
function classifyTier(billable) {
  for (const t of QUEST_TIERS) if (billable >= t.lo && billable < t.hi) return t;
  return QUEST_TIERS[QUEST_TIERS.length - 1];
}
// 委託＝「每日」計費等效 token（v2.5-doc 改）：scan.perDay 一天一張委託單，依 QUEST_TIERS 分級。
// （原 questsByTaskInterval 改為 per-day；「一天一委託」語意更直觀、門檻錨真實單日量級。）
function questsByDay(scan) {
  return Object.entries(scan.perDay || {})
    .filter(([, billable]) => billable >= QUEST_FLOOR)   // 下限：當日 < 10 萬不算委託
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([day, billable]) => ({ day, billable, tier: classifyTier(billable).tier }));
}

// 衍生指標主函式（log = readLog() 結果；本 Task 只填基礎欄，委託/等級在後續 Task 補在 return base 前）
function deriveMetrics(scan, log) {
  const base = {
    billable: scan.billable,
    totalProcessed: scan.totalProcessed,
    flows: { input: scan.tok.input, output: scan.tok.output, cacheCreation: scan.tok.cacheCreation, cacheRead: scan.tok.cacheRead },
    conversations: scan.userTurns,
    typedChars: scan.userChars,
    codeChars: scan.codeChars,
    codePct: scan.userChars ? scan.codeChars / scan.userChars : 0,
    activeHours: activeHours(scan.tsList),
    costUSD: costOf(scan.byModel),
    window: { from: scan.minTs, to: scan.maxTs, files: scan.fileCount, messages: scan.msgCount },
  };
  const quests = questsByDay(scan);                       // 已按日序
  const tierCount = { D: 0, C: 0, B: 0, A: 0, S: 0 };
  for (const q of quests) tierCount[q.tier]++;            // 生涯計數：Gate 不抹去「該日發生過」
  base.quests = quests;
  base.tierCount = tierCount;
  base.elitePoints = eliteScore(quests);                  // v2.8：時序 fold + 逐階退役 Gate
  base.commandLevel = commandLevel(base.conversations);
  base.slayLevel = slayLevel(Math.max(0, base.typedChars - base.codeChars));
  base.streak = computeStreak(log, _todayStr());
  const maxVal = (m) => { const v = Object.values(m || {}); return v.length ? Math.max(...v) : 0; };
  base.maxDayToken = maxVal(scan.perDay);
  base.maxDayChars = maxVal(scan.perDayChars);
  base.maxDayConversations = maxVal(scan.perDayTurns);
  base.maxSessionHours = (scan.sessionSpans && scan.sessionSpans.length ? Math.max(...scan.sessionSpans) : 0) / 3600000;
  const byDay = {};
  for (const ms of scan.tsList) { const d = new Date(ms).toISOString().slice(0, 10); (byDay[d] || (byDay[d] = [])).push(ms); }
  base.maxDayActiveHours = Object.values(byDay).reduce((mx, arr) => Math.max(mx, activeHours(arr)), 0);
  base.maxQuestBillable = quests.length ? Math.max(...quests.map((q) => q.billable)) : 0;
  return base;
}

// 讀 achievements.json 全檔（缺檔/壞檔回 null）
function readAchievements(p = paths()) {
  try { return JSON.parse(fs.readFileSync(p.achievementsFile, 'utf8')); } catch { return null; }
}

// 衍生引擎入口：掃 transcript + log → 算指標 → 讀-合併-寫 achievements.json
// opts.projectsRoot 可注入（測試用）；opts.log 可注入，否則讀 p 的 log.jsonl
function deriveAchievements(p = paths(), opts = {}) {
  ensureBase(p);
  const root = opts.projectsRoot || projectsRoot();
  const log = opts.log || readLog(p);
  const prev = readAchievements(p) || {};
  const scan = scanTranscripts(root);
  const derived = deriveMetrics(scan, log);
  // 徽章解鎖（只進不退）
  const ctx = buildBadgeContext(computeState(log), log, derived);
  const nowUnlocked = evalBadges(ctx);
  const unlocked = Object.assign({}, prev.unlocked || {});
  // v2.7：prune 已退役（無 ACHIEVEMENTS 定義）的孤兒 id（如 supersede 掉的 cmd_10/slay_25）；不違反只進不退——榮譽由改名後新 id 承接
  const validIds = new Set(ACHIEVEMENTS.map((b) => b.id));
  for (const id of Object.keys(unlocked)) if (!validIds.has(id)) delete unlocked[id];
  const newly = [];
  for (const id of nowUnlocked) { if (!unlocked[id]) { unlocked[id] = now(); newly.push(id); } }
  // PR records 合併
  const prevRecords = prev.records || {};
  const records = mergeRecords(prevRecords, derived);
  const prs = recordPRs(prevRecords, records);
  const payload = {
    version: 'v2.8', scanned_at: now(),
    last_scanned_ts: scan.maxTs != null ? new Date(scan.maxTs).toISOString() : null,
    derived, unlocked, records, egg: prev.egg || {},
  };
  fs.writeFileSync(p.achievementsFile, JSON.stringify(payload, null, 2));
  return Object.assign({}, payload, { _newly: newly, _prs: prs }); // _ 欄只在回傳、不寫檔
}

// 讀 achievements.json 的 derived 區（顯示層用）；缺檔/壞檔回 null（→ renderStatus 維持舊輸出）
function readDerived(p = paths()) {
  const a = readAchievements(p);
  return a && a.derived ? a.derived : null;
}

// ---- CLI dispatch ----
function die(msg) { console.error(msg); process.exit(1); }
function need(val, msg) { if (!val) die(msg); return val; }

function main(argv) {
  const cmd = argv[0];
  const { pos, flags } = parseFlags(argv.slice(1));
  const opt = () => ({ dungeon: flags.dungeon || DEFAULT_DUNGEON, skills: parseSkills(flags) });
  switch (cmd) {
    case 'init': ensureBase(); persist(paths()); console.log('EXP 已初始化'); break;
    case 'task': addEvent('task', need(pos[0], '請提供事由：task "<事由>"'), opt()); break;
    case 'lesson': addEvent('lesson', need(pos[0], '請提供心得：lesson "<心得>"'), opt()); break;
    case 'chore': addEvent('chore', need(pos[0], '請提供事由：chore "<做了什麼>"'), opt()); break;
    case 'fail': addEvent('fail', need(pos[0], '請提供敗因：fail "<敗因>"'), opt()); break;
    case 'regress': addEvent('regress', need(pos[0], '請提供常錯：regress "<重犯的已知錯>"'), opt()); break;
    case 'status': {
      const p = paths();
      try { deriveAchievements(p); } catch (e) { console.error(`（derive 略過：${e.message}）`); } // 衍生失敗不擋面板
      const s = persist(p);
      const d = readDerived(p);
      const tail = d ? `｜指揮Lv${d.commandLevel} 殺敵Lv${d.slayLevel}` : '';
      console.log(`→ STATUS.md（冒險者 Lv${levelFor(s.global.exp)} EXP ${s.global.exp}${tail}）`);
      break;
    }
    case 'show': {                                              // 重算一次 → 只印面板第一行
      const p = paths();
      try { deriveAchievements(p); } catch (e) { console.error(`（derive 略過：${e.message}）`); }
      const s = persist(p);
      const d = readDerived(p);
      if (d) console.log(renderPanelLine(s, d));
      else console.log(`冒險者 Lv${levelFor(s.global.exp)} EXP ${s.global.exp}（derived 缺，無法產面板行）`);
      break;
    }
    case 'history': {
      const p = paths();
      const f = { dungeon: flags.dungeon, skill: flags.skill, kind: flags.kind, limit: flags.limit ? Number(flags.limit) : undefined, since: flags.since };
      if (flags.since) Object.assign(f, parseSince(flags.since));
      const rows = historyLines(readLog(p), f);
      writeView(p, 'history.md', renderHistory(readLog(p), f), `${rows.length} 筆`);
      break;
    }
    case 'dungeon': {
      const p = paths(); const name = need(pos[0], '請提供地城名：dungeon <地城>');
      const evs = readLog(p);
      writeView(p, `dungeon-${safeName(name)}.md`, renderDungeon(evs, computeState(evs), name));
      break;
    }
    case 'skill': {
      const p = paths(); const name = need(pos[0], '請提供技能名：skill <技能>');
      const evs = readLog(p);
      writeView(p, `skill-${safeName(name)}.md`, renderSkill(evs, computeState(evs), name));
      break;
    }
    case 'report': {
      const p = paths(); const spec = flags.since || '本月';
      const range = parseSince(spec);
      writeView(p, `report-${safeName(spec)}.md`, renderReport(readLog(p), range, spec));
      break;
    }
    case 'stage': {
      if (!['task', 'lesson', 'chore', 'fail', 'regress'].includes(flags.kind)) die('stage 需 --kind task|lesson|chore|fail|regress');
      const reason = need(pos[0], 'stage 需事由：stage --kind task "<事由>"');
      stagePending({ kind: flags.kind, reason, dungeon: flags.dungeon || DEFAULT_DUNGEON, skills: parseSkills(flags) });
      console.log(`✎ staged ${KIND_LABEL[flags.kind] || flags.kind} (+${EXP_OF[flags.kind] ?? 0} EXP)｜${reason}`);
      break;
    }
    case 'flush': {
      const p = paths();
      const before = readState(p).global.exp;
      const n = flushPending(p);
      if (n > 0) {
        try { process.stdout.write(fs.readFileSync(p.lastFlushFile, 'utf8')); } catch {}
        console.log(`✓ flushed ${n} 筆｜冒險者 EXP ${before} → ${readState(p).global.exp}`);
      } else {
        console.log('✓ flushed 0 筆');
      }
      let res = null;
      try { res = deriveAchievements(p); } catch (e) { console.error(`（derive 略過：${e.message}）`); }
      persist(p); // 刷新 STATUS.md（含面板/儀表板/徽章）
      if (res) { // v2.5 Plan3 四元素 flush 一行（薄 AI、無 EXP）
        for (const id of res._newly) { const b = badgeById(id); if (b) console.log(`🏅 解鎖徽章【${b.name}】(${b.rarity})`); }
        const ach = readAchievements(p) || {};
        const egg = ach.egg || {};
        const line = pickEasterEgg(res.derived, egg, res._prs, _todayStr());
        if (line) console.log(line);
        ach.egg = egg;
        try { fs.writeFileSync(p.achievementsFile, JSON.stringify(ach, null, 2)); } catch {}
      }
      break;
    }
    case 'lastflush': {
      const p = paths();
      if (fs.existsSync(p.lastFlushFile)) process.stdout.write(fs.readFileSync(p.lastFlushFile, 'utf8'));
      else console.log('（尚無本輪入帳紀錄）');
      break;
    }
    case 'remove': {
      const p = paths();
      if (!flags.last && !flags.ts && !flags.match) die('remove 需 --last 或 --ts "<時間戳>" 或 --match "<事由片段>"');
      const opts = { last: ('last' in flags) && flags.last !== 'false', ts: flags.ts, match: flags.match };
      const { removed } = removeEvents(opts, p);
      if (!removed.length) { console.log('（無符合項目）'); break; }
      for (const e of removed) console.log(`✗ removed  ${e.ts}  ${e.kind} +${e.exp ?? 0}｜${e.reason}`);
      console.log(`共移除 ${removed.length} 筆`);
      break;
    }
    case 'derive': {
      const p = paths();
      const r = deriveAchievements(p);
      const d = r.derived;
      console.log(`✓ derive 完成 → ${p.achievementsFile}`);
      console.log(`計費等效 ${fmtYi(d.billable, 2)}｜總處理量 ${fmtYi(d.totalProcessed, 1)}｜成本 ${fmtUSD(d.costUSD)}`);
      console.log(`對話 ${d.conversations} → 指揮Lv${d.commandLevel}｜打字 ${(d.typedChars/10000).toFixed(1)}萬字(code ${(d.codePct*100).toFixed(0)}%) → 殺敵Lv${d.slayLevel}`);
      console.log(`委託 D${d.tierCount.D}/C${d.tierCount.C}/B${d.tierCount.B}/A${d.tierCount.A}/S${d.tierCount.S}｜精英分 ${d.elitePoints}｜streak ${d.streak.current}(PR${d.streak.longest})`);
      console.log(`使用時間 ${d.activeHours.toFixed(1)}hr｜窗 ${d.window.files} 檔 ${d.window.messages} 訊息`);
      break;
    }
    case 'rebuild': {
      const p = paths(); const s = persist(p);
      console.log(`已從 log 重建 state（冒險者 EXP ${s.global.exp}）`);
      break;
    }
    case 'help': console.log(HELP); break;
    default: console.error(`未知指令：${cmd || '(無)'}（試試 help）`); process.exit(1);
  }
}

module.exports = {
  LEVEL_STEP, EXP_OF, KIND_LABEL, DEFAULT_DUNGEON, DEFAULT_SKILLS,
  resolveHome, paths, levelFor, progressFor, progressBy,
  fmtTs, now, ensureBase, appendEvent, readLog, eventSkills,
  applyEvent, computeState, writeState, readState,
  parseSince, filterEvents, parseSkills,
  renderStatus, renderHistory, renderDungeon, renderSkill, renderReport,
  nearDup, parseFlags, addEvent, persist,
  historyLines, writeView, safeName,
  buildEvent, stagePending, readPending, flushPending, flushSummaryText, removeEvents,
  loadConfig, expDeltaOf,
  scanTranscripts, activeHours, costOf, deriveMetrics, classifyTier, questsByDay, deriveAchievements, readDerived, readAchievements, // v2.5 衍生層
  commandLevel, slayLevel, computeStreak, weekIndex, // v2.5 等級公式 + 連勤
  fmtYi, fmtWan, fmtUSD, eliteLevel, eliteScore, ELITE_STEP, ELITE_WEIGHT, ELITE_GATE, // v2.5 顯示層：數字格式 + 精英等級（v2.8 平線+Gate）
  renderPanelLine, renderFuelDashboard, // v2.5 一行式四等級面板 + 燃料儀表板
  RARITY_RANK, ACHIEVEMENTS, badgeById, buildBadgeContext, evalBadges, // v2.5 Plan3 徽章
  deriveTitle, mergeRecords, recordPRs, pickEasterEgg, RARE_LINES,
  loadTitlePin, renderBadges, // v2.5 Plan3 顯示層
};

if (require.main === module) main(process.argv.slice(2));
