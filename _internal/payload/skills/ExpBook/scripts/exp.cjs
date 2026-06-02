#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- 常數 ----
const LEVEL_STEP = 500;
const EXP_OF = { task: 100, lesson: 1, facet: 20, fail: 0 };
const ABILITIES = ['除錯', '架構', '實作', '重構', '研究', '工具', '知識'];

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

// ---- computeState ----
function applyEvent(state, e) {
  const amt = EXP_OF[e.kind] ?? 0;
  if (e.kind === 'fail') { state.updated = e.ts; return; }
  if (e.kind !== 'facet') {
    state.global.exp += amt;
    if (e.type && state.abilities[e.type]) state.abilities[e.type].exp += amt;
  }
  if (e.dungeon) {
    const d = state.dungeons[e.dungeon] || (state.dungeons[e.dungeon] = { exp: 0, facets: [] });
    d.exp += amt;
    if (e.kind === 'facet' && e.reason) d.facets.push(e.reason);
  }
  state.updated = e.ts;
}
function computeState(events) {
  const state = { global: { exp: 0 }, abilities: {}, dungeons: {}, updated: null };
  for (const a of ABILITIES) state.abilities[a] = { exp: 0 };
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
    if (f.type && e.type !== f.type) return false;
    if (f.kind && e.kind !== f.kind) return false;
    return true;
  });
}

// ---- 渲染器 ----
function bar(into, step, width = 8) {
  const n = Math.round((into / step) * width);
  return '▓'.repeat(n) + '░'.repeat(width - n);
}
function expDeltaOf(e) { return e.kind === 'fail' ? 0 : (EXP_OF[e.kind] ?? 0); }
function deltaLabel(e) {
  if (e.kind === 'fail') return '✗   ';
  return '+' + String(expDeltaOf(e)).padEnd(3);
}
function kindTag(e) {
  if (e.kind === 'facet') return '面向';
  if (e.kind === 'lesson') return '教訓';
  return e.type || '—';
}

function renderStatus(state) {
  const g = progressFor(state.global.exp);
  let out = `# EXP 玩家面板\n\n`;
  out += `主線　Lv${g.lv}　EXP ${state.global.exp}　${bar(g.into, g.step)} ${g.into}/${g.step} 到 Lv${g.lv + 1}\n\n`;
  out += `能力\n`;
  for (const a of ABILITIES) {
    const p = progressFor(state.abilities[a].exp);
    out += `  ${a} Lv${p.lv} ${bar(p.into, p.step)}\n`;
  }
  out += `\n副本\n`;
  for (const [name, d] of Object.entries(state.dungeons)) {
    const lv = levelFor(d.exp);
    out += `  【${name}】Lv${lv}　EXP ${d.exp}　已探明 ${d.facets.length} 項\n`;
    for (const f of d.facets.slice(-5)) out += `    - ${f}\n`;
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
    f.dungeon && `副本=${f.dungeon}`,
    f.type && `類型=${f.type}`,
    f.kind && `kind=${f.kind}`,
    f.since && `since=${f.since}`,
  ].filter(Boolean);
  out += cond.length ? `（${cond.join('，')}）\n\n` : `\n\n`;
  for (const e of rows) {
    out += `${e.ts.slice(0, 16)}  ${deltaLabel(e)}  [${kindTag(e)}]  (${e.dungeon || '—'})  ${e.reason}\n`;
  }
  out += `\n共 ${rows.length} 筆\n`;
  return out;
}

function renderDungeon(events, state, name) {
  const d = state.dungeons[name] || { exp: 0, facets: [] };
  let out = `# 副本報告：${name}\n\n`;
  out += `Lv${levelFor(d.exp)}　EXP ${d.exp}　已探明 ${d.facets.length} 項\n\n## 探明面向\n`;
  for (const f of d.facets) out += `- ${f}\n`;
  out += `\n## 事件\n`;
  for (const e of historyLines(events, { dungeon: name, limit: 50 })) {
    out += `${e.ts.slice(0, 16)}  ${deltaLabel(e)}  [${kindTag(e)}]  ${e.reason}\n`;
  }
  return out;
}

function renderAbility(events, state, type) {
  if (type) {
    let out = `# 能力報告：${type} Lv${levelFor(state.abilities[type].exp)}（EXP ${state.abilities[type].exp}）\n\n`;
    for (const e of historyLines(events, { type, limit: 50 })) {
      out += `${e.ts.slice(0, 16)}  ${deltaLabel(e)}  (${e.dungeon || '—'})  ${e.reason}\n`;
    }
    return out;
  }
  let out = `# 能力分布\n\n`;
  for (const a of ABILITIES) {
    const p = progressFor(state.abilities[a].exp);
    out += `${a} Lv${p.lv}　EXP ${state.abilities[a].exp}　${bar(p.into, p.step)}\n`;
  }
  return out;
}

function renderReport(events, range, label) {
  const rows = filterEvents(events, range);
  const count = (k) => rows.filter((e) => e.kind === k).length;
  const expSum = rows.reduce((s, e) => s + expDeltaOf(e), 0);
  const byType = {}; const byDun = {};
  for (const e of rows) {
    if (e.kind === 'task' && e.type) byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.dungeon) byDun[e.dungeon] = (byDun[e.dungeon] || 0) + 1;
  }
  const fmtMap = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、') || '—';
  let out = `# ${label || '期間'}彙總 ${range.from.slice(0, 10)} ~ ${range.to.slice(0, 10)}\n`;
  out += `完成任務 ${count('task')}｜教訓 ${count('lesson')}｜面向 ${count('facet')}｜失敗 ${count('fail')}｜共 +${expSum} EXP\n`;
  out += `依類型：${fmtMap(byType)}\n依副本：${fmtMap(byDun)}\n`;
  return out;
}

// ---- 寫入指令 ----
function dungeonFromCwd(cwd = process.cwd()) { return path.basename(cwd); }
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
function persist(p) {
  const state = computeState(readLog(p));
  writeState(state, p);
  fs.writeFileSync(p.statusFile, renderStatus(state));
  return state;
}
function buildEvent(kind, reason, { type, dungeon } = {}) {
  const ev = { ts: now(), kind, reason };
  if (type) ev.type = type;
  if (dungeon) ev.dungeon = dungeon;
  ev.exp = kind === 'fail' ? 0 : (EXP_OF[kind] ?? 0);
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
  for (const it of items) appendEvent(buildEvent(it.kind, it.reason, { type: it.type, dungeon: it.dungeon }), p);
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

function addEvent(kind, reason, { type, dungeon } = {}, p = paths()) {
  const ev = buildEvent(kind, reason, { type, dungeon });
  if (dungeon) {
    const dup = nearDup(dungeon, Object.keys(readState(p).dungeons || {}));
    if (dup) process.stderr.write(`⚠ 副本「${dungeon}」近似既有「${dup}」，確認是否同一個\n`);
  }
  appendEvent(ev, p);
  const state = persist(p);
  const g = progressFor(state.global.exp);
  console.log(`✓ ${kind} ${ev.exp ? '+' + ev.exp : '✗'}｜主線 Lv${g.lv} (${state.global.exp})｜${reason}`);
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

const HELP = `ExpBook 指令
  寫入：
    task   "<事由>" --type <類型> [--dungeon <副本>]   完成任務 +100
    lesson "<教訓>" [--type <類型>] [--dungeon <副本>]  教訓 +1
    facet  <副本> "<探明面向>"                          副本 +20
    fail   "<失敗筆記>" [--type ..] [--dungeon ..]      只記歷程，exp 0
  檢視（產報告檔，只回指標）：
    status                     → STATUS.md
    history [--dungeon|--type|--kind|--since|--limit]  → views/history.md
    dungeon <副本>              → views/dungeon-<副本>.md
    ability [<類型>]            → views/ability.md
    report --since <今日|本週|本月|YYYY-MM-DD[..YYYY-MM-DD]>  → views/report-<期間>.md
  暫存/沖刷（hook 用）：
    stage --kind <task|lesson|facet|fail> "<事由>" [--type ..] [--dungeon ..]   暫存到 _pending
    flush                      把 _pending 全部沖進 log（Stop hook 每輪呼叫）
  維運：rebuild ｜ init ｜ help
    remove --last｜--ts "<時間戳>"｜--match "<事由片段>"   從 log 移除事件並重建 state
  類型：${ABILITIES.join(' / ')}`;

// ---- CLI dispatch ----
function die(msg) { console.error(msg); process.exit(1); }
function need(val, msg) { if (!val) die(msg); return val; }

function main(argv) {
  const cmd = argv[0];
  const { pos, flags } = parseFlags(argv.slice(1));
  const dgn = () => flags.dungeon || dungeonFromCwd();
  switch (cmd) {
    case 'init': ensureBase(); persist(paths()); console.log('EXP 已初始化'); break;
    case 'task': addEvent('task', need(pos[0], '請提供事由：task "<事由>" --type <類型>'), { type: flags.type, dungeon: dgn() }); break;
    case 'lesson': addEvent('lesson', need(pos[0], '請提供教訓：lesson "<教訓>"'), { type: flags.type, dungeon: dgn() }); break;
    case 'fail': addEvent('fail', need(pos[0], '請提供失敗筆記：fail "<筆記>"'), { type: flags.type, dungeon: dgn() }); break;
    case 'facet':
      need(pos[0], '請提供副本與面向：facet <副本> "<面向>"');
      addEvent('facet', need(pos[1], '請提供探明面向：facet <副本> "<面向>"'), { dungeon: pos[0] });
      break;
    case 'status': {
      const p = paths(); const s = persist(p);
      console.log(`→ STATUS.md（主線 Lv${levelFor(s.global.exp)} EXP ${s.global.exp}）`);
      break;
    }
    case 'history': {
      const p = paths();
      const f = { dungeon: flags.dungeon, type: flags.type, kind: flags.kind, limit: flags.limit ? Number(flags.limit) : undefined, since: flags.since };
      if (flags.since) Object.assign(f, parseSince(flags.since));
      const rows = historyLines(readLog(p), f);
      writeView(p, 'history.md', renderHistory(readLog(p), f), `${rows.length} 筆`);
      break;
    }
    case 'dungeon': {
      const p = paths(); const name = need(pos[0], '請提供副本名：dungeon <副本>');
      const evs = readLog(p);
      writeView(p, `dungeon-${safeName(name)}.md`, renderDungeon(evs, computeState(evs), name));
      break;
    }
    case 'ability': {
      const p = paths();
      if (pos[0] && !ABILITIES.includes(pos[0])) die(`未知能力類型：${pos[0]}（可用：${ABILITIES.join(' / ')}）`);
      const evs = readLog(p);
      writeView(p, 'ability.md', renderAbility(evs, computeState(evs), pos[0]));
      break;
    }
    case 'report': {
      const p = paths(); const spec = flags.since || '本月';
      const range = parseSince(spec);
      writeView(p, `report-${safeName(spec)}.md`, renderReport(readLog(p), range, spec));
      break;
    }
    case 'stage': {
      if (!['task', 'lesson', 'facet', 'fail'].includes(flags.kind)) die('stage 需 --kind task|lesson|facet|fail');
      const reason = need(pos[0], 'stage 需事由：stage --kind task "<事由>"');
      stagePending({ kind: flags.kind, reason, type: flags.type, dungeon: dgn() });
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
      for (const e of removed) console.log(`✗ removed  ${e.ts}  ${e.kind} ${e.exp ? '+' + e.exp : ''}｜${e.reason}`);
      console.log(`共移除 ${removed.length} 筆`);
      break;
    }
    case 'rebuild': {
      const p = paths(); const s = persist(p);
      console.log(`已從 log 重建 state（主線 EXP ${s.global.exp}）`);
      break;
    }
    case 'help': console.log(HELP); break;
    default: console.error(`未知指令：${cmd || '(無)'}（試試 help）`); process.exit(1);
  }
}

module.exports = {
  LEVEL_STEP, EXP_OF, ABILITIES,
  resolveHome, paths, levelFor, progressFor,
  fmtTs, now, ensureBase, appendEvent, readLog,
  applyEvent, computeState, writeState, readState,
  parseSince, filterEvents,
  renderStatus, renderHistory, renderDungeon, renderAbility, renderReport,
  dungeonFromCwd, nearDup, parseFlags, addEvent, persist,
  historyLines, writeView, safeName,
  buildEvent, stagePending, readPending, flushPending, removeEvents,
};

if (require.main === module) main(process.argv.slice(2));
