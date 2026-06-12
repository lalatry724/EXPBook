# 流程檢討報告 — ExpBook v2.7 徽章再設計（2026-06-12 收束）

> 目的：v2.6 把等級制度改深（指揮÷1000、殺敵÷100萬字）後，B 投入 4 枚 level 門檻徽章永久鎖死；本輪重定徽章門檻 + 大擴充（25→47 枚八類）+ 三軸試算表 + 精英重設計提案。

## 一、做得好的地方

1. **權威文件鏈先行（守門人鐵則）**：動碼前依 CLAUDE.md 順序讀 SPEC §10/§12.1/§13 + exp.cjs ACHIEVEMENTS/buildBadgeContext + design §3.1，沒憑記憶改。直接定位到「徽章錨等級數字 vs 大除數」的根本矛盾。
2. **真實數據驅動門檻**：先跑 `derive` 抓 live 真值（對話2357／純打字180萬／有效2.36億／成本$4581／委託D10C7B8A1S0／藏書1655本），所有高階門檻錨在真值**之上**做梯度 → 杜絕灌水（守哲學第 4 柱）。例：iron_will 500hr（live 126）、library_5k（live ~1660）、talk_50k（live 2357）。
3. **決策前置一次問清**：用 AskUserQuestion 一批問完 4 個設計分歧（門檻重錨法/豐富度/精英方向/試算表格式），避免逐題往返耗 turn，符合使用者「決策支援＝綜觀+條列+建議」偏好。
4. **規格變更同步改測試斷言（非遷就）**：count 25→47、巨龍門檻、deriveTitle/renderStatus 引用的退役 id，全部更新斷言對齊新規格，並補 B/G/H/prune 新覆蓋 → 49/49 綠。
5. **退避當場修補**：Guardian 抓到「非本次引入」退避語後，誠實評估 prune 修補成本（2 行）即當場修，沒擱置。

## 二、該改進的地方（誠實列出本輪實際踩的坑）

1. **退役 id 殘留一度想「揭露但不修」**（最大教訓）
   - 現象：live achievements.json 殘留 cmd_10/slay_25/slay_50（已無徽章定義的死 id），初版選擇「告知使用者、不擅動」。
   - 根因：把「只進不退」過度套用到**死 id**上——只進不退是保護**合法已得徽章**，死 id（無定義）是純資料垃圾，兩者混為一談；且用「非本次引入」當擱置藉口。
   - **改進**：1-3 行能修的當場修（feedback-rigor-standards）。prune 只刪無 ACHIEVEMENTS 定義的孤兒、不碰合法 id（first_s/s_hunter_10 保留）→ 不違反只進不退。已加防迴歸測試。

2. **dev-repo 與 live 資料源差異一度誤判**
   - 現象：dev-repo expbook 無 log.jsonl（taskCount=0），first_task 未解鎖，差點以為徽章邏輯有問題。
   - 根因：dev-repo 只有 transcript 衍生指標、無 EXP log 事件；live(~/.claude) 才有真實 LV9 log。
   - **改進**：驗徽章解鎖要分清「transcript-derived（對話/token）」vs「log-derived（task/lesson）」兩類資料源，跨 repo 驗證時先確認哪個 home 有完整 log。

## 三、Token 浪費點 / 優化機會

1. **derive 連跑 3 次驗證**（dev-repo ×2 + live ×1）≈ 每次 stdout ~5 行、成本低，但可合併：一次 cp 後 live derive 即足夠。優化：改碼→測試綠→cp→live derive 一條鏈，省掉 dev-repo 中途 derive。
2. **整體 token 控制良好**：單一續接任務、🟢L1，無反覆讀同檔（buildBadgeContext/ACHIEVEMENTS 一次讀全）、無失敗重試。無明顯浪費點。

## 四、需求耗時 / 來回次數（瓶頸分析）

| 需求 | 使用者輪數 | 反覆修正次數 | 主要卡點 |
|------|---------|----------|---------|
| 徽章門檻重錨 + 47 枚大擴充 | 1（核可後一次實作） | 0 | 無——設計前置問清 |
| ctx 欄澄清 | 1（使用者問「這是什麼意思」） | 0 | 機制需白話解釋，非實作問題 |
| 退役 id prune | 1（Guardian 攔截後補修） | 1（退避→當場修） | 只進不退語意邊界 |
| 試算表/SPEC/design 同步 | 0（隨實作完成） | 0 | 無 |

整體統計：有效 user turn 約 4；主要交付 6 項（徽章碼/測試/SPEC/試算表/design/prune）全完成；反覆修正佔比低（僅 prune 1 次，因退避非技術錯）。判讀：本輪卡點不在技術而在**行為紀律**（退避），已由 Guardian 即時校正。

## 五、下次類似任務的檢查清單（actionable）

- [ ] 改「衍生指標門檻」前先跑 derive 抓 live 真值，門檻錨真值之上做梯度（防灌水）
- [ ] supersede 舊 id 時，同步在衍生引擎加 prune（刪無定義孤兒），並加防迴歸測試
- [ ] 「只進不退」只保護合法已得徽章；死 id（無定義）是資料垃圾、該清
- [ ] 1-3 行能修的當場修，禁用「非本次/留給未來」擱置（feedback-rigor-standards）
- [ ] 跨 repo 驗徽章：先確認哪個 home 有完整 log；transcript-derived vs log-derived 分清
- [ ] 改 ACHIEVEMENTS/門檻 → 測試斷言同步改（規格變更非遷就測試）→ payload cp 到 live 才生效

## 六、可沉澱為全域記憶的行為原則（建議晉升 atom）

- 「supersede 衍生 id 要連帶在引擎加 prune 清孤兒；只進不退只護合法徽章、不護死 id」—— 新候選，可 append 到 [[expbook-agent-成長歷程系統]]（專案層知識，SPEC §13 已是權威，atom 僅作觸發索引）。
- 「衍生計分門檻一律錨 live 真實值之上做梯度，防灌水」—— 已是 ExpBook 哲學鐵則（CLAUDE.md），不需新 atom。
- 行為紀律（退避→當場修）已由既有 [[cognitive-patterns]] / feedback-rigor-standards 覆蓋，本次為命中驗證、不新增。

## 七、本次新增的全域知識

- **未新增獨立 atom**（待使用者裁決是否 append expbook atom 一行 v2.7 現況）。
- 文件更新：
  - `doc/SPEC.md` — §13 徽章八類表、§15 沿革 v2.7、§10.1 精英重設計提案
  - `docs/superpowers/specs/2026-06-11-expbook-v2.5-design.md` — ChangeLog v2.7-design supersede
  - `_internal/report/level-calc-2026-06-12.md` — 三軸等級試算表（新檔）
  - 本報告 `_internal/report/retrospective_2026-06-12-expbook-v2.7.md`

## 八、結案交付品檢查（deliverables checklist）

- [x] 程式：`exp.cjs` ACHIEVEMENTS 47 枚 + buildBadgeContext 10 新 ctx 欄 + prune + BOOK_EQUIV
- [x] 測試：`badges.test.cjs` 49/49 綠（含 supersede/B-raw/G/H/prune 覆蓋）
- [x] 規格同步：SPEC §13/§15/§10.1、design ChangeLog
- [x] 試算表：`level-calc-2026-06-12.md`
- [x] 本檢討報告已寫入 `_internal/report/`
- [x] live 同步：`~/.claude/skills/ExpBook/{scripts/exp.cjs, doc/SPEC.md}` 已 cp + re-derive 驗證（孤兒已清、17 枚正規解鎖）
- [ ] atom 寫入（待使用者裁決，預設可省——SPEC 已權威）
- [ ] git: 秘密洩漏檢查 → add → commit（Repo A only，Repo B 永久 skip）→ push（待 go/no-go）
- [ ] `workflow_signal: sync_completed`（git 後發）
