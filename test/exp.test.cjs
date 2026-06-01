'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const exp = require('../exp.cjs');

const CLI = path.join(__dirname, '..', 'exp.cjs');
function tmpHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
  process.env.EXP_HOME = d;
  return d;
}
function run(args, home) {
  return execFileSync('node', [CLI, ...args], {
    env: { ...process.env, EXP_HOME: home }, encoding: 'utf8',
  });
}

// ---- Task 1 ----
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

// ---- Task 2 ----
test('fmtTs: 格式 YYYY-MM-DD HH:MM:SS', () => {
  const s = exp.fmtTs(new Date(2026, 5, 1, 14, 3, 9));
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

// ---- Task 3 ----
test('computeState: 各 kind 正確分配帳本', () => {
  const evs = [
    { ts: '2026-06-01 10:00:00', kind: 'task', reason: 'a', type: '除錯', dungeon: 'exp' },
    { ts: '2026-06-01 10:01:00', kind: 'task', reason: 'b', type: '實作', dungeon: 'exp' },
    { ts: '2026-06-01 10:02:00', kind: 'lesson', reason: 'c', type: '除錯', dungeon: 'exp' },
    { ts: '2026-06-01 10:03:00', kind: 'facet', reason: 'Arena 流程', dungeon: 'exp' },
    { ts: '2026-06-01 10:04:00', kind: 'fail', reason: '失敗', dungeon: 'exp' },
  ];
  const s = exp.computeState(evs);
  assert.equal(s.global.exp, 201);
  assert.equal(s.abilities['除錯'].exp, 101);
  assert.equal(s.abilities['實作'].exp, 100);
  assert.equal(s.dungeons['exp'].exp, 221);
  assert.deepEqual(s.dungeons['exp'].facets, ['Arena 流程']);
  assert.equal(s.updated, '2026-06-01 10:04:00');
});
test('computeState: 空 log → 初始 state', () => {
  const s = exp.computeState([]);
  assert.equal(s.global.exp, 0);
  assert.equal(s.abilities['架構'].exp, 0);
  assert.deepEqual(s.dungeons, {});
});

// ---- Task 4 ----
test('parseSince: 今日', () => {
  const ref = new Date(2026, 5, 1, 14, 0, 0);
  assert.equal(exp.parseSince('今日', ref).from, '2026-06-01 00:00:00');
});
test('parseSince: 本週（週一為首）', () => {
  const ref = new Date(2026, 5, 3, 9, 0, 0);
  assert.equal(exp.parseSince('本週', ref).from, '2026-06-01 00:00:00');
});
test('parseSince: 本月', () => {
  const ref = new Date(2026, 5, 17, 9, 0, 0);
  assert.equal(exp.parseSince('本月', ref).from, '2026-06-01 00:00:00');
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

// ---- Task 5 ----
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
  assert.match(lines[0], /修好 Arena/);
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

// ---- Task 6 ----
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

// ---- Task 7 ----
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
