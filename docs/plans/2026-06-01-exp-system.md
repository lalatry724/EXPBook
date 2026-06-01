# EXP Agent 成長歷程系統 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一支零依賴的 Node CLI `exp.cjs`，把 Agent 工作歷程記成事件 log，並由程式渲染成報告檔，達成「厚程式、薄 AI、低耗 token」的成長歷程系統。

**Architecture:** 單一可移植檔 `exp.cjs`。`log.jsonl` 為唯一真相（append-only 事件流）；`state.json` 由 log 算出；所有檢視渲染成 `STATUS.md` / `views/*.md` 報告檔，stdout 只回指標。核心邏輯（等級計算、日期解析、彙總、渲染）全在程式裡，並以 `module.exports` 匯出純函式供單元測試。

**Tech Stack:** Node.js 24（純內建模組 fs/path/os）、`node:test` + `node:assert`（零外部依賴）。資料路徑經 `EXP_HOME` 或 `os.homedir()/.claude/exp/` 解析。

規格來源：`docs/specs/2026-06-01-agent-rpg-growth-system-design.md`

---

## File Structure

- `exp.cjs` — 唯一 CLI 與函式庫。直接執行時跑 CLI（`require.main === module`），被 require 時匯出純函式供測試。內部分區：常數 / 路徑 / 等級數學 / 時間 / log IO / computeState / 日期篩選 / 渲染 / 指令處理 / dispatch。
- `test/exp.test.cjs` — `node:test` 測試，純函式用 require 直測；副作用指令用 `EXP_HOME` 指向暫存目錄測。
- `SKILL.md` — 部署成 `~/.claude/skills/EXP/` 用：自律觸發規則、口語對照表、事由品質規範。

執行測試一律：`node --test`（在 repo 根目錄）。

共用常數與型別（所有後續任務沿用，勿改名）：
- `LEVEL_STEP = 500`
- `EXP_OF = { task: 100, lesson: 1, facet: 20, fail: 0 }`
- `ABILITIES = ['除錯','架構','實作','重構','研究','工具','知識']`
- 事件物件：`{ ts, kind, reason, type?, dungeon?, exp }`，`kind ∈ {task,lesson,facet,fail}`
- state：`{ global:{exp}, abilities:{<類型>:{exp}}, dungeons:{<名>:{exp,facets:[]}}, updated }`
- 時間字串格式：`YYYY-MM-DD HH:MM:SS`（可字典序比較）

---

## Task 1: 骨架、路徑解析、等級數學

**Files:**
- Create: `exp.cjs`
- Test: `test/exp.test.cjs`

- [ ] **Step 1: 寫失敗測試**

`test/exp.test.cjs`：
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const exp = require('../exp.cjs');

test('levelFor: 每 500 EXP 升一級', () => {
  assert.equal(exp.levelFor(0), 1);
  assert.equal(exp.levelFor(499), 1);
  assert.equal(exp.levelFor(500), 2);
  assert.equal(exp.levelFor(1680), 4);
});

test('progressFor: 回報進度', () => {
  const p = exp.progressFor(1680);
  assert.equal(p.lv, 4);
  assert.equal(p.into, 180);
  assert.equal(p.toNext, 320);
  assert.equal(p.step, 500);
});

test('resolveHome: EXP_HOME 優先', () => {
  const old = process.env.EXP_HOME;
  process.env.EXP_HOME = path.join('X', 'Y');
  assert.equal(exp.resolveHome(), path.join('X', 'Y'));
  process.env.EXP_HOME = old;
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test`
Expected: FAIL（`Cannot find module '../exp.cjs'`）

- [ ] **Step 3: 寫最小實作**

`exp.cjs`：
```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const LEVEL_STEP = 500;
const EXP_OF = { task: 100, lesson: 1, facet: 20, fail: 0 };
const ABILITIES = ['除錯', '架構', '實作', '重構', '研究', '工具', '知識'];

function resolveHome() {
  return process.env.EXP_HOME || path.join(os.homedir(), '.claude', 'exp');
}
function paths(base = resolveHome()) {
  return {
    base,
    logFile: path.join(base, 'log.jsonl'),
    stateFile: path.join(base, 'state.json'),
    statusFile: path.join(base, 'STATUS.md'),
    viewsDir: path.join(base, 'views'),
  };
}

function levelFor(exp) { return Math.floor(exp / LEVEL_STEP) + 1; }
function progressFor(exp) {
  const lv = levelFor(exp);
  const into = exp - (lv - 1) * LEVEL_STEP;
  return { lv, into, step: LEVEL_STEP, toNext: LEVEL_STEP - into };
}

module.exports = {
  LEVEL_STEP, EXP_OF, ABILITIES,
  resolveHome, paths, levelFor, progressFor,
};
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add exp.cjs test/exp.test.cjs
git commit -m "feat(exp): 骨架、路徑解析、等級數學"
```

---

## Task 2: 時間工具與事件 log IO

**Files:**
- Modify: `exp.cjs`
- Test: `test/exp.test.cjs`

- [ ] **Step 1: 寫失敗測試**

追加到 `test/exp.test.cjs`：
```js
const fs = require('node:fs');
const os = require('node:os');

function tmpHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
  process.env.EXP_HOME = d;
  return d;
}

test('fmtTs: 格式 YYYY-MM-DD HH:MM:SS', () => {
  const s = exp.fmtTs(new Date(2026, 5, 1, 14, 3, 9)); // 月份 0-based → 6 月
  assert.equal(s, '2026-06-01 14:03:09');
});

test('appendEvent + readLog: 寫入後可讀回', () => {
  tmpHome();
  exp.ensureBase();
  exp.appendEvent({ ts: '2026-06-01 10:00:00', kind: 'task', reason: '修好 X', type: '除錯', dungeon: 'exp', exp: 100 });
  exp.appendEvent({ ts: '2026-06-01 11:00:00', kind: 'lesson', reason: '學到 Y', exp: 1 });
  const evs = exp.readLog();
  assert.equal(evs.length, 2);
  assert.equal(evs[0].reason, '修好 X');
  assert.equal(evs[1].kind, 'lesson');
});

test('readLog: 不存在時回空陣列', () => {
  tmpHome();
  assert.deepEqual(exp.readLog(), []);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test`
Expected: FAIL（`exp.fmtTs is not a function`）

- [ ] **Step 3: 寫最小實作**

在 `exp.cjs` 的 `module.exports` 之前加入：
```js
function pad(n) { return String(n).padStart(2, '0'); }
function fmtTs(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function now() { return fmtTs(new Date()); }

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
```

在 `module.exports` 中補上：`fmtTs, now, ensureBase, appendEvent, readLog,`

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add exp.cjs test/exp.test.cjs
git commit -m "feat(exp): 時間工具與事件 log IO"
```

---

## Task 3: computeState（kind 驅動的帳本計算）

**Files:**
- Modify: `exp.cjs`
- Test: `test/exp.test.cjs`

規則（由 `kind` 決定增量，金額取自 `EXP_OF` 常數 → 改金額後 rebuild 即生效）：
- `task`：global +100、ability[type] +100、dungeon +100
- `lesson`：global +1、ability[type] +1（若有 type）、dungeon +1（若有 dungeon）
- `facet`：**僅** dungeon +20，並把 reason 加入該 dungeon 的 facets；global/ability 不變
- `fail`：所有帳本皆不變

- [ ] **Step 1: 寫失敗測試**

```js
test('computeState: 各 kind 正確分配帳本', () => {
  const evs = [
    { ts: '2026-06-01 10:00:00', kind: 'task', reason: 'a', type: '除錯', dungeon: 'exp' },
    { ts: '2026-06-01 10:01:00', kind: 'task', reason: 'b', type: '實作', dungeon: 'exp' },
    { ts: '2026-06-01 10:02:00', kind: 'lesson', reason: 'c', type: '除錯', dungeon: 'exp' },
    { ts: '2026-06-01 10:03:00', kind: 'facet', reason: 'Arena 流程', dungeon: 'exp' },
    { ts: '2026-06-01 10:04:00', kind: 'fail', reason: '失敗', dungeon: 'exp' },
  ];
  const s = exp.computeState(evs);
  assert.equal(s.global.exp, 201);          // task100+100 + lesson1，facet/fail 不計
  assert.equal(s.abilities['除錯'].exp, 101); // task100 + lesson1
  assert.equal(s.abilities['實作'].exp, 100);
  assert.equal(s.dungeons['exp'].exp, 221);   // 100+100+1+20
  assert.deepEqual(s.dungeons['exp'].facets, ['Arena 流程']);
  assert.equal(s.updated, '2026-06-01 10:04:00');
});

test('computeState: 空 log → 初始 state', () => {
  const s = exp.computeState([]);
  assert.equal(s.global.exp, 0);
  assert.equal(s.abilities['架構'].exp, 0);
  assert.deepEqual(s.dungeons, {});
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test`
Expected: FAIL（`exp.computeState is not a function`）

- [ ] **Step 3: 寫最小實作**

```js
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
```

`module.exports` 補上：`applyEvent, computeState, writeState, readState,`

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add exp.cjs test/exp.test.cjs
git commit -m "feat(exp): computeState 帳本計算"
```

---

## Task 4: 日期解析與篩選

**Files:**
- Modify: `exp.cjs`
- Test: `test/exp.test.cjs`

`parseSince(spec, ref)` 回 `{ from, to }`（皆為 `YYYY-MM-DD HH:MM:SS` 字串，可字典序比較）：
- `今日`：from = ref 當天 00:00:00
- `本週`：from = 本週一 00:00:00（週一為週首）
- `本月`：from = 當月 1 號 00:00:00
- `YYYY-MM-DD`：from = 該日 00:00:00、to = 該日 23:59:59
- `YYYY-MM-DD..YYYY-MM-DD`：from/to 為兩端
- 其餘情形 to 預設 = ref 當下時間

- [ ] **Step 1: 寫失敗測試**

```js
test('parseSince: 今日', () => {
  const ref = new Date(2026, 5, 1, 14, 0, 0); // 週一
  const r = exp.parseSince('今日', ref);
  assert.equal(r.from, '2026-06-01 00:00:00');
});

test('parseSince: 本週（週一為首）', () => {
  const ref = new Date(2026, 5, 3, 9, 0, 0); // 2026-06-03 週三
  const r = exp.parseSince('本週', ref);
  assert.equal(r.from, '2026-06-01 00:00:00');
});

test('parseSince: 本月', () => {
  const ref = new Date(2026, 5, 17, 9, 0, 0);
  const r = exp.parseSince('本月', ref);
  assert.equal(r.from, '2026-06-01 00:00:00');
});

test('parseSince: 單日與區間', () => {
  const day = exp.parseSince('2026-05-20');
  assert.equal(day.from, '2026-05-20 00:00:00');
  assert.equal(day.to, '2026-05-20 23:59:59');
  const range = exp.parseSince('2026-05-01..2026-05-31');
  assert.equal(range.from, '2026-05-01 00:00:00');
  assert.equal(range.to, '2026-05-31 23:59:59');
});

test('filterEvents: 依 from/to 與欄位篩選', () => {
  const evs = [
    { ts: '2026-05-30 10:00:00', kind: 'task', type: '除錯', dungeon: 'A' },
    { ts: '2026-06-01 10:00:00', kind: 'task', type: '實作', dungeon: 'B' },
  ];
  assert.equal(exp.filterEvents(evs, { from: '2026-06-01 00:00:00' }).length, 1);
  assert.equal(exp.filterEvents(evs, { dungeon: 'A' }).length, 1);
  assert.equal(exp.filterEvents(evs, { type: '實作' }).length, 1);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test`
Expected: FAIL（`exp.parseSince is not a function`）

- [ ] **Step 3: 寫最小實作**

```js
function dayStart(d) { return `${fmtTs(d).slice(0, 10)} 00:00:00`; }
function dayEnd(s) { return `${s} 23:59:59`; }

function parseSince(spec, ref = new Date()) {
  const to = fmtTs(ref);
  if (spec === '今日') return { from: dayStart(ref), to };
  if (spec === '本月') {
    return { from: `${fmtTs(ref).slice(0, 7)}-01 00:00:00`, to };
  }
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
```

`module.exports` 補上：`parseSince, filterEvents,`

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add exp.cjs test/exp.test.cjs
git commit -m "feat(exp): 日期解析與事件篩選"
```

---

## Task 5: 渲染器（玩家面板 / 歷程 / 副本 / 能力 / 期間彙總）

**Files:**
- Modify: `exp.cjs`
- Test: `test/exp.test.cjs`

純函式，回傳 markdown 字串，**不寫檔**。

- [ ] **Step 1: 寫失敗測試**

```js
const SAMPLE = [
  { ts: '2026-06-01 14:23:00', kind: 'task', reason: '修好 Arena off-by-one', type: '除錯', dungeon: 'MobileAnime', exp: 100 },
  { ts: '2026-05-30 11:40:00', kind: 'facet', reason: 'Arena 戰鬥結算流程', dungeon: 'MobileAnime', exp: 20 },
  { ts: '2026-05-30 10:02:00', kind: 'fail', reason: 'A 方案失敗', type: '實作', dungeon: 'MobileAnime', exp: 0 },
];

test('renderStatus: 含主線等級與副本', () => {
  const md = exp.renderStatus(exp.computeState(SAMPLE));
  assert.match(md, /EXP 玩家面板/);
  assert.match(md, /主線/);
  assert.match(md, /MobileAnime/);
});

test('renderHistory: 一行一事件、含 +EXP 與失敗符號', () => {
  const md = exp.renderHistory(SAMPLE, {});
  assert.match(md, /\+100 .*修好 Arena off-by-one/);
  assert.match(md, /✗ .*A 方案失敗/);
});

test('renderHistory: limit 生效（取最近 N 筆）', () => {
  const md = exp.renderHistory(SAMPLE, { limit: 1 });
  const lines = md.trim().split('\n').filter((l) => /^\d{4}-/.test(l));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /修好 Arena/); // 最新一筆
});

test('renderDungeon: 含等級與探明面向', () => {
  const md = exp.renderDungeon(SAMPLE, exp.computeState(SAMPLE), 'MobileAnime');
  assert.match(md, /MobileAnime/);
  assert.match(md, /Arena 戰鬥結算流程/);
});

test('renderAbility: 列出各能力等級', () => {
  const md = exp.renderAbility(SAMPLE, exp.computeState(SAMPLE));
  assert.match(md, /除錯/);
});

test('renderReport: 期間彙總含計數', () => {
  const md = exp.renderReport(SAMPLE, { from: '2026-05-01 00:00:00', to: '2026-06-30 23:59:59' }, '本月');
  assert.match(md, /完成任務 1/);
  assert.match(md, /失敗 1/);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test`
Expected: FAIL（`exp.renderStatus is not a function`）

- [ ] **Step 3: 寫最小實作**

```js
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
  return filterEvents(events, f).slice(-limit).reverse();
}
function renderHistory(events, f = {}) {
  const rows = historyLines(events, f);
  let out = `# EXP 歷程`;
  const cond = [f.dungeon && `副本=${f.dungeon}`, f.type && `類型=${f.type}`, f.kind && `kind=${f.kind}`, f.since && `since=${f.since}`].filter(Boolean);
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
```

`module.exports` 補上：`renderStatus, renderHistory, renderDungeon, renderAbility, renderReport,`

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add exp.cjs test/exp.test.cjs
git commit -m "feat(exp): 報告渲染器"
```

---

## Task 6: 寫入指令 + dispatch + 副本名推導 + 近似名警告

**Files:**
- Modify: `exp.cjs`
- Test: `test/exp.test.cjs`

寫入指令（task/lesson/facet/fail）流程：解析參數 → `appendEvent` → 重算 state → `writeState` + 重繪 `STATUS.md` → stdout 印確認行。

- [ ] **Step 1: 寫失敗測試**

```js
const { execFileSync } = require('node:child_process');
const CLI = path.join(__dirname, '..', 'exp.cjs');
function run(args, home) {
  return execFileSync('node', [CLI, ...args], {
    env: { ...process.env, EXP_HOME: home }, encoding: 'utf8',
  });
}

test('CLI task: 寫入事件並回確認行', () => {
  const home = tmpHome();
  const out = run(['task', '修好登入 bug', '--type', '除錯', '--dungeon', 'demo'], home);
  assert.match(out, /✓ task \+100/);
  const evs = exp.readLog(exp.paths(home));
  assert.equal(evs.length, 1);
  assert.equal(evs[0].type, '除錯');
  assert.equal(evs[0].dungeon, 'demo');
  assert.ok(fs.existsSync(exp.paths(home).statusFile));
});

test('CLI lesson/fail: 正確 exp 與 kind', () => {
  const home = tmpHome();
  run(['lesson', '別忘了清快取', '--dungeon', 'demo'], home);
  run(['fail', '方案 A 行不通', '--dungeon', 'demo'], home);
  const evs = exp.readLog(exp.paths(home));
  assert.equal(evs[0].kind, 'lesson');
  assert.equal(evs[1].kind, 'fail');
  assert.equal(evs[1].exp, 0);
});

test('CLI facet: 副本為位置參數、+20', () => {
  const home = tmpHome();
  run(['facet', 'demo', 'Arena 流程'], home);
  const evs = exp.readLog(exp.paths(home));
  assert.equal(evs[0].kind, 'facet');
  assert.equal(evs[0].dungeon, 'demo');
  assert.equal(evs[0].reason, 'Arena 流程');
});

test('dungeonFromCwd: 取資料夾名', () => {
  assert.equal(exp.dungeonFromCwd('/a/b/MyProj'), 'MyProj');
});

test('nearDup: 偵測近似副本名', () => {
  assert.ok(exp.nearDup('MobileAnime', ['0.MobileAnime']));
  assert.ok(!exp.nearDup('MobileAnime', ['MobileAnime', 'Other']));
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test`
Expected: FAIL（CLI 無對應行為 / `exp.dungeonFromCwd is not a function`）

- [ ] **Step 3: 寫最小實作**

```js
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

function addEvent(kind, reason, { type, dungeon } = {}, p = paths()) {
  const ev = { ts: now(), kind, reason };
  if (type) ev.type = type;
  if (dungeon) ev.dungeon = dungeon;
  ev.exp = kind === 'fail' ? 0 : (EXP_OF[kind] ?? 0);
  if (dungeon) {
    const dup = nearDup(dungeon, Object.keys(readState(p).dungeons || {}));
    if (dup) process.stderr.write(`⚠ 副本「${dungeon}」近似既有「${dup}」，確認是否同一個\n`);
  }
  appendEvent(ev, p);
  const state = persist(p);
  const g = progressFor(state.global.exp);
  console.log(`✓ ${kind} ${ev.exp ? '+' + ev.exp : '✗'}｜主線 Lv${g.lv} (${state.global.exp})｜${reason}`);
}
```

- [ ] **Step 4: 寫最小 CLI dispatch（檔尾，`module.exports` 之後）**

```js
function main(argv) {
  const cmd = argv[0];
  const { pos, flags } = parseFlags(argv.slice(1));
  const dgn = () => flags.dungeon || dungeonFromCwd();
  switch (cmd) {
    case 'init': ensureBase(); persist(paths()); console.log('EXP 已初始化'); break;
    case 'task': addEvent('task', pos[0], { type: flags.type, dungeon: dgn() }); break;
    case 'lesson': addEvent('lesson', pos[0], { type: flags.type, dungeon: dgn() }); break;
    case 'fail': addEvent('fail', pos[0], { type: flags.type, dungeon: dgn() }); break;
    case 'facet': addEvent('facet', pos[1], { dungeon: pos[0] }); break;
    default: console.error(`未知指令：${cmd}（試試 help）`); process.exit(1);
  }
}
if (require.main === module) main(process.argv.slice(2));
```

`module.exports` 補上：`dungeonFromCwd, nearDup, parseFlags, addEvent, persist,`

- [ ] **Step 5: 跑測試確認通過**

Run: `node --test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add exp.cjs test/exp.test.cjs
git commit -m "feat(exp): 寫入指令、dispatch、副本推導與近似名警告"
```

---

## Task 7: 檢視指令（產報告檔 + 指標）、help、rebuild

**Files:**
- Modify: `exp.cjs`
- Test: `test/exp.test.cjs`

檢視指令一律寫報告檔、stdout 只回指標。檔名固定覆寫：`STATUS.md`、`views/history.md`、`views/dungeon-<名>.md`、`views/ability.md`、`views/report-<label>.md`。

- [ ] **Step 1: 寫失敗測試**

```js
test('CLI status: 產生 STATUS.md 並回指標', () => {
  const home = tmpHome();
  run(['task', 'x', '--type', '除錯', '--dungeon', 'demo'], home);
  const out = run(['status'], home);
  assert.match(out, /→ .*STATUS\.md/);
  assert.match(fs.readFileSync(exp.paths(home).statusFile, 'utf8'), /玩家面板/);
});

test('CLI history: 產生 views/history.md', () => {
  const home = tmpHome();
  run(['task', '修好 X', '--type', '除錯', '--dungeon', 'demo'], home);
  const out = run(['history'], home);
  assert.match(out, /→ .*history\.md/);
  assert.match(fs.readFileSync(path.join(exp.paths(home).viewsDir, 'history.md'), 'utf8'), /修好 X/);
});

test('CLI dungeon: 產生 views/dungeon-<名>.md', () => {
  const home = tmpHome();
  run(['facet', 'demo', 'Arena 流程'], home);
  const out = run(['dungeon', 'demo'], home);
  assert.match(out, /→ .*dungeon-demo\.md/);
  assert.match(fs.readFileSync(path.join(exp.paths(home).viewsDir, 'dungeon-demo.md'), 'utf8'), /Arena 流程/);
});

test('CLI report --since 本月: 產生報告檔', () => {
  const home = tmpHome();
  run(['task', 'x', '--type', '除錯', '--dungeon', 'demo'], home);
  const out = run(['report', '--since', '本月'], home);
  assert.match(out, /→ .*report-本月\.md/);
});

test('CLI help: stdout 列出指令', () => {
  const out = run(['help'], tmpHome());
  assert.match(out, /task/);
  assert.match(out, /history/);
  assert.match(out, /report/);
});

test('CLI rebuild: 從 log 重建 state', () => {
  const home = tmpHome();
  const p = exp.paths(home);
  exp.ensureBase(p);
  exp.appendEvent({ ts: '2026-06-01 10:00:00', kind: 'task', reason: 'x', type: '除錯', dungeon: 'demo', exp: 100 }, p);
  const out = run(['rebuild'], home);
  assert.match(out, /重建/);
  assert.equal(JSON.parse(fs.readFileSync(p.stateFile, 'utf8')).global.exp, 100);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test`
Expected: FAIL（status/history… 尚未實作）

- [ ] **Step 3: 寫最小實作（檢視輔助）**

在 `main` 之前加入：
```js
function writeView(p, file, content, summary) {
  ensureBase(p);
  const full = path.join(p.viewsDir, file);
  fs.writeFileSync(full, content);
  console.log(`→ views/${file}${summary ? '（' + summary + '）' : ''}`);
}

const HELP = `EXP 指令
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
  維運：rebuild ｜ init ｜ help
  類型：${ABILITIES.join(' / ')}`;
```

- [ ] **Step 4: 擴充 `main` 的 switch**

在 Task 6 的 `switch` 內、`default` 之前插入：
```js
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
      const p = paths(); const name = pos[0];
      writeView(p, `dungeon-${name}.md`, renderDungeon(readLog(p), computeState(readLog(p)), name));
      break;
    }
    case 'ability': {
      const p = paths();
      writeView(p, 'ability.md', renderAbility(readLog(p), computeState(readLog(p)), pos[0]));
      break;
    }
    case 'report': {
      const p = paths(); const label = flags.since || '期間';
      const range = parseSince(flags.since || '本月');
      writeView(p, `report-${label}.md`, renderReport(readLog(p), range, label));
      break;
    }
    case 'rebuild': {
      const p = paths(); const s = persist(p);
      console.log(`已從 log 重建 state（主線 EXP ${s.global.exp}）`);
      break;
    }
    case 'help': console.log(HELP); break;
```

`module.exports` 補上：`historyLines, writeView,`（供測試/重用）

- [ ] **Step 5: 跑測試確認通過**

Run: `node --test`
Expected: PASS（全部測試）

- [ ] **Step 6: Commit**

```bash
git add exp.cjs test/exp.test.cjs
git commit -m "feat(exp): 檢視指令、help、rebuild"
```

---

## Task 8: SKILL.md（自律規則 + 口語對照 + 品質規範）

**Files:**
- Create: `SKILL.md`

- [ ] **Step 1: 撰寫 SKILL.md**

```markdown
---
name: EXP
description: Agent 成長歷程系統。用 exp.cjs 記錄每輪工作（task/lesson/facet/fail）、依口語產生玩家面板與各式報告檔。Triggers：「檢視玩家面板」「show EXP status」「show EXP help」「看歷程」「週報」「看 X 副本」「能力分布」。
---

# EXP — Agent 成長歷程系統

腳本：`scripts/exp.cjs`（純 Node，零依賴）。資料在 `~/.claude/exp/`（可用 `EXP_HOME` 覆寫）。

## 最高原則：厚程式、薄 AI
所有計算/渲染由 exp.cjs 完成。AI 每輪只做：辨識意圖 → 發一條短指令 → 轉述一行指標。**禁止把報告檔內容讀進對話**；檢視結果一律請使用者自行開檔。

## 自律記錄（每輪結束依表現呼叫）
- `task`：使用者一個明確交付、且已做完並驗證 → `node scripts/exp.cjs task "<可讀成果句>" --type <類型> [--dungeon <副本>]`
- `lesson`：犯錯後修正並學到可複用教訓 → `node scripts/exp.cjs lesson "<教訓>"`
- `facet`：在某副本探明新面向 → `node scripts/exp.cjs facet <副本> "<面向>"`
- `fail`：嘗試失敗、未得可複用教訓，仍誠實留一筆 → `node scripts/exp.cjs fail "<失敗筆記>"`
- 事由品質：寫「做了什麼、結果如何」（例「修好 Arena 戰鬥結算 off-by-one」），禁止「修了東西」。
- 副本省略時程式自動取當前資料夾名；一資料夾＝一專案。
- 類型：除錯 / 架構 / 實作 / 重構 / 研究 / 工具 / 知識。

## 口語觸發對照（使用者口語 → 指令）
| 口語（中英夾雜皆認） | 指令 |
|----|----|
| 檢視玩家面板 / show EXP status / 現在幾級 | `status` |
| show EXP help / 有哪些指令 | `help` |
| 看歷程 / 我最近做了什麼 | `history [篩選]` |
| 本週做了什麼 / 週報 / 這個月幹了啥 | `report --since 本週\|本月` |
| 看 X 副本 / 這專案做過什麼 | `dungeon X` |
| 我哪方面強弱 / 能力分布 | `ability [類型]` |

除 `help` 外，檢視指令都會產報告檔；AI 只轉述 stdout 那行指標。
```

- [ ] **Step 2: 冒煙驗證腳本可跑**

Run: `node exp.cjs help`
Expected: 印出指令清單（含 task / history / report）

- [ ] **Step 3: Commit**

```bash
git add SKILL.md
git commit -m "docs(exp): SKILL.md 自律規則與口語對照"
```

---

## Task 9: 部署與最終驗證

**Files:**
- 部署目標：`~/.claude/skills/EXP/`（`SKILL.md` + `scripts/exp.cjs`）

- [ ] **Step 1: 全測試綠燈**

Run: `node --test`
Expected: 全部 PASS

- [ ] **Step 2: 端到端冒煙（用暫存 EXP_HOME，不污染真實資料）**

PowerShell：
```powershell
$env:EXP_HOME = Join-Path $env:TEMP 'exp-smoke'
node exp.cjs init
node exp.cjs task "完成 EXP 系統 v1" --type 實作 --dungeon exp
node exp.cjs facet exp "三系統正交模型"
node exp.cjs status
node exp.cjs report --since 本月
Remove-Item -Recurse -Force $env:EXP_HOME
Remove-Item Env:\EXP_HOME
```
Expected：每條寫入回 `✓`，status/report 回 `→ ...md` 指標，且檔案存在。

- [ ] **Step 3: 部署為全域 skill**

PowerShell：
```powershell
$dst = Join-Path $env:USERPROFILE '.claude\skills\EXP\scripts'
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item exp.cjs $dst
Copy-Item SKILL.md (Join-Path $env:USERPROFILE '.claude\skills\EXP\SKILL.md')
```

- [ ] **Step 4: 初始化真實全域資料並驗證 help**

Run: `node $env:USERPROFILE\.claude\skills\EXP\scripts\exp.cjs help`
Expected: 印出指令清單。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(exp): 部署腳本與最終驗證"
```

---

## Self-Review

**1. Spec coverage：**
- 三系統正交（等級/能力/副本）→ Task 3 computeState ✓
- 固定 500/級公式 → Task 1 levelFor ✓
- EXP 流向（task/lesson/facet/fail）→ Task 3 applyEvent ✓
- 7 類能力 → Task 1 ABILITIES ✓
- 副本=資料夾名、近似名警告 → Task 6 ✓
- log.jsonl 真相、state 由 log 算、rebuild → Task 2/3/7 ✓
- 可移植路徑 EXP_HOME → Task 1 resolveHome ✓
- 厚程式薄 AI / 檢視產報告檔只回指標 → Task 7 writeView ✓
- 指令集（status/history/dungeon/ability/report/help/rebuild）→ Task 7 ✓
- 口語對照、自律規則、品質規範 → Task 8 SKILL.md ✓
- 棄用 meritBook 忽略舊資料 → 不遷移（無對應任務即正確，全新資料夾）✓

**2. Placeholder scan：** 無 TBD/TODO；每步均含完整程式碼與指令。

**3. Type consistency：** `paths()`、`computeState`、`historyLines`、`renderX`、`addEvent`、`persist`、`parseSince/filterEvents` 簽名跨任務一致；事件欄位 `{ts,kind,reason,type?,dungeon?,exp}` 與 state 結構全程一致。
