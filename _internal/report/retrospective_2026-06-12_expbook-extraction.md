# 結案檢討 — ExpBook 抽出為獨立 repo（2026-06-12）

## 任務

把 ExpBook 從 PikaTool 多工具包（`github:lalatry724/PikaTool`）抽出為獨立 repo
（`github:lalatry724/EXPBook`），**保留完整 git 歷史**，並讓新 repo 可獨立安裝。

## 做了什麼

| 階段 | 內容 | 提交 |
|------|------|------|
| Phase 1 抽出 | 裝 `git-filter-repo 2.47`；於全新 clone 用 keep 清單抽 ExpBook 全檔，裁切歷史 | EXPBook `65101d8` 前的 62 commit |
| Phase 2 骨架 | 精簡 manifest（僅 expbook）+ 通用 install.py/version-check.py + ExpBook 專屬 _0.README | EXPBook `65101d8` |
| 後續 1 | PikaTool 移除 ExpBook（24 檔）+ manifest/README/version-check 同步 | PikaTool `49233fe` |
| 後續 2 | PikaTool CLAUDE.md 改寫為通用守門 + _INDEX/_CHANGELOG 清理 | PikaTool `a5b42e0` |
| 後續 3 | atom `expbook-agent-成長歷程系統` append 遷移事實 | （memory，未提交 Repo B） |

## 驗收結果（done-gate）

| 驗收項 | 證據 | 結果 |
|--------|------|------|
| ExpBook 全檔抽出、無夾帶他工具 | EXPBook `git ls-files` = 24 檔全 ExpBook | PASS |
| 完整歷史保留 | 62 commits，最早「EXP Agent 成長歷程系統設計規格」→ v2.8 | PASS |
| 新 repo 可獨立安裝 | EXPBook `version-check` 工具 1｜DRIFT 0 | PASS |
| 程式正確性 | `node --test` 50/50 pass | PASS |
| PikaTool 移除乾淨 | PikaTool `grep -i expbook` 無殘留；version-check 工具 9｜DRIFT 0 | PASS |
| 推送 | EXPBook master+2 分支；PikaTool `a4a928f..a5b42e0` | PASS |

## 踩坑 / 學習

1. **純 regex 會漏早期歷史**：ExpBook 早期檔名不含 "expbook"（根 `exp.cjs`、`agent-rpg-growth-system-design.md`、`_internal/archive/exp.cjs`）。`(?i)expbook` 單一 regex 會丟掉專案起源歷史 → 需先 `git log --all --diff-filter=A` 掃全歷史路徑，補早期變體（`exp-system`/`exp.cjs`/`exp.test`/`agent-rpg-growth`/`level-calc`）+ 顯式根 `SKILL.md`。
2. **共用骨架整檔耦合**：manifest/README/install/CLAUDE.md 是多工具混寫，filter-repo 只能整檔保留或丟 → 純抽 ExpBook 必丟安裝器，需 Phase 2 重生精簡版骨架。
3. **filter-repo 自動移除 origin**：防誤推回舊 repo，push 前要重新 `remote add`。
4. **git rm 不刪空夾**：`_internal/payload/skills/ExpBook/` 殘留含 untracked devlog 執行檔，需手動 `rm -rf`。
5. **Bash 誤用 PowerShell heredoc**：commit message 首次用 `@'...'@`（PS 語法）在 Bash，`@` 漏進訊息 → 改 `git commit -F -` + bash heredoc。
6. **node --test 目錄參數**：node v24 對目錄參數報 MODULE_NOT_FOUND，須用 `*.test.cjs` glob。

## atom 候選

- [已寫] `expbook-agent-成長歷程系統`：append 遷移事實（新 repo 路徑、PikaTool 現況）。
- [本次新增] `git-filter-repo-抽子集保留歷史`：reference 技術記憶（坑 1-3）。

## Token / 耗時

單 session 完成，🟢L1 全程正常，無壓縮。

## 結論

三段（抽出 / PikaTool 移除 / 守門改寫）全數驗證通過並推送。ExpBook 往後在 EXPBook repo 開發；
PikaTool 降為 9 工具、守門通用化。
