'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const exp = require('../scripts/exp.cjs');

test('fmtYi：token → 億（1 億=100M），可指定小數位', () => {
  assert.strictEqual(exp.fmtYi(5.01e9, 1), '50.1億');  // 總處理量
  assert.strictEqual(exp.fmtYi(2.04e8, 2), '2.04億');  // 有效（計費等效）
  assert.strictEqual(exp.fmtYi(0, 1), '0.0億');
});

test('fmtWan：字元 → 萬字（1 位小數）', () => {
  assert.strictEqual(exp.fmtWan(1502000), '150.2萬字');
  assert.strictEqual(exp.fmtWan(0), '0.0萬字');
});

test('fmtUSD：四捨五入 + 千分位', () => {
  assert.strictEqual(exp.fmtUSD(3990.4), '$3,990');
  assert.strictEqual(exp.fmtUSD(0), '$0');
});

test('eliteLevel：累進門檻 cost(n)=round(500×1.2^(n-1))', () => {
  assert.strictEqual(exp.eliteLevel(0), 0);
  assert.strictEqual(exp.eliteLevel(499), 0);     // 未達 Lv1 門檻 500
  assert.strictEqual(exp.eliteLevel(500), 1);     // 累 500 = Lv1
  assert.strictEqual(exp.eliteLevel(1099), 1);    // 未達 Lv2 累 1100
  assert.strictEqual(exp.eliteLevel(1100), 2);    // 累 1100 = Lv2（500+600）
  assert.strictEqual(exp.eliteLevel(4318), 5);    // design §2.1 表：Lv5 累 4,318
});
