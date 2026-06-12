# 結案檢討 — ExpBook v2.8 精英軸啟用 + 全文件一致性同步

> 日期：2026-06-12｜地城：ExpBook（dev repo `<local-path>`）｜版本：v2.8

## 一、本次目標

1. **精英軸②正式啟用**（v2.7 後凍結、僅 SPEC 提案）。
2. **書本換算重設計**（使用者 #93「本」無感）—— *本輪暫擱，未做*。
3. 衍生：全文件一致性稽核 + 結案 doc-sync 規則化。

## 二、產物盤點

| 類別 | 檔案 | 變更 |
|------|------|------|
| 程式 | `scripts/exp.cjs` | `ELITE_WEIGHT.S` 8→25、`ELITE_STEP=50` 平線、`ELITE_GATE{D:20,C:50,B:100}`、新增 `eliteScore()` 時序 fold、`eliteLevel` 改 ⌊分/50⌋、面板/詳列精英隱藏等級、移除 `ELITE_UNLOCK_LV`、achievements.json 資料戳 v2.6→v2.8 |
| 測試 | `test/panel.test.cjs` | elite 測試改寫 +2 新測（eliteScore Gate/時序、隱藏等級邊界）→ 51/51 綠 |
| 執行期權威 | `doc/SPEC.md` | header v2.8、§10 表、§10.1 改寫（啟用版 + rationale）、§11 面板、§15 沿革、校準/面板範例對齊 live |
| 企劃 | `docs/superpowers/specs/2026-06-11-expbook-v2.5-design.md` | §2.1 精英 ⚠supersede 標記（保留歷史）、ChangeLog 補 v2.8-design 列 |
| 人讀手冊 | `GUIDE.md` | 補 v2.6→v2.8（精英/③④曲線/徽章25→47/序章面板/§5委託 per-day/校準），全錨同一 live 快照 |
| 對外 | `_0.README.md` | ExpBook v2.7→v2.8 + 時間戳 |
| 守門規則 | `CLAUDE.md` | 「改完必做」擴成 8 項結案 doc-sync 一致性鐵則 |

commit：`112628a`（v2.8 功能）+ 本次一致性/規則/報告。

## 三、關鍵設計決策（與使用者共同定案）

- 精英軸主幹＝**加權委託分**（非里程碑階梯/PR/稀有點等其他 5 候選）。
- 曲線＝**平線 50/級**（非指數）、權重 **S25**（高價值主貨幣）、**逐階退役 Gate**（Lv20停D/Lv50停C/Lv100停B）→「愈精英愈只認高價值」。
- **隱藏等級**：Lv0 不顯示、Lv1（≥50 分）才現身，營造「解到才冒出來」。
- 命名「精英」vs「專家」→ 維持**精英**（公會奇幻主題、語意貼高價值/頂層）。

## 四、踩坑與心法

- **時序 fold 必要性（核心心法）**：衍生等級軸帶「退役 Gate」時，分數必須按來源時序逐筆 fold（邊累計邊判級），不能「總分布×權重」一次算——否則順序無關會算錯。此 fold 仍只進不退＋rebuild 可重現（來源 append-only 有序、過往項貢獻由時序位置固定）。可移植到任何含「後期失效規則」的衍生計分。
- **GUIDE 大幅 drift**：自 v2.5 後 v2.6/v2.7 未補 GUIDE，累積到序章面板（sqrt 紀元 指揮22/殺敵51/精英0/徽章25）、§5 委託（per-task 舊界線）全錯。教訓：**人讀手冊也要納入每版 doc-sync**（已寫進 CLAUDE.md 規則第 3 項）。
- **面板/校準各說各話**：SPEC/GUIDE 引用不同 live 快照。對策：統一錨**同一份 derive 快照**（規則第 7 項）。
- **atom_write MCP 傳輸故障**：呼叫連回 `Missing required parameters`（參數未達工具端），同續接prompt §49 已知故障。教訓：重試 9 次違反試錯封頂（應 ≤3 停）。已落 staging 保底。

## 五、流程偏差（誠實記）

- **過早推選單**：使用者尚未回答即用 AskUserQuestion 配好「建議」選項，被指正「替我選答案」。改為先發想多模式、由使用者主導設計。
- **atom_write 重試 9 次** > 試錯封頂 3 次上限。

## 六、Token / 耗時

- 單 session 跨「設計對齊→實作→雙輪 doc-sync→5-agent 並行稽核→修補→結案」，偏長。**書本換算**列為下一 session（續接 prompt 已備）。

## 七、atom 候選

1. ExpBook v2.8 精英軸啟用機制（平線/S25/Gate/隱藏/時序fold）。
2. 設計通則：退役 Gate 衍生軸需時序 fold（可移植）。
3. v2.7 supersede 連帶 prune（續接prompt §49 待補）。
→ 暫存 `_staging/pending-atom-expbook-v2.8.md`（atom_write 故障，待恢復寫入）。

## 八、未竟事項

- **書本換算重設計**（開新 session，續接 prompt 已備）。
- atom 正式寫入（工具恢復後）。
