# 流程檢討報告 — ExpBook v2.8.3 純修 bug（2026-09-24 收束）

> 目的：依 2026-09-23 全盤檢討（`audit_2026-09-23_expbook-v3-review.md` §6）修 11 項「不需設計裁決」的 bug，讓文件與程式先一致、測試先全綠，再進 v3.0 設計。三階段計畫的第 1 階段。

## 一、做得好的地方

1. **改前改後對照，抓到續接檔指示的副作用**：第 7 項照字面「walk 跳過 `subagents/` 目錄」，派工前先用副本跑 `derive` 改前/改後對照，發現計費等效 3.03 億→2.70 億、成本 US$9,493→8,956（少算 US$537 的真實花費）。改成 `inSub` 旗標（token 照計、只不計對話/打字）後成本回到 US$9,493，對話 2,190→2,093、純打字 −32.4 萬字，符合預期。
2. **所有 exp.cjs 驗證都在 `EXPBOOK_HOME` 副本上跑**（eb1–eb4），live 的 achievements/state/STATUS 全程沒被驗證動作污染。
3. **PRICING 接檔前先驗結構、後測壞檔**：json 欄位（in/out/cw/cw1h/cr）可 1:1 對映才接；另用假 HOME 放壞檔，實測 stderr 有告警且 fallback 值正確（Opus 5.5 input 1M = $4）。沒有靜默降級。
4. **行號先複驗再動手**：續接檔標註「行號可能漂移」，實際 exp.cjs 因 PRICING loader 而位移 14 行；SPEC/GUIDE 一律用 grep 定位而非信行號。
5. **鐵則 7 快照統一並自我更正**：發現移除重複入帳後 live 變成 80(807/1000)，文件範例還是移除前的 81(7/1000)，當場重取快照並同步 SPEC + GUIDE（4 處）再重新部署。
6. **done-gate 11 項全部附證據、100 分**。

## 二、該改進的地方（實際踩的坑）

1. **sed 處理含反斜線／`$` 的 JS regex 斷言 → 語法錯誤，連修 3 輪**
   - 現象：panel.test.cjs 的 `/冒險者18\(0\/1000\)/` 被 sed 吃掉跳脫字元，測試檔語法錯（4 fail → 1 fail 檔案級錯誤 → 再 1 fail → 綠）。
   - 根因：Windows Git Bash 下 sed 的替換字串跳脫規則與 JS regex 字面量互相干擾，我沒先單點實驗就批次替換 6 行。
   - **改進**：含正則／`$`／反斜線的行一律用 Edit 或 python（`PYTHONIOENCODING=utf-8`），不用 sed。
2. **python print 中文在 cp950 主控台崩潰，GUIDE 寫入被中斷**
   - 現象：`UnicodeEncodeError` 發生在 print 之後、`open(...).write` 之前，SPEC 已寫、GUIDE 未寫，狀態不一致；差點誤以為兩檔都改好（後續 grep 才看出來）。
   - 根因：script 內 print 了含中文的 debug 輸出。
   - **改進**：patch script 不 print 中文，只用 `assert` + 結尾統一 `print(OK)`；改完必 grep 反向驗證。
3. **取快照早於「會改變快照的動作」**
   - 現象：先取 live 快照寫進文件，之後才移除重複入帳（−200 EXP），快照過期，多做一輪更新。
   - 根因：續接檔順序是先文件、後第 10 項（需使用者確認），我沒意識到第 10 項會動 EXP。
   - **改進**：會動 log 的操作（remove/rebuild）排在「取快照寫文件」之前；或文件範例標註快照時間，不追求與 live 即時相等。
4. **兩次漏「動手前預告」被 PreActionNotice 擋下**
   - 現象：第一個 Bash 呼叫前沒輸出「執行目標／預估」，被 hook 暫擋 2 次才補。
   - 根因：/continue 回讀完直接連發工具；沒把預告當每回合第一件事。
   - **改進**：每回合第一個工具呼叫之前先輸出兩行預告。
5. **刪除 `~/.claude` 內殘檔被分類器擋下，且整包指令（含 README 同步）一起被擋，連帶一個純 grep 也被擋**
   - 現象：`rm` 被判「Irreversible Local Destruction」，同一批的其他步驟沒執行；下一個無害 grep 也被同因擋下，之後才恢復。
   - 根因：續接檔授權刪檔是上一 session 的意圖，本 session 分類器不採信；我把刪除與其他步驟混在同一指令。
   - **改進**：破壞性指令單獨一個呼叫；被擋就立即停手回報並交使用者決定（本次照做，使用者回「刪」後單獨執行成功）。
6. **「第 1 筆」語意有歧義（列表首列 17:44 vs 時間較早的 17:43）**
   - 我依「我列出的第一筆」解讀為 17:44 並在回覆中標明，刪前備份 log 到 scratchpad。實際影響很小（兩筆同事由 +200），但應在單獨確認時用時間戳而非序號。

## 三、Token 浪費點 / 優化機會

| 事件 | 估算成本 | 優化 |
|------|---------|------|
| `cat STATUS.md` 全檔（含 ~200 行未分類技能） | ≈ 6–8k | 只需面板首段，用 `head -20` 或 `show` |
| 完整讀 GUIDE.md（360 行）與 SPEC 後半（~230 行） | ≈ 15k | 改動點已知，可 grep 定位後只讀該段 |
| 3 輪 panel 測試修復（sed 失敗重跑） | ≈ 3k | 見第二節 1，直接用 Edit |
| derive 對照跑 3 次（改前/改後/inSub 版） | 每次 ~1k 輸出 | 必要，價值對等 |

## 四、需求耗時 / 來回次數

| 需求 | 使用者輪數 | 反覆修正 | 主要卡點 |
|------|-----------|---------|---------|
| 1–4 SPEC/GUIDE/SKILL/README 對齊 | 0 | 1（快照過期重取） | 快照順序 |
| 5 panel 測試修復 | 0 | 3 | sed 跳脫 |
| 6 closeout 路徑 | 0 | 0 | — |
| 7 subagent 過濾 + 死碼 | 0 | 1（整目錄跳過 → inSub） | 續接檔指示有副作用 |
| 8 weekIndex 註解 | 0 | 0 | — |
| 9 刪殘檔 | 2 | 1 | 分類器擋 |
| 10 重複入帳 | 1 | 0 | 需使用者確認 |
| 11 PRICING | 0 | 0 | — |

整體：使用者輪數 3（選階段 1／放行刪檔＋確認重複／無其他），主要功能 11/11，反覆修正 ≥2 的只有第 5 項。

## 五、下次類似任務的檢查清單

- [ ] 改含正則／`$`／反斜線的行 → Edit 或 python，不用 sed
- [ ] patch script 不 print 中文；改完 grep 反向驗證「舊字串 count=0」
- [ ] 統計／掃描類過濾，先問「這筆資料代表花費還是使用者行為」，改前後各跑一次對照再決定過濾層級
- [ ] 會改 log/state 的動作（remove、rebuild）排在「取快照寫文件」之前
- [ ] 每回合第一個工具呼叫前先輸出「執行目標／預估」
- [ ] 破壞性指令（rm）單獨一個 Bash 呼叫，不與其他步驟串接
- [ ] 需使用者確認的選項用時間戳指代，不用「第 N 筆」

## 六、可沉澱為全域記憶的行為原則（建議）

- 「Windows Git Bash 下 sed 改 JS 正則字面量會吃跳脫字元」→ 候選併入 `OS-Windows` 範疇既有 atom（append，[臨]）；夠通用但需再命中一次才值得晉升。
- 「統計過濾要分清花費與使用者行為兩種語意」→ 屬 ExpBook 專案知識，已落 SPEC §12.3 與 §15 v2.8.3 列，**不另寫 atom**。
- 其餘（預告、rm 單獨呼叫）已有 IDENTITY 契約涵蓋，不重複寫。

## 七、本次新增的全域知識

- 本 session **未寫入 atom**（候選待使用者同意；見第六節）。
- 更新的專案文件：`doc/SPEC.md`（v2.8.3）、`GUIDE.md`、`SKILL.md`、`_0.README.md`；~/.claude 內：`skills/closeout/{SKILL,SPEC}.md`、`expbook/backups/README.md`。

## 八、結案交付品檢查

- [x] 程式／規格／GUIDE／SKILL／README 四方一致；version-check DRIFT 0
- [x] `node --test test/*.test.cjs` 51/51 綠
- [x] payload → live 已部署（exp.cjs、SKILL.md、GUIDE.md），hooks 兩檔與 payload 一致
- [x] 本檢討報告已寫入 `_internal/report/`（本專案無 `_AIDocs/`）
- [ ] design 檔：rationale 未變，不動（CLAUDE.md 規定「才變才動」）
- [ ] git：**等使用者「上GIT」口令**才 add/commit/push（含 audit 與兩份 retrospective 未追蹤報告）
- [ ] 上 GIT 後：把 commit hash 與測試數填進 `next-phase-expbook-2-v30-design-spec.md` 的【已完成】區
- 已知遺留：`~/.claude/expbook/` 本身有獨立 `.git`（本階段未動）；Stop hook 只呼叫 `flushPending` 不跑 derive 等問題屬 v3 設計範圍（audit F5/F6）。
