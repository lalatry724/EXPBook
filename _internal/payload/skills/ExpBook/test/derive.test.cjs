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
