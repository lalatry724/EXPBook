'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const exp = require('../scripts/exp.cjs');

function D(over = {}) {
  return Object.assign({
    billable: 0, totalProcessed: 0, costUSD: 0, commandLevel: 0, slayLevel: 0,
    tierCount: { D: 0, C: 0, B: 0, A: 0, S: 0 }, maxQuestBillable: 0,
    maxDayConversations: 0, maxDayActiveHours: 0, maxSessionHours: 0,
    streak: { current: 0, longest: 0 },
  }, over);
}
const ST = { global: { exp: 0 }, dungeons: {}, skills: {} };

test('ACHIEVEMENTS 共 25 枚、id 不重複、稀有度合法', () => {
  assert.strictEqual(exp.ACHIEVEMENTS.length, 25);
  const ids = new Set(exp.ACHIEVEMENTS.map((b) => b.id));
  assert.strictEqual(ids.size, 25);
  for (const b of exp.ACHIEVEMENTS) assert.ok(exp.RARITY_RANK[b.rarity], `bad rarity ${b.rarity}`);
});

test('A 戰績：task 門檻 1/100/1000/10000', () => {
  const log = Array.from({ length: 100 }, () => ({ ts: '2026-06-01 12:00:00', kind: 'task', reason: '完成一個有意義的委託' }));
  const got = exp.evalBadges(exp.buildBadgeContext(ST, log, D()));
  assert.ok(got.includes('first_task'));
  assert.ok(got.includes('veteran_100'));
  assert.ok(!got.includes('master_1000'));
});

test('C 委託：全階通吃需 D~S 各≥1；巨龍需單委託 > 1e7', () => {
  const ctx = exp.buildBadgeContext(ST, [], D({ tierCount: { D: 1, C: 1, B: 1, A: 1, S: 1 }, maxQuestBillable: 2e7 }));
  const got = exp.evalBadges(ctx);
  assert.ok(got.includes('all_tiers'));
  assert.ok(got.includes('first_s'));
  assert.ok(got.includes('dragon_slayer'));
});

test('D 代價：成本門檻 + 隱藏 $3000', () => {
  const got = exp.evalBadges(exp.buildBadgeContext(ST, [], D({ billable: 1.5e8, costUSD: 3500 })));
  assert.ok(got.includes('mage_yi'));
  assert.ok(got.includes('burn_1k'));
  assert.ok(got.includes('burn_3k_secret'));
  assert.ok(!got.includes('burn_5k'));
});

test('E 習慣：時段由 task ts 推；不眠/馬拉松由 derived', () => {
  const log = [
    { ts: '2026-06-06 03:00:00', kind: 'task', reason: '深夜趕工的委託' },
  ];
  const got = exp.evalBadges(exp.buildBadgeContext(ST, log, D({ maxDayActiveHours: 13, maxSessionHours: 7 })));
  assert.ok(got.includes('night_mage'));
  assert.ok(got.includes('weekend_warrior'));
  assert.ok(got.includes('sleepless'));
  assert.ok(got.includes('marathon'));
  assert.ok(!got.includes('morning_adv'));
});

test('F 幽默：浴火重生(連3敗後task)／惜字如金(<10字)／手滑(regress≥3)', () => {
  const log = [
    { ts: '2026-06-01 10:00:00', kind: 'fail', reason: 'a' },
    { ts: '2026-06-01 10:01:00', kind: 'fail', reason: 'b' },
    { ts: '2026-06-01 10:02:00', kind: 'fail', reason: 'c' },
    { ts: '2026-06-01 10:03:00', kind: 'task', reason: '短' },
    { ts: '2026-06-01 10:04:00', kind: 'regress', reason: 'r1' },
    { ts: '2026-06-01 10:05:00', kind: 'regress', reason: 'r2' },
    { ts: '2026-06-01 10:06:00', kind: 'regress', reason: 'r3' },
  ];
  const got = exp.evalBadges(exp.buildBadgeContext(ST, log, D()));
  assert.ok(got.includes('phoenix'));
  assert.ok(got.includes('terse'));
  assert.ok(got.includes('butterfinger'));
});
