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
// 委託界線（計費等效 token；design §4.1，錨真實分位 p25/中位/p75/p90）
const QUEST_TIERS = [
  { tier: 'D', lo: 0,        hi: 170000 },
  { tier: 'C', lo: 170000,   hi: 330000 },
  { tier: 'B', lo: 330000,   hi: 760000 },
  { tier: 'A', lo: 760000,   hi: 1800000 },
  { tier: 'S', lo: 1800000,  hi: Infinity },
];
const ELITE_WEIGHT = { D: 1, C: 2, B: 3, A: 5, S: 8 }; // 精英分權重
function projectsRoot() { return path.join(os.homedir(), '.claude', 'projects'); }
const ACTIVE_GAP_MS = 15 * 60000;           // 使用時間：相鄰訊息 gap<15 分才累加
// 定價（每百萬 token，2026-06；查 claude-api skill 為準，變動只重算展示欄、不影響等級）
const PRICING = {
  opus:   { in: 5,  out: 25, cc: 6.25, cr: 0.5 },
  sonnet: { in: 3,  out: 15, cc: 3.75, cr: 0.3 },
  haiku:  { in: 1,  out: 5,  cc: 1.25, cr: 0.1 },
};

// ---- 路徑 ----
function resolveHome() {
  return process.env.EXPBOOK_HOME || path.join(os.homedir(), '.gemini', 'expbook');
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

// ---- 設定覆寫：使用者可在 ~/.gemini/expbook/config.json 調整各 kind 的 EXP 數值 ----
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

// ---- 等級數學 ----
function levelFor(exp) { return Math.floor(exp / LEVEL_STEP) + 1; }
function progressFor(exp) {
  const lv = levelFor(exp);
  const into = exp - (lv - 1) * LEVEL_STEP;
  return { lv, into, step: LEVEL_STEP, toNext: LEVEL_STEP - into };
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

function renderStatus(state) {
  const g = progressFor(state.global.exp);
  let out = `# EXP 玩家面板（冒險者公會）\n\n`;
  out += `冒險者　LV${g.lv} (${g.into}/${g.step}) Total:${state.global.exp}\n\n`;
  out += `地城（專案）\n`;
  const dungeons = Object.entries(state.dungeons).sort((a, b) => b[1].exp - a[1].exp);
  if (!dungeons.length) out += `  （尚無）\n`;
  for (const [name, d] of dungeons) out += lvLine(`【${name}】`, d.exp);
  out += `\n技能（能力 · 依分類小計，‹…› 為原始細項明細）\n`;
  const { groups, uncategorized } = categorizeSkills(state);
  for (const g of groups) {
    out += `  〔${g.group}〕\n`;
    for (const c of g.cats) out += lvLineAt(c.name, c.exp, '    ', c.members.join('·'));
  }
  if (uncategorized.length) {
    out += `  〔未分類〕← 建議補進 SKILL_GROUPS\n`;
    for (const u of uncategorized) out += lvLineAt(u.name, u.exp, '    ', '');
  }
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
  fs.writeFileSync(p.statusFile, renderStatus(state));
  return state;
}
function buildEvent(kind, reason, { dungeon, skills } = {}) {
  const ev = { ts: now(), kind, reason };
  if (dungeon) ev.dungeon = dungeon;
  if (skills && skills.length) ev.skills = skills;
  ev.exp = EXP_OF[kind] ?? 0;
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

// ---- v2.5 衍生層：等級公式 ----
function commandLevel(conversations) { return Math.floor(Math.sqrt(Math.max(0, conversations) / 4)); }
function slayLevel(typedChars) { return Math.floor(Math.sqrt(Math.max(0, typedChars) / 600)); }
function _todayStr() { return now().slice(0, 10); }

// 連勤計算（護符抵斷；活躍日 = 有 task event 的日期）
function computeStreak(log, todayStr) {
  const days = new Set(log.filter((e) => e.kind === 'task').map((e) => e.ts.slice(0, 10)));
  if (!days.size) return { current: 0, longest: 0 };
  const dayMs = 86400000;
  const toMs = (s) => Date.parse(s + 'T00:00:00Z');
  const activeSet = new Set([...days].map(toMs));
  // current：從 today 往回，只有活躍日 increment current，護符允許跨越單日空缺
  let current = 0, tokens = 0, cursor = toMs(todayStr);
  while (true) {
    if (activeSet.has(cursor)) { current++; cursor -= dayMs; }
    else {
      const earned = Math.floor(current / 7) + 1;
      if (tokens < earned) { tokens++; cursor -= dayMs; }
      else break;
    }
    if (current > 100000) break;
  }
  // longest：對排序活躍日做同規則連鏈
  const sorted = [...activeSet].sort((a, b) => a - b);
  let longest = 0, run = 0, tok2 = 0, prev = null;
  for (const ms of sorted) {
    if (prev == null) { run = 1; tok2 = 0; }
    else {
      const gapDays = Math.round((ms - prev) / dayMs);
      if (gapDays === 1) run++;
      else if (gapDays === 2 && tok2 < Math.floor(run / 7) + 1) { tok2++; run++; }
      else { run = 1; tok2 = 0; }
    }
    if (run > longest) longest = run;
    prev = ms;
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
    msgCount: 0, fileCount: 0, minTs: null, maxTs: null };
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
  if (!fs.existsSync(root)) return _emptyScan();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.jsonl')) continue;
      fileCount++;
      let sessBill = 0;
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
            for (const f of (t.match(/```[\s\S]*?```/g) || [])) codeChars += [...f].length;
          }
        }
      }
      if (sessBill > 0) perSession.push(sessBill);
    }
  };
  walk(root);
  const billable = tok.input + tok.output + tok.cacheCreation;
  return { tok, byModel, billable, totalProcessed: billable + tok.cacheRead,
    messages, tsList, perSession, perDay, userTurns, userChars, codeChars, // perSession/perDay：Plan 2 分位校準/每日里程碑用
    msgCount, fileCount, minTs, maxTs };
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
// 把 transcript token 依 task event 時間區間歸成委託；回傳每筆 task 對應的委託
function questsByTaskInterval(scan, log) {
  const tasks = log.filter((e) => e.kind === 'task')
    .map((e) => ({ ev: e, ms: Date.parse(e.ts) }))
    .filter((x) => !Number.isNaN(x.ms))
    .sort((a, b) => a.ms - b.ms);
  if (!tasks.length) return [];
  const quests = tasks.map((t) => ({ ts: t.ev.ts, reason: t.ev.reason, dungeon: t.ev.dungeon || null, billable: 0 }));
  for (const m of scan.messages) {
    let idx = -1;
    for (let i = 0; i < tasks.length; i++) { if (m.ts <= tasks[i].ms) { idx = i; break; } }
    if (idx >= 0) quests[idx].billable += m.billable;
  }
  for (const q of quests) q.tier = classifyTier(q.billable).tier;
  return quests;
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
  const quests = questsByTaskInterval(scan, log);
  const tierCount = { D: 0, C: 0, B: 0, A: 0, S: 0 };
  let elitePoints = 0;
  for (const q of quests) { tierCount[q.tier]++; elitePoints += ELITE_WEIGHT[q.tier] || 0; }
  base.quests = quests;
  base.tierCount = tierCount;
  base.elitePoints = elitePoints;
  base.commandLevel = commandLevel(base.conversations);
  base.slayLevel = slayLevel(Math.max(0, base.typedChars - base.codeChars));
  base.streak = computeStreak(log, _todayStr());
  return base;
}

// 衍生引擎入口：掃 transcript + log → 算指標 → 寫 achievements.json（衍生快取，可 rebuild 重算）
// opts.projectsRoot 可注入（測試用）；opts.log 可注入，否則讀 p 的 log.jsonl
function deriveAchievements(p = paths(), opts = {}) {
  ensureBase(p);
  const root = opts.projectsRoot || projectsRoot();
  const log = opts.log || readLog(p);
  const scan = scanTranscripts(root);
  const derived = deriveMetrics(scan, log);
  const payload = {
    version: 'v2.5',
    scanned_at: now(),
    last_scanned_ts: scan.maxTs != null ? new Date(scan.maxTs).toISOString() : null,
    derived,
  };
  fs.writeFileSync(p.achievementsFile, JSON.stringify(payload, null, 2));
  return payload;
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
      const p = paths(); const s = persist(p);
      console.log(`→ STATUS.md（冒險者 Lv${levelFor(s.global.exp)} EXP ${s.global.exp}）`);
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
      const 億 = (n) => (n / 1e8).toFixed(2) + '億';
      console.log(`✓ derive 完成 → ${p.achievementsFile}`);
      console.log(`計費等效 ${億(d.billable)}｜總處理量 ${億(d.totalProcessed)}｜成本 $${d.costUSD.toFixed(0)}`);
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
  resolveHome, paths, levelFor, progressFor,
  fmtTs, now, ensureBase, appendEvent, readLog, eventSkills,
  applyEvent, computeState, writeState, readState,
  parseSince, filterEvents, parseSkills,
  renderStatus, renderHistory, renderDungeon, renderSkill, renderReport,
  nearDup, parseFlags, addEvent, persist,
  historyLines, writeView, safeName,
  buildEvent, stagePending, readPending, flushPending, flushSummaryText, removeEvents,
  loadConfig, expDeltaOf,
  scanTranscripts, activeHours, costOf, deriveMetrics, classifyTier, questsByTaskInterval, deriveAchievements, // v2.5 衍生層
  commandLevel, slayLevel, computeStreak, // v2.5 等級公式 + 連勤
};

if (require.main === module) main(process.argv.slice(2));
