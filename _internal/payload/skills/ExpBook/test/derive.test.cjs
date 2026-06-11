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

test('classifyTier 依界線分級', () => {
  assert.strictEqual(exp.classifyTier(100000).tier, 'D');
  assert.strictEqual(exp.classifyTier(200000).tier, 'C');
  assert.strictEqual(exp.classifyTier(2000000).tier, 'S');
});

test('questsByTaskInterval 區間歸屬 + 跨 session 合併', () => {
  const t1 = exp.fmtTs(new Date(Date.UTC(2026,5,1,10,0,0)));
  const t2 = exp.fmtTs(new Date(Date.UTC(2026,5,1,12,0,0)));
  const log = [
    { ts: t1, kind: 'task', reason: '委託一' },
    { ts: t2, kind: 'task', reason: '委託二' },
  ];
  const scan = { messages: [
    { ts: Date.UTC(2026,5,1,9,30,0),  billable: 50000 },   // → 委託一（≤t1）
    { ts: Date.UTC(2026,5,1,11,0,0),  billable: 200000 },  // → 委託二（t1<..≤t2）
    { ts: Date.UTC(2026,5,1,13,0,0),  billable: 999 },     // → t2 之後，無 task，不形成委託
  ] };
  const quests = exp.questsByTaskInterval(scan, log);
  assert.strictEqual(quests.length, 2);
  assert.strictEqual(quests[0].billable, 50000);
  assert.strictEqual(quests[0].tier, 'D');
  assert.strictEqual(quests[1].billable, 200000);
  assert.strictEqual(quests[1].tier, 'C');
});

test('commandLevel / slayLevel 平方根公式', () => {
  assert.strictEqual(exp.commandLevel(2129), 23); // ⌊√(2129/4)⌋ = ⌊23.07⌋
  assert.strictEqual(exp.slayLevel(1502000), 50); // ⌊√(1502000/600)⌋ = ⌊50.03⌋
  assert.strictEqual(exp.commandLevel(0), 0);
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
    fx.userMsg('2026-06-01T10:00:00.000Z', 'x'.repeat(600 * 9)),          // 5400 純文字字元
    fx.userMsg('2026-06-01T10:01:00.000Z', '```\n' + 'y'.repeat(600 * 16) + '\n```'), // code fence，整段算 codeChars
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
    assert.strictEqual(s.messages.length >= 1, true); // 至少 assistant 那筆有 billable
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
    assert.strictEqual(m.maxQuestBillable, 0);
  } finally { fx.rm(root); }
});
