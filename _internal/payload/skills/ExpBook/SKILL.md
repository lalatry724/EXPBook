---
name: ExpBook
description: Agent 成長歷程系統（ExpBook，冒險者公會制）。用 exp.cjs 記錄每輪工作（任務/心法/練功/敗戰/常錯）、依口語產生玩家面板與報告檔。EXP 為經驗值、ExpBook 為系統名。Triggers：「檢視玩家面板」「show ExpBook status」「ExpBook help」「看歷程」「週報」「看 X 地城」「看 X 技能」。
---

# ExpBook — Agent 成長歷程系統（冒險者公會制）

腳本：`scripts/exp.cjs`（純 Node，零依賴）。資料在所屬 CLI home 的 `expbook/` 下（由 `exp.cjs:resolveHome()` 從 `__dirname` 推導：Claude→`~/.claude/expbook/`、gemini→`~/.gemini/expbook/`；可用 `EXPBOOK_HOME` 覆寫）。完整規格：`doc/SPEC.md`。
（命名：**ExpBook = 系統名**；**EXP = 經驗值單位**。對話一律稱 ExpBook。）

## 最高原則：厚程式、薄 AI
所有計算/渲染由 exp.cjs 完成。AI 每輪只做：辨識意圖 → 發一條短指令 → 轉述一行指標。**禁止把報告檔內容讀進對話**；檢視結果一律請使用者自行開檔。

## 模型：冒險者等級 + 地城 + 技能（用意：看見成長歷程，不打考績）
門檻 **1000 EXP/級**。每筆經歷帶 1 個地城（必）＋ 0..N 個技能（選），**冒險者等級 + 該地城 + 各技能 同時 +EXP**。

- **冒險者等級（All）**：所有經歷累積＝你的總成長。
- **地城（專案熟練度）**：每筆必帶；跨專案累積。未指明 → 預設「**日常訓練(雜項)**」。一資料夾＝一地城。
- **技能（能力）**：每筆選填、**可多項**（`--skill 除錯,架構`）。預設 7 技能恆顯示：除錯/架構/實作/重構/研究/工具/知識；**可自由新增其他技能 tag**。

### 5 種 kind（正分階梯、只進不退）
| kind | 名 | EXP | 何時記 |
|------|----|-----|--------|
| task | 任務 | +200 | 明確交付、做完並驗證的一個版本 |
| lesson | 心法 | +20 | 犯錯修正後學到的可複用新心得（禁灌水/複述舊的） |
| chore | 練功 | +1 | 有做事但不構成交付：調查/跑指令/搬檔/部分進度（日常心跳） |
| fail | 敗戰 | +1 | 試了沒成、死路、未得心得（新傷） |
| regress | 常錯 | +1 | 重犯**已知**錯（舊傷復發） |

**互斥判斷**：有可用產出→練功；死路沒產出→敗戰；死路且重犯已知錯→常錯。
**敗戰 vs 常錯＝「這錯以前犯過嗎？」** 沒有→敗戰；有（已記錄過 / Guardian 標 same_file_3x·retry_escalation / 同輪糾正後復發）→常錯。

## 自律記錄（A+C 機制：AI 判斷 → Stop hook 沖刷）
回合中判斷該記時，用 **stage 暫存**；**Stop hook 每輪結束自動 flush** 進 log。
- `node scripts/exp.cjs stage --kind <task|lesson|chore|fail|regress> "<可讀事由>" [--dungeon <地城>] [--skill <技能,..>]`
- 也可直接用 `task/lesson/chore/fail/regress`（立即落 log，不經 stage）。
- **事由品質（詳細，禁摘要）**：reason 要讓未來回溯能還原當時情境，**不可一兩句帶過**。至少涵蓋：① 具體做了什麼（逐項，非「修了東西」）② 涉及檔案／模組／函式 ③ 結果如何（成功／失敗／部署狀態；有 commit 附 hash）④ 為何而做（觸發原因／需求背景，非顯而易見時）。禁止籠統摘要（「修好 bug」「調整介面」「更新程式」）。
  - 好例：「修好 Arena 戰鬥結算 off-by-one：結算 hp 多扣 1（damage.lua:42 floor→round），改回後 E2E smoke 3 場通過，commit a1b2c3」
  - 壞例：「修好 Arena bug」
- 屬於某專案的工作務必加 `--dungeon <專案>`；該練的能力加 `--skill`（可多項）。
- **安全網**：Stop hook 偵測到「有新 commit 但本輪沒記」會在下一輪提醒；看到提醒請補 stage。

## 口語觸發對照（使用者口語 → 指令）
| 口語（中英夾雜皆認） | 指令 |
|----|----|
| 檢視玩家面板 / show ExpBook status / 現在幾級 | `status` |
| ExpBook help / 有哪些指令 | `help` |
| 看歷程 / 我最近做了什麼 | `history [篩選]` |
| 這輪加了什麼 EXP / 剛剛為什麼加分 | `lastflush` |
| 本週做了什麼 / 週報 / 這個月幹了啥 | `report --since 本週\|本月` |
| 看 X 地城 / 這專案做過什麼 | `dungeon X` |
| 看 X 技能 / 我這能力練多少 | `skill X` |

除 `help`、`lastflush` 外，檢視指令都會產報告檔；AI 只轉述 stdout 那行指標。

## EXP 增減透明 + 可調整
- **入帳當下可見**：`stage` 回顯 `✎ staged 心法 (+20 EXP)｜事由`；`flush` 印「本輪 EXP 入帳」明細（每筆 `+Δ [kind] (地城) {技能} 事由` + 總和）並寫入 `~/.claude/expbook/_last_flush.txt`（Claude）／`~/.gemini/expbook/_last_flush.txt`（gemini），隨腳本所在 CLI home。
- **隨時回查本輪入帳**：`lastflush`（讀 `_last_flush.txt`，列出剛剛什麼原因加了多少）。
- **調整每種 kind 的 EXP 數值**：建 `~/.claude/expbook/config.json`（Claude）／`~/.gemini/expbook/config.json`（gemini），例 `{"exp_of":{"task":150,"lesson":30}}`。**只影響之後新事件**——歷史事件把當時 EXP 存進 `e.exp`，改 rate 不回溯竄改。
- **校正/回退某筆 EXP**：`remove --last｜--ts "<時間戳>"｜--match "<事由片段>"`（移除後自動重算 state）。
> Stop hook 的 flush 是靜默的（hook stdout 不露出）；要「看見」入帳，靠 `stage` 回顯（AI 轉達）或 `lastflush` 主動查。
