---
name: ExpBook
description: Agent 成長歷程系統（ExpBook）。用 exp.cjs 記錄每輪工作（task/lesson/facet/fail）、依口語產生玩家面板與各式報告檔。EXP 為經驗值單位、ExpBook 為系統名。Triggers：「檢視玩家面板」「show ExpBook status」「ExpBook help」「看歷程」「週報」「看 X 副本」「能力分布」。
---

# ExpBook — Agent 成長歷程系統

腳本：`scripts/exp.cjs`（純 Node，零依賴）。資料在 `~/.claude/expbook/`（可用 `EXPBOOK_HOME` 覆寫）。
（命名：**ExpBook = 系統名**；**EXP = 經驗值單位**。對話一律稱 ExpBook，避免單講「exp」與其他項目混淆。）

## 最高原則：厚程式、薄 AI
所有計算/渲染由 exp.cjs 完成。AI 每輪只做：辨識意圖 → 發一條短指令 → 轉述一行指標。**禁止把報告檔內容讀進對話**；檢視結果一律請使用者自行開檔。

## 自律記錄（A+C 機制：AI 判斷 → Stop hook 沖刷）
回合中判斷該記時，用 **stage 暫存**（語意由我判斷）；**Stop hook 每輪結束自動 flush** 進 log，不需手動 flush。
- task：明確交付、做完並驗證 → `node scripts/exp.cjs stage --kind task "<可讀成果句>" --type <類型> [--dungeon <副本>]`
- lesson：犯錯修正並學到可複用教訓 → `node scripts/exp.cjs stage --kind lesson "<教訓>" [--type ..]`
- facet：在某副本探明新面向 → `node scripts/exp.cjs stage --kind facet "<面向>" --dungeon <副本>`
- fail：嘗試失敗、未得教訓，仍誠實留一筆 → `node scripts/exp.cjs stage --kind fail "<失敗筆記>"`
- 也可直接 `task/lesson/facet/fail`（立即落 log，不經 stage），兩種皆可。
- 事由品質：寫「做了什麼、結果如何」（例「修好 Arena 戰鬥結算 off-by-one」），禁止「修了東西」。
- 副本省略時程式自動取當前資料夾名；一資料夾＝一專案。
- 類型：除錯 / 架構 / 實作 / 重構 / 研究 / 工具 / 知識。
- **安全網**：Stop hook 偵測到「有新 commit 但本輪沒記」會在下一輪提醒；看到提醒請補 stage。

## 口語觸發對照（使用者口語 → 指令）
| 口語（中英夾雜皆認） | 指令 |
|----|----|
| 檢視玩家面板 / show ExpBook status / 現在幾級 | `status` |
| ExpBook help / 有哪些指令 | `help` |
| 看歷程 / 我最近做了什麼 | `history [篩選]` |
| 本週做了什麼 / 週報 / 這個月幹了啥 | `report --since 本週\|本月` |
| 看 X 副本 / 這專案做過什麼 | `dungeon X` |
| 我哪方面強弱 / 能力分布 | `ability [類型]` |

除 `help` 外，檢視指令都會產報告檔；AI 只轉述 stdout 那行指標。
