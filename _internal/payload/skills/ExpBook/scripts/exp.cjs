#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- 常數（冒險者公會制）----
const LEVEL_STEP = 1000;
const EXP_OF = { task: 200, lesson: 20, chore: 1, fail: 1, regress: 1 };
const KIND_LABEL = { task: '任務', lesson: '心法', chore: '練功', fail: '敗戰', regress: '常錯' };
const DEFAULT_DUNGEON = '日常訓練(雜項)';                 // 未指明地城時的預設
const DEFAULT_SKILLS = ['除錯', '架構', '實作', '重構', '研究', '工具', '知識']; // 面板恆顯示；可自由新增其他技能 tag

// ---- 路徑 ----
function resolveHome() {
  return process.env.EXPBOOK_HOME || path.join(os.homedir(), '.claude', 'expbook');
}
function paths(base = resolveHome()) {
  return {
    base,
    logFile: path.join(base, 'log.jsonl'),
    stateFile: path.join(base, 'state.json'),
    statusFile: path.join(base, 'STATUS.md'),
    viewsDir: path.join(base, 'views'),
    pendingFile: path.join(base, '_pending.jsonl'),
  };
}

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
  const amt = EXP_OF[e.kind] ?? 0;
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
function expDeltaOf(e) { return EXP_OF[e.kind] ?? 0; }
function deltaLabel(e) { return '+' + String(expDeltaOf(e)).padEnd(3); }
function kindTag(e) { return KIND_LABEL[e.kind] || e.kind; }
function skillTag(e) { const s = eventSkills(e); return s.length ? `{${s.join('·')}} ` : ''; }
function lvLine(name, exp) {
  const p = progressFor(exp);
  return `  ${name} LV${p.lv} (${p.into}/${p.step}) Total:${exp}\n`;
}

function renderStatus(state) {
  const g = progressFor(state.global.exp);
  let out = `# EXP 玩家面板（冒險者公會）\n\n`;
  out += `冒險者　LV${g.lv} (${g.into}/${g.step}) Total:${state.global.exp}\n\n`;
  out += `地城（專案）\n`;
  const dungeons = Object.entries(state.dungeons).sort((a, b) => b[1].exp - a[1].exp);
  if (!dungeons.length) out += `  （尚無）\n`;
  for (const [name, d] of dungeons) out += lvLine(`【${name}】`, d.exp);
  out += `\n技能（能力）\n`;
  const extras = Object.keys(state.skills).filter((k) => !DEFAULT_SKILLS.includes(k));
  for (const s of DEFAULT_SKILLS) out += lvLine(s, (state.skills[s] || { exp: 0 }).exp);
  for (const s of extras.sort((a, b) => state.skills[b].exp - state.skills[a].exp)) out += lvLine(s, state.skills[s].exp);
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
function flushPending(p = paths()) {
  const items = readPending(p);
  if (!items.length) return 0;
  for (const it of items) appendEvent(buildEvent(it.kind, it.reason, { dungeon: it.dungeon, skills: it.skills }), p);
  persist(p);
  fs.writeFileSync(p.pendingFile, '');
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
    stage --kind <task|lesson|chore|fail|regress> "<事由>" [--dungeon ..] [--skill ..]   暫存到 _pending
    flush                      把 _pending 全部沖進 log（Stop hook 每輪呼叫）
  維運：rebuild ｜ init ｜ help
    remove --last｜--ts "<時間戳>"｜--match "<事由片段>"   從 log 移除事件並重建 state
  預設 7 技能：${DEFAULT_SKILLS.join(' / ')}（可自由新增其他技能 tag）`;

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
      console.log(`✎ staged ${flags.kind}｜${reason}`);
      break;
    }
    case 'flush': {
      const n = flushPending(paths());
      console.log(`✓ flushed ${n} 筆`);
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
  buildEvent, stagePending, readPending, flushPending, removeEvents,
};

if (require.main === module) main(process.argv.slice(2));
