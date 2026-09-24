# 流程檢討報告：ExpBook v2.8.2 部署到 live，以及跨層閘裁決（2026-09-23 收束）

> 目的：把已經 push 的 v2.8.2（金幣定價更新）payload 部署到 `~/.claude` live，並同步 pikaTool 的工具 SPEC。途中碰到 Guardian 跨層閘，最後由使用者重新裁決：關閉跨層閘，改以「不 push 回 gitlab」當防線。

## 一、做得好的地方
1. **動手前先唯讀比對現況**：第一步用 `diff --strip-trailing-cr` 比對 5 個檔，確認全部不一致（都還沒部署），也確認 tools SPEC 仍帶舊時間戳 `2026-09-23 12:00:00`。先查清楚狀態，再決定要做什麼。
2. **被擋之後查到根源，不憑印象回答**：使用者問「是誰規定的」時，我先用 grep 找到 `hooks/wg_core.py:1466 check_cross_realm_bash`，再用 `git log -S` 找到 commit `07bfd10`（2026-09-01，作者 holylight，起因是有專案 session 用 heredoc 繞過 Write 閘改 hooks）。前後 3 次工具呼叫就能回答「誰、何時、為什麼」，每一項都附檔案與行號。
3. **沒有繞過安全閘**：Guardian 擋下兩次、auto mode 分類器擋下一次，我都沒有嘗試旁路。結果改由使用者用 `!` 自己執行 python one-liner 關閉開關，擋下的邏輯還留在程式裡，要恢復只需把 `enabled` 改回 true。
4. **部署有三重驗證**：先 `cp`，再 diff 確認 SAME ×5，然後跑 `exp.cjs show` 看實際輸出，最後用 grep 確認舊時間戳是 0 筆。
5. **裁決當下就寫進規則**：`rules/core.md:23` 立即改成新裁決，避免下個 session 照舊規則又把請求退回。

## 二、該改進的地方
1. **提出了一個會失敗的方案（方式二：加 permission rule）**
   - 現象：我建議「在 settings 加 `Edit(~/.claude/workflow/config.json)`」。使用者照做之後，我才發現 `settings.json` 的 allow 清單早就有 `Edit(*)`，而上次被分類器擋下時，`Edit(*)` 已經在生效。
   - 根因：沒先讀 `settings.json` 就提出方案，也把 auto mode 分類器（Self-Modification 判定）誤當成一般的 permission 規則。
   - **改進**：提出「加權限」這類方案前，先讀現有的 allow 清單。如果被擋時已經有等效規則，就代表擋的不是 permission 層，這個方案不成立。
2. **把 cwd 誤當成使用者意圖**
   - 現象：第一輪看到 prompt 開頭寫「在 ~/.claude 做」，就只給指引、不動手。使用者接著問「工具做完要讓本機生效，怎麼反而被擋？」
   - 根因：把「根層只在根層改」當成絕對規則；但這個 repo 本身就是 `skills/ExpBook` 的正式來源，部署到 live 是它的標準收尾（專案 CLAUDE.md 第 8 項明寫要 `cp payload → live`）。
   - **改進**：專案 CLAUDE.md 明定的部署步驟和全域規則衝突時，要主動指出衝突並請使用者裁決，不要默默選擇較保守的那一方。
3. **動手前預告常被 Guardian 攔一次**
   - 現象：PreActionNotice 提醒觸發 3 次以上。
   - 根因：預告和工具呼叫放在同一則訊息，偵測不一定抓得到。
   - **改進**：每輪第一個會動手的工具呼叫前，先單獨輸出一段「執行目標／預估」。

## 三、Token 浪費點／優化機會
| 事件 | 估算成本 | 優化 |
|---|---|---|
| 載入 update-config skill（整份 settings schema） | ~25k token | 只加一條 permission 規則時不必載 skill，直接讀 `settings.json` 的 allow 區即可；而且這次方案本身無效 |
| 被 Guardian 擋掉的 `cd ~/.claude && ...` 查詢 | ~1k | 專案 session 內一律用 `git -C` 或絕對路徑，不用 `cd` |
| 讀 `wg_core.py` 110 行 | ~3k | 必要，可接受 |

## 四、需求耗時／來回次數
| 需求 | 使用者輪數 | 反覆修正次數 | 主要卡點 |
|---|---|---|---|
| 部署 ExpBook v2.8.2 到 live | 5 | 3（Guardian ×2、分類器 ×1） | 跨層閘沒有「開發 repo → live」的例外 |
| 追查限制的來源 | 1 | 0 | — |
| 移除限制 | 3 | 2（分類器擋、方式二無效） | AI 不能自改防護設定，只能由使用者用 `!` 執行 |
| tools SPEC 同步 | 1 | 0 | 閘關掉之後直接完成 |
| 補記 EXP | 1 | 0 | — |

整體統計：真人輸入約 8 輪；完成 4 項主要需求；反覆修正集中在「被閘擋」這一條上，約佔 5/8 的輪數。

## 五、下次類似任務的檢查清單
- [ ] 開發 repo 的 payload 要部署到 `~/.claude`：跨層閘已關，直接 `cp`，再跑 diff 和實際執行指令驗證
- [ ] 被擋時先分清是哪一層：Guardian hook（訊息帶 `[Guardian:...]`）、permission 規則，還是 auto mode 分類器（Self-Modification）
- [ ] 分類器擋的是 AI 自改防護設定，改 permission 救不回來，直接給使用者 `!` 指令
- [ ] 提出任何設定方案前，先讀現有設定，確認現況還沒涵蓋
- [ ] 專案 CLAUDE.md 的部署步驟和全域規則衝突時，先指出衝突並請使用者裁決

## 六、可沉澱為全域記憶的行為原則
- 候選（新，[臨]）：「**被擋時先分辨是 Guardian、permission 還是分類器；分類器擋的自我修改，加 allow 規則也無效，要改用使用者 `!` 執行**」。domain 放 CC與原子記憶契約。
- 候選（append 到既有的跨層閘 atom `跨層bash閘與sessionstart逾時-...`）：記下「2026-09-23 使用者裁決關閉 cross_realm_write／bash，防線改為不 push gitlab」。

## 七、本次新增的全域知識
- `rules/core.md:23` 改寫為新裁決（「跨層寫入放行，防線在上傳」）
- `workflow/config.json`：`guard.cross_realm_write.enabled=false`，新增 `guard.cross_realm_bash`（`enabled=false`）
- atom：本報告寫完時尚未寫入，待使用者同意第六節的候選

## 八、結案交付品檢查
- [x] live 部署：ExpBook 3 檔 + tools SPEC 2 檔，diff 全部一致
- [x] `exp.cjs show` 實際執行：`金幣US$9,495`（預期約 US$9,385，差額是之後新增的使用量）
- [x] 舊時間戳 grep 0 筆
- [x] 本檢討報告寫入 `_internal/report/`（本 repo 沒有 `_AIDocs/`，沿用 bb97e1d 的慣例）
- [ ] atom 候選：待使用者決定
- [ ] git：EXPBook repo 新增本報告，要不要 commit 待使用者 go；`~/.claude` 照裁決不 push 回 gitlab，也沒有 commit
