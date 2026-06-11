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
