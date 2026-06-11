'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const exp = require('../scripts/exp.cjs');
const fs = require('fs');
const fx = require('./fixtures.cjs');

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

test('deriveAchievements 合併：unlocked 只進不退、records 取 max、回傳 _newly', () => {
  const home = fx.tmpHome();
  const root = fx.tmpProjects([{ proj: 'p', file: 's.jsonl', lines: [
    fx.asstMsg('2026-06-01T10:00:00.000Z', 'claude-opus-4-8', { in: 1000, out: 2000, cc: 0, cr: 0 }),
    fx.userMsg('2026-06-01T10:01:00.000Z', 'hello'),
  ] }]);
  try {
    const p = exp.paths(home);
    const log = [{ ts: '2026-06-01 10:00:00', kind: 'task', reason: '完成首個有意義的委託' }];
    const r1 = exp.deriveAchievements(p, { projectsRoot: root, log });
    assert.ok(r1._newly.includes('first_task'));
    const j1 = JSON.parse(fs.readFileSync(p.achievementsFile, 'utf8'));
    assert.ok(j1.unlocked.first_task);
    assert.ok(!('_newly' in j1));
    const r2 = exp.deriveAchievements(p, { projectsRoot: root, log });
    assert.ok(!r2._newly.includes('first_task'));
    const j2 = JSON.parse(fs.readFileSync(p.achievementsFile, 'utf8'));
    assert.strictEqual(j2.unlocked.first_task, j1.unlocked.first_task);
    assert.ok(j2.records);
  } finally { fx.rm(home); fx.rm(root); }
});

test('pickEasterEgg 優先序：連擊 > 里程碑 > 暴擊 > 寶箱 > 稀有', () => {
  const rngNo = () => 0.99;
  let egg = {};
  assert.match(exp.pickEasterEgg({ streak: { current: 7 }, totalProcessed: 0 }, egg, [], '2026-06-11', rngNo), /連戰 7/);
  egg = {};
  const l1 = exp.pickEasterEgg({ streak: { current: 1 }, totalProcessed: 2.4e8 }, egg, [], '2026-06-11', rngNo);
  assert.match(l1, /跨越 2 億/);
  assert.strictEqual(egg.lastYi, 2);
  const l2 = exp.pickEasterEgg({ streak: { current: 1 }, totalProcessed: 2.4e8 }, egg, [['單委託最大', 9]], '2026-06-11', rngNo);
  assert.match(l2, /暴擊/);
  const egg2 = { lastYi: 99 };
  const box = exp.pickEasterEgg({ streak: { current: 1 }, totalProcessed: 0 }, egg2, [], '2026-06-11', rngNo);
  assert.match(box, /寶箱/);
  assert.strictEqual(egg2.lastDay, '2026-06-11');
  const none = exp.pickEasterEgg({ streak: { current: 1 }, totalProcessed: 0 }, egg2, [], '2026-06-11', rngNo);
  assert.strictEqual(none, '');
});

test('pickEasterEgg 稀有遭遇：rng<0.03 命中純台詞', () => {
  const egg = { lastDay: '2026-06-11', lastYi: 99 };
  const line = exp.pickEasterEgg({ streak: { current: 1 }, totalProcessed: 0 }, egg, [], '2026-06-11', () => 0.01);
  assert.ok(exp.RARE_LINES.includes(line));
});

test('renderStatus 疊稱號/徽章/PR；無 ach 維持 Plan2 輸出', () => {
  const LEVEL_STEP = exp.LEVEL_STEP;
  const st = { global: { exp: 17 * LEVEL_STEP }, dungeons: {}, skills: {}, updated: '2026-06-11 12:00:00' };
  const derived = { elitePoints: 0, commandLevel: 22, slayLevel: 51, totalProcessed: 5e9, billable: 2e8, costUSD: 3990,
    tierCount: { D: 1, C: 0, B: 0, A: 0, S: 0 }, flows: { input: 1, output: 1, cacheCreation: 1, cacheRead: 1 },
    conversations: 2129, typedChars: 2082000, codePct: 0.28, activeHours: 116.6, streak: { current: 3, longest: 9 } };
  const ach = { unlocked: { cmd_50: '2026-06-03 10:00:00', first_task: '2026-06-01 10:00:00', burn_3k_secret: '2026-06-05 10:00:00' },
    records: { maxDayToken: 1.75e7, maxDayChars: 8000, maxQuest: 1.7e7, longestStreak: 9 }, titlePin: null };
  const out = exp.renderStatus(st, derived, ach);
  assert.match(out, /冒險者　LV18〈沙場宿將〉/);
  assert.match(out, /🏅 徽章（3\//);
  assert.match(out, /你知道燒了多少嗎\(SR\)✓/);
  assert.match(out, /🏆 個人紀錄/);
  const plain = exp.renderStatus(st, derived);
  assert.doesNotMatch(plain, /🏅 徽章/);
  assert.doesNotMatch(plain, /〈/);
});

test('renderBadges：隱藏徽章未解鎖不顯示', () => {
  const out = exp.renderBadges({ unlocked: { first_task: '2026-06-01 10:00:00' }, records: {} });
  assert.match(out, /初試啼聲\(N\)✓/);
  assert.doesNotMatch(out, /你知道燒了多少嗎/);
});
