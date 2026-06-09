# Retrospective — ExpBook v2.4（技能分類 · 面板分組小計）

> 日期：2026-06-09　｜　範疇：ExpBook 資料家遷移 + 技能分類功能
> 本 session 起於「查 ExpBook 資料存哪 / 為何 C:\AI 下有 expbook」，連帶清掉 junction、釐清資料架構，最後落到 v2.4 技能分類交付。

## 1. 交付產物盤點

| 類別 | 檔案 | 異動 |
|------|------|------|
| 程式 | `_internal/payload/skills/ExpBook/scripts/exp.cjs` | 加 `SKILL_GROUPS` 分類表 + `categorizeSkills()` + `lvLineAt()`；`renderStatus` 技能段改分組渲染 |
| 規格 | `_internal/payload/skills/ExpBook/doc/SPEC.md` | 新增 §2.1 技能分類 + header v2.3→v2.4 + §9 沿革列 |
| README | `_0.README.md` | ExpBook 列 v2.3→v2.4；工具表上方加「版號＝SPEC 複本」來歷註記 |
| 中央 changelog | `_internal/docs/_CHANGELOG.md` | 新增 ExpBook v2.4 條目 |
| live 同步 | `~/.claude/skills/ExpBook/{scripts/exp.cjs,doc/SPEC.md}` | 由 payload copy 單檔同步，diff 0 |
| atom | `expbook-agent-成長歷程系統`（global） | append 分類系統知識；另先前更正資料路徑（junction→無 junction） |
| 環境 | `~/.claude/expbook`（實體目錄）、`~/.claude/.gitignore` | 拆 junction、資料 repo 直落預設位置；外層 gitignore 排除巢狀 repo |

## 2. 設計重點

- **純 render-time 分組、非破壞**：分類只在渲染層做（`SKILL_GROUPS` 表 + `categorizeSkills()`），`log.jsonl` 原始 skill tag 一個沒動，保留為明細（`status` 以 `‹a·b·c›` 顯示成員）。理由：使用者明示「技能名稱是細節、分類正確就好」；且 log.jsonl 為 append-only 唯一真相，不該為了顯示去改歷史資料。
- **零遺失**：未列入任何分類的 tag 自動歸「未分類」群並提示補進表，避免「靜默吞掉」。
- **可調可回溯**：搬動分類只改一張表 rebuild 即生效，不動資料。
- **資料架構簡化**：原 `~/.claude/expbook` 是 junction → `<local-path>`（資料工具分離設計）。本次拆 junction、把私有 GitHub repo（`<private-data-repo>`）直接落在 `~/.claude/expbook`，少一層轉址，push/跨機 clone 照常。

## 3. 踩坑與分析

### 坑 1（核心，已誠實更正）：junction 方向判斷反了
- 第一輪斷言「`<local-path>` 是 junction、指向 `~/.claude/expbook`」，方向完全相反。用 PowerShell `LinkType/Target` 查證後當場更正。教訓：判斷連結方向必用 `Get-Item -Force` 看 `Attributes/LinkType/Target`，勿憑 git-bash inode 假設。

### 坑 2：54 vs 15 檔案數假性遺失
- Move-Item 後 `Get-ChildItem -Recurse -File`（無 `-Force`）略過隱藏 `.git`，誤報 39 檔遺失。`-Force` 重數確認 54=54、`.git`+remote 完整。教訓：Windows 檔案數核對一律帶 `-Force`。

### 坑 3：README 版號「以為自動」的認知誤解
- 使用者記憶「README 版號由工具讀取、不手動編輯」。查證：`version-check.py` 唯讀稽核器（無 `--write`），README 是 SPEC 的複本、手動維護。處置：保留手動 bump（符合既有機制、version-check 歸零）+ 在 README 加來歷註記根治困惑，而非寫入「自動維護」的假註解。

## 4. 成本

- 單一長 session，多階段：資料查詢 → junction 遷移 → push → 技能加總分析 → v2.4 分類實作 → closeout。
- exp.cjs 改動約 +45 行（純新增，無刪既有邏輯）。
- 守恆/語法/版號全機械驗證，無反覆重修（Guardian FixEscalation retry=3 為多次 Edit 的誤計，非真失敗迴圈）。

## 5. 未竟事項 / 限制

- **散件歸類為人工判斷**：`frontend→實作`、`版號治理→知識`、`security→工具·其它` 等映射為 AI 判斷，使用者可改 `SKILL_GROUPS` 表否決。
- **技能總和 ≠ 總 EXP 為設計**：技能維度重疊計分（分類小計總和 10409 > 總 5006），非 bug；地城維度才與總 EXP 相等。
- **report/renderReport 的「依技能」仍列原始 tag**：未套分類（保留為明細用途），如需一致化可後續處理。

## 6. atom 候選

- ✅ `expbook-agent-成長歷程系統`：已 append v2.4 分類知識 + 更正資料路徑描述。
- 候選（未寫，避免 over-capture）：「Windows junction 方向判斷必用 Get-Item -Force / 檔數核對帶 -Force」— 屬一次性操作教訓，暫不入 atom。
