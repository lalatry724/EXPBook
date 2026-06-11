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

test('deriveTitle：最高稀有度優先，同稀用最新 ts；pin 覆寫', () => {
  const unlocked = { first_task: '2026-06-01 10:00:00', slay_25: '2026-06-02 10:00:00', cmd_50: '2026-06-03 10:00:00' };
  assert.strictEqual(exp.deriveTitle(unlocked, null), '沙場宿將');
  assert.strictEqual(exp.deriveTitle(unlocked, '自訂頭銜'), '自訂頭銜');
  assert.strictEqual(exp.deriveTitle({}, null), null);
});

test('deriveTitle：同稀有度取最新解鎖', () => {
  const unlocked = { slay_25: '2026-06-01 10:00:00', night_mage: '2026-06-05 10:00:00' };
  assert.strictEqual(exp.deriveTitle(unlocked, null), '夜術士');
});

test('mergeRecords 取 max；recordPRs 回傳刷新項', () => {
  const prev = { maxDayToken: 100, maxDayChars: 50, maxQuest: 0, longestStreak: 3 };
  const d = { maxDayToken: 80, maxDayChars: 90, maxQuestBillable: 2e7, streak: { current: 1, longest: 5 } };
  const merged = exp.mergeRecords(prev, d);
  assert.strictEqual(merged.maxDayToken, 100);
  assert.strictEqual(merged.maxDayChars, 90);
  assert.strictEqual(merged.maxQuest, 2e7);
  assert.strictEqual(merged.longestStreak, 5);
  const prs = exp.recordPRs(prev, merged);
  const keys = prs.map((x) => x[0]);
  assert.ok(keys.includes('單日最多字'));
  assert.ok(keys.includes('單委託最大'));
  assert.ok(keys.includes('最長連戰'));
  assert.ok(!keys.includes('單日最高 token'));
});

test('renderPanelLine 接 🔥streak（longest>current 顯示 PR）', () => {
  const LEVEL_STEP = exp.LEVEL_STEP;
  const stateAt = (lv) => ({ global: { exp: (lv - 1) * LEVEL_STEP }, dungeons: {}, skills: {} });
  const base = { elitePoints: 0, commandLevel: 22, slayLevel: 51, totalProcessed: 5e9, billable: 2e8, costUSD: 3990 };
  const withStreak = exp.renderPanelLine(stateAt(18), Object.assign({}, base, { streak: { current: 5, longest: 9 } }));
  assert.match(withStreak, /🔥5\(PR9\)/);
  const noPR = exp.renderPanelLine(stateAt(18), Object.assign({}, base, { streak: { current: 9, longest: 9 } }));
  assert.match(noPR, /🔥9(?!\(PR)/);
  const noStreak = exp.renderPanelLine(stateAt(18), base);
  assert.doesNotMatch(noStreak, /🔥/);
});
