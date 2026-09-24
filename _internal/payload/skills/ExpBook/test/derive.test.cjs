'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fx = require('./fixtures.cjs');
const exp = require('../scripts/exp.cjs');

test('buildEvent 帶 cwd 欄＝process.cwd()', () => {
  const ev = exp.buildEvent('task', '測試', {});
  assert.strictEqual(ev.cwd, process.cwd());
});

test('activeHours 只累加 gap<15 分的間隔', () => {
  const tsList = [0, 5*60000, 10*60000, 30*60000].map(Number); // 0→5(計)、5→10(計)、10→30(20分,不計)
  assert.strictEqual(Math.round(exp.activeHours(tsList) * 60), 10); // 10 分鐘
});

test('costOf 依 model 分項定價', () => {
  const byModel = { 'claude-opus-4-8': { input: 1e6, output: 0, cacheCreation: 0, cacheRead: 0 } };
  assert.strictEqual(exp.costOf(byModel), 5); // opus input $5/M × 1M
});

test('deriveMetrics 算出四分項/對話/打字/時間/成本', () => {
  const root = fx.tmpProjects([{ proj: 'p', file: 's.jsonl', lines: [
    fx.asstMsg('2026-06-01T10:00:00.000Z', 'claude-opus-4-8', { in: 1e6, out: 0, cc: 0, cr: 0 }),
    fx.userMsg('2026-06-01T10:01:00.000Z', 'hello world'),
  ] }]);
  try {
    const m = exp.deriveMetrics(exp.scanTranscripts(root), []);
    assert.strictEqual(m.billable, 1e6);
    assert.strictEqual(m.flows.input, 1e6);
    assert.strictEqual(m.conversations, 1);
    assert.strictEqual(m.typedChars, [...'hello world'].length);
    assert.strictEqual(m.costUSD, 5);
  } finally { fx.rm(root); }
});

test('classifyTier 依界線分級（per-day 5M/10M/30M/50M）', () => {
  assert.strictEqual(exp.classifyTier(3000000).tier, 'D');   // <5M
  assert.strictEqual(exp.classifyTier(7000000).tier, 'C');   // 5–10M
  assert.strictEqual(exp.classifyTier(20000000).tier, 'B');  // 10–30M
  assert.strictEqual(exp.classifyTier(40000000).tier, 'A');  // 30–50M
  assert.strictEqual(exp.classifyTier(60000000).tier, 'S');  // >50M
});

test('questsByDay：一天一委託、依日彙總分級、按日期排序、下限過濾', () => {
  const scan = { perDay: {
    '2026-06-09': 36000000, '2026-05-08': 3000000, '2026-06-01': 7000000,
    '2026-04-30': 50000,    // < 10 萬下限 → 不算委託，應被過濾
  } };
  const quests = exp.questsByDay(scan);
  assert.strictEqual(quests.length, 3);                                              // 下限日不計
  assert.deepStrictEqual(quests.map((q) => q.day), ['2026-05-08', '2026-06-01', '2026-06-09']); // 排序、無 04-30
  assert.deepStrictEqual(quests.map((q) => q.tier), ['D', 'C', 'A']);
  assert.strictEqual(quests[2].billable, 36000000);
});

test('commandLevel / slayLevel 線性除數公式（1-based，預設 Lv1）', () => {
  assert.strictEqual(exp.commandLevel(2333), 3);    // ⌊2333/1000⌋+1
  assert.strictEqual(exp.commandLevel(999), 1);     // 不足 1000 → 預設 Lv1（不浮灌）
  assert.strictEqual(exp.slayLevel(1758240), 2);    // ⌊1758240/1e6⌋+1（純打字 175.8 萬）
  assert.strictEqual(exp.slayLevel(999999), 1);     // 不足 100 萬字 → 預設 Lv1
  assert.strictEqual(exp.commandLevel(0), 1);       // 零輸入也是 Lv1
  assert.deepStrictEqual(exp.progressBy(2334, 1000), { lv: 3, into: 334, step: 1000, toNext: 666 });
});

test('computeStreak 連續活躍日 + 護符抵斷', () => {
  // 活躍日：06-01,06-02,06-03 連 3；隔一天 06-05（斷1天，護符抵）
  const mk = (d) => ({ ts: `2026-06-0${d} 10:00:00`, kind: 'task', reason: 'x' });
  const log = [1,2,3,5].map(mk);
  const r = exp.computeStreak(log, '2026-06-05');
  assert.strictEqual(r.current, 4);   // 06-01~03 + 護符補 06-04 + 06-05
  assert.strictEqual(r.longest >= 4, true);
});

test('deriveAchievements 寫 achievements.json + last_scanned_ts', () => {
  const home = fx.tmpHome();
  const root = fx.tmpProjects([{ proj: 'p', file: 's.jsonl', lines: [
    fx.asstMsg('2026-06-01T10:00:00.000Z', 'claude-opus-4-8', { in: 1000, out: 2000, cc: 0, cr: 0 }),
  ] }]);
  try {
    const p = exp.paths(home);
    const res = exp.deriveAchievements(p, { projectsRoot: root, log: [] });
    const fs = require('fs');
    const json = JSON.parse(fs.readFileSync(p.achievementsFile, 'utf8'));
    assert.strictEqual(json.derived.billable, 3000);
    assert.strictEqual(typeof json.last_scanned_ts, 'string');
    assert.strictEqual(json.derived.costUSD > 0, true);
  } finally { fx.rm(home); fx.rm(root); }
});

test('殺敵等級用純打字(扣code)，不含 code 字元', () => {
  const root = fx.tmpProjects([{ proj: 'p', file: 's.jsonl', lines: [
    // 一則純文字 + 一則含 code fence；殺敵應只算扣掉 fence 後的字元
    fx.userMsg('2026-06-01T10:00:00.000Z', 'x'.repeat(1000000)),          // 100 萬純文字 → 純打字 Lv1
    fx.userMsg('2026-06-01T10:01:00.000Z', '```\n' + 'y'.repeat(1000000) + '\n```'), // code fence，整段算 codeChars（含 code 總量會多 1 級）
  ] }]);
  try {
    const m = exp.deriveMetrics(exp.scanTranscripts(root), []);
    const pure = m.typedChars - m.codeChars;            // 純打字
    assert.strictEqual(m.slayLevel, exp.slayLevel(pure));
    // 且應低於用「含 code 總量」算出的等級（證明確實扣了 code）
    assert.strictEqual(m.slayLevel < exp.slayLevel(m.typedChars), true);
  } finally { fx.rm(root); }
});

test('scanTranscripts 彙總 token/對話/打字（排除 tool_result 與 < 開頭）', () => {
  const root = fx.tmpProjects([{ proj: 'projA', file: 's1.jsonl', lines: [
    fx.asstMsg('2026-06-01T10:00:00.000Z', 'claude-opus-4-8', { in: 100, out: 200, cc: 300, cr: 9000 }),
    fx.userMsg('2026-06-01T10:01:00.000Z', '幫我修這個 bug'),                 // 6 字，計入
    fx.userMsg('2026-06-01T10:02:00.000Z', '```js\nconst x=1;\n```'),          // code fence
    fx.toolResultMsg('2026-06-01T10:03:00.000Z'),                              // 排除
    fx.userMsg('2026-06-01T10:04:00.000Z', '<system-reminder>x</system-reminder>'), // < 開頭排除
  ] }]);
  try {
    const s = exp.scanTranscripts(root);
    assert.strictEqual(s.tok.input, 100);
    assert.strictEqual(s.tok.output, 200);
    assert.strictEqual(s.tok.cacheCreation, 300);
    assert.strictEqual(s.tok.cacheRead, 9000);
    assert.strictEqual(s.billable, 600);          // 100+200+300，排除 cr
    assert.strictEqual(s.userTurns, 2);           // bug 那則 + code fence 那則
    assert.strictEqual(s.codeChars > 0, true);
    assert.strictEqual([...'幫我修這個 bug'].length <= s.userChars, true);
    assert.strictEqual(s.byModel['claude-opus-4-8'].input, 100);
  } finally { fx.rm(root); }
});

test('scanTranscripts：subagents/ 下 token 照計、但不算使用者打字', () => {
  const root = fx.tmpProjects([
    { proj: 'p', file: 's1.jsonl', lines: [fx.userMsg('2026-06-01T10:00:00.000Z', 'abc')] },
    { proj: 'p/s1/subagents', file: 'agent-x.jsonl', lines: [fx.userMsg('2026-06-01T10:01:00.000Z', 'subagent prompt'), fx.asstMsg('2026-06-01T10:02:00.000Z', 'claude-opus-4-8', { in: 50 })] },
  ]);
  try {
    const s = exp.scanTranscripts(root);
    assert.strictEqual(s.userTurns, 1);
    assert.strictEqual(s.userChars, 3);
    assert.strictEqual(s.tok.input, 50);
  } finally { fx.rm(root); }
});

test('scanTranscripts 補單日對話/字數/單session時長聚合', () => {
  // session = 一個 transcript 檔。s1 同日跨 6hr → sessionSpans 6hr；s2 單筆 → 無 span。
  const root = fx.tmpProjects([
    { proj: 'p', file: 's1.jsonl', lines: [
      fx.asstMsg('2026-06-01T10:00:00.000Z', 'claude-opus-4-8', { in: 100, out: 0, cc: 0, cr: 0 }),
      fx.userMsg('2026-06-01T10:00:00.000Z', 'abcde'),
      fx.userMsg('2026-06-01T16:00:00.000Z', 'fghij'),
    ] },
    { proj: 'p', file: 's2.jsonl', lines: [
      fx.userMsg('2026-06-02T10:00:00.000Z', 'kl'),
    ] },
  ]);
  try {
    const s = exp.scanTranscripts(root);
    assert.strictEqual(s.perDayTurns['2026-06-01'], 2);
    assert.strictEqual(s.perDayTurns['2026-06-02'], 1);
    assert.strictEqual(s.perDayChars['2026-06-01'], 10);
    assert.strictEqual(s.sessionSpans.length, 1);                     // 只有 s1 有跨度
    assert.strictEqual(Math.round(s.sessionSpans[0] / 3600000), 6);   // 10:00→16:00 = 6hr
  } finally { fx.rm(root); }
});

test('deriveMetrics 補 PR/習慣聚合欄', () => {
  const root = fx.tmpProjects([{ proj: 'p', file: 's.jsonl', lines: [
    fx.asstMsg('2026-06-01T10:00:00.000Z', 'claude-opus-4-8', { in: 5e5, out: 0, cc: 0, cr: 0 }),
    fx.userMsg('2026-06-01T10:01:00.000Z', 'x'.repeat(120)),
  ] }]);
  try {
    const m = exp.deriveMetrics(exp.scanTranscripts(root), []);
    assert.strictEqual(m.maxDayToken, 5e5);
    assert.strictEqual(m.maxDayChars, 120);
    assert.strictEqual(m.maxDayConversations, 1);
    assert.strictEqual(typeof m.maxSessionHours, 'number');
    assert.strictEqual(typeof m.maxDayActiveHours, 'number');
    assert.strictEqual(m.maxQuestBillable, 5e5); // 單日 50 萬 ≥ 10 萬下限 → 形成委託
  } finally { fx.rm(root); }
});

test('computeStreak 日曆週語意：6 天大空缺無法靠護符跨越', () => {
  const mondays = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22'];
  const log = mondays.map((d) => ({ ts: `${d} 10:00:00`, kind: 'task', reason: 'x' }));
  const r = exp.computeStreak(log, '2026-06-22');
  assert.strictEqual(r.current, 1);
  assert.strictEqual(r.longest, 1);
});

test('computeStreak 跨週單日空缺可由該週護符補', () => {
  const log = [
    { ts: '2026-06-07 10:00:00', kind: 'task', reason: 'x' },
    { ts: '2026-06-09 10:00:00', kind: 'task', reason: 'x' },
  ];
  const r = exp.computeStreak(log, '2026-06-09');
  assert.strictEqual(r.current, 2);
});
