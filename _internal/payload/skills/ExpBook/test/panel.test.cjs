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

const LEVEL_STEP = exp.LEVEL_STEP; // 冒險者每級門檻
function stateAt(lv) { return { global: { exp: (lv - 1) * LEVEL_STEP }, dungeons: {}, skills: {} }; }
const D = { elitePoints: 5000, commandLevel: 22, slayLevel: 51, totalProcessed: 5.01e9, billable: 2.04e8, costUSD: 3990 };

test('renderPanelLine：精英不顯示（已移為 feature），等級行只有 冒險者/指揮/殺敵', () => {
  const line = exp.renderPanelLine(stateAt(18), D);
  assert.match(line, /\[等級\] 冒險者18 指揮22 殺敵51/);
  assert.doesNotMatch(line, /精英/);                       // 任何等級都不顯示精英
  assert.match(line, /\[消耗\] 魔力50\.1億\(有效2\.04億\) 金幣\$3,990/);
});

test('renderPanelLine：LV50 後仍不顯示精英', () => {
  const line = exp.renderPanelLine(stateAt(50), D);
  assert.doesNotMatch(line, /精英/);
});

test('renderFuelDashboard：委託/四分項人話/書本/時間/代價齊備', () => {
  const d = {
    tierCount: { D: 54, C: 60, B: 58, A: 35, S: 24 }, elitePoints: 1234,
    flows: { input: 7.2e6, output: 2.82e7, cacheCreation: 1.685e8, cacheRead: 4.806e9 },
    billable: 2.04e8, totalProcessed: 5.01e9, costUSD: 3990,
    conversations: 2129, typedChars: 1502000, codePct: 0.28, activeHours: 116.6,
  };
  const out = exp.renderFuelDashboard(d);
  assert.match(out, /委託討伐.*D54 C60 B58 A35 S24/s);
  assert.match(out, /精英分 1234/);
  assert.match(out, /輸入/);
  assert.match(out, /AI寫出/);
  assert.match(out, /首次建快取/);
  assert.match(out, /重複讀歷史/);
  // 書本：2.04e8 × 0.7 / 1e5 = 1428 本
  assert.match(out, /約 1,?428 本/);
  assert.match(out, /116\.6\s*hr/);
  assert.match(out, /對話 2129/);
  assert.match(out, /150\.2萬字.*28%/s); // typedChars 含 code，標 code%
});

const fs = require('fs');
const os = require('os');
const path = require('path');

test('renderStatus 無 derived → 不含面板/儀表板（向後相容）', () => {
  const out = exp.renderStatus(stateAt(18)); // 不傳 derived
  assert.doesNotMatch(out, /\[等級\]/);
  assert.doesNotMatch(out, /燃料儀表板/);
  assert.match(out, /冒險者　LV18/); // 舊三層輸出仍在
});

test('renderStatus 有 derived → 疊一行面板 + 燃料儀表板', () => {
  const out = exp.renderStatus(stateAt(18), {
    elitePoints: 0, commandLevel: 22, slayLevel: 51, totalProcessed: 5.01e9, billable: 2.04e8, costUSD: 3990,
    tierCount: { D: 1, C: 0, B: 0, A: 0, S: 0 }, flows: { input: 1, output: 1, cacheCreation: 1, cacheRead: 1 },
    conversations: 2129, typedChars: 2082000, codePct: 0.28, activeHours: 116.6,
  });
  assert.match(out, /\[等級\] 冒險者18 指揮22 殺敵51/);
  assert.match(out, /燃料儀表板/);
});

test('renderStatus 投入軸詳列：指揮/殺敵 同款 LV/進度/Total 行', () => {
  const out = exp.renderStatus(stateAt(18), {
    elitePoints: 0, commandLevel: 3, slayLevel: 2, totalProcessed: 5e9, billable: 2e8, costUSD: 4000,
    tierCount: { D: 0, C: 0, B: 0, A: 0, S: 0 }, flows: { input: 1, output: 1, cacheCreation: 1, cacheRead: 1 },
    conversations: 2334, typedChars: 2442000, codeChars: 683760,
  });
  assert.match(out, /指揮　　LV3 \(334\/1000\) Total:2334 次對話/);        // ⌊2334/1000⌋+1=3，當級 334
  assert.match(out, /殺敵　　LV2 \(75\.8萬字\/100\.0萬字\) Total:175\.8萬字（純打字）/); // 純打字 1,758,240 → +1=2
});

test('readDerived：讀 achievements.json 的 derived；缺檔回 null', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'expbook-rd-'));
  try {
    const p = exp.paths(home);
    assert.strictEqual(exp.readDerived(p), null);             // 缺檔
    fs.mkdirSync(path.dirname(p.achievementsFile), { recursive: true });
    fs.writeFileSync(p.achievementsFile, JSON.stringify({ version: 'v2.5', derived: { commandLevel: 7 } }));
    assert.strictEqual(exp.readDerived(p).commandLevel, 7);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
