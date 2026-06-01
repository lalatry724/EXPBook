# ExpBook 規格書（canonical，可移植）

- 更新：2026-06-01
- 取代：`2026-06-01-agent-rpg-growth-system-design.md`（原始設計，保留為歷史）
- 命名：**ExpBook = 系統/skill 名**；**EXP = 經驗值單位**（程式碼內用 `exp` 無妨，對話一律稱 ExpBook）

---

## 1. 目的
全域、可移植、低耗 token 的 **Agent 工作歷程系統**。EXP 只是計量；主角是可瀏覽的歷程（回頭看「做了哪些事」）。

## 2. 三系統正交（皆 `Lv = floor(EXP/500)+1`）
| 系統 | 衡量 | 性質 |
|------|------|------|
| 等級 | 全域使用度（總和） | 連續數值 |
| 能力 | 7 類任務熟練度：除錯/架構/實作/重構/研究/工具/知識 | 動詞、可跨專案 |
| 副本 | ≈ 專案（資料夾名）的探索度 | 名詞、territorial |

## 3. EXP 流向（由 `kind` 決定，金額為常數 → 改額後 `rebuild` 重算）
| kind | 全域 | 能力[type] | 副本 | 備註 |
|------|------|-----------|------|------|
| task | +100 | +100 | +100 | 三線同推 |
| lesson | +1 | +1(有 type) | +1(有副本) | 錯誤中學到教訓 |
| facet | 0 | 0 | +20 | 探明面向，記入副本 facets |
| fail | 0 | 0 | 0 | 只進歷程 |

## 4. 核心原則
- **厚程式、薄 AI**：解析/日期換算/彙總/渲染/等級計算全在 `exp.cjs`；AI 每輪只「辨識意圖→發短指令→轉述一行指標」。
- **歷程優先**：`log.jsonl` 為唯一真相，state 由 log 算出，`rebuild` 可換公式重算。
- **低耗 token 檢視**：檢視指令一律渲染成檔（`STATUS.md`/`views/*.md`），stdout 只回指標，使用者開檔讀 = 0 AI token；永不整份讀 log。
- **可移植**：純 Node 零依賴；路徑 `EXPBOOK_HOME` → 否則 `os.homedir()/.claude/expbook/`。

## 5. 資料結構（`~/.claude/expbook/`）
```
log.jsonl        ← 唯一真相，append-only：{ts,kind,reason,type?,dungeon?,exp}
state.json       ← 由 log 算出的摘要（global/abilities/dungeons{exp,facets}）
STATUS.md        ← 玩家面板（渲染）
views/           ← history.md / dungeon-<名>.md / ability.md / report-<期間>.md
_pending.jsonl   ← A+C 暫存區（stage 寫入，Stop hook flush 後清空）
_seen_commits.json ← A 安全網：已提醒過的 commit（防重複/迴圈）
_reminder.txt    ← Stop hook 留給下一輪的提醒（UserPromptSubmit 顯示後刪）
```
> 等級不存檔，渲染時計算（改公式免遷移）。檔名含使用者輸入者一律經 `safeName` 防路徑穿越。

## 6. CLI（`exp.cjs`）
```
# 寫入（立即落 log）
task   "<事由>" --type <類型> [--dungeon <副本>]      # +100
lesson "<教訓>" [--type ..] [--dungeon ..]            # +1
facet  <副本> "<面向>"                                 # 副本 +20
fail   "<筆記>" [--type ..] [--dungeon ..]            # 0

# A+C 暫存/沖刷（hook 用）
stage --kind <task|lesson|facet|fail> "<事由>" [--type ..] [--dungeon ..]   # 寫 _pending
flush                                                 # _pending → log（Stop hook 每輪呼叫）

# 檢視（產報告檔，stdout 只回指標）
status                       → STATUS.md
history [--dungeon|--type|--kind|--since|--limit]  → views/history.md
dungeon <副本>                → views/dungeon-<副本>.md
ability [<類型>]              → views/ability.md
report  --since <今日|本週|本月|YYYY-MM-DD[..YYYY-MM-DD]>  → views/report-<期間>.md

# 維運
rebuild   # 從 log 重算 state + 重繪
init | help
```
副本省略 → 取當前工作目錄資料夾名（一資料夾＝一專案）；近似名警告。

## 7. 自動觸發（A+C 機制）
- **C（保證執行）**：回合中 AI 用 `stage` 暫存；**Stop hook 每輪 `flush`** 進 log（即使回合中斷也不漏）。
- **A（安全網，非阻擋）**：Stop hook 若本輪 flush 0 筆但偵測到「10 分鐘內的新 commit 且未提醒過」→ 寫 `_reminder.txt`；下一輪 UserPromptSubmit 顯示一次。`_seen_commits.json` 防重複，無迴圈。
- 設計取捨：判斷（語意）由 AI 做、執行由 hook 保證、**不**每輪叫模型（守低耗 token）。

## 8. 組成元件（移植清單）
| 元件 | 路徑 | 角色 |
|------|------|------|
| CLI | `~/.claude/skills/ExpBook/scripts/exp.cjs` | 全部邏輯（單檔、零依賴） |
| Skill | `~/.claude/skills/ExpBook/SKILL.md` | 觸發描述 + 自律規則 + 口語對照 |
| Stop hook | `~/.claude/hooks/expbook-stop.cjs` | flush + A 安全網 |
| Prompt hook | `~/.claude/hooks/expbook-prompt.cjs` | 顯示 `_reminder.txt` |
| 註冊 | `~/.claude/settings.json` 的 `Stop` 與 `UserPromptSubmit` | 指向上述兩 hook |
| 資料 | `~/.claude/expbook/`（或 `EXPBOOK_HOME`） | 執行期自動建立 |

> hook 以 `require()` 載入部署後的 `exp.cjs` → CLI 邏輯單一來源，hook 不重複實作。

## 9. 移植 / 安裝程序
另一台機器或環境安裝 ExpBook：
1. **複製 skill**：把 `~/.claude/skills/ExpBook/`（含 `scripts/exp.cjs` + `SKILL.md`）整夾複製過去。
2. **複製 hooks**：把 `~/.claude/hooks/expbook-stop.cjs`、`expbook-prompt.cjs` 複製過去。
3. **註冊 hooks**：在目標 `~/.claude/settings.json` 的 `hooks.Stop` 與 `hooks.UserPromptSubmit` 各加一組：
   ```json
   { "hooks": [ { "type": "command", "command": "node \"<HOME>/.claude/hooks/expbook-stop.cjs\"", "timeout": 10 } ] }
   { "hooks": [ { "type": "command", "command": "node \"<HOME>/.claude/hooks/expbook-prompt.cjs\"", "timeout": 5 } ] }
   ```
4. **（可選）搬資料**：要保留歷程就複製 `~/.claude/expbook/`；不搬則新環境從零開始（`exp.cjs init` 或首次 stage 自動建立）。
5. **驗證**：`node ~/.claude/skills/ExpBook/scripts/exp.cjs help` 印出指令即成功。
- 前提：目標環境有 Node（建議 ≥18，支援 `node:test` 才能跑測試；執行本體只需基本 Node）。
- 無 ExpBook 時兩個 hook 會自我 no-op（`require` 失敗即 `exit 0`），不影響其他環境。

## 10. 測試
repo 根目錄 `node --test`（純內建 `node:test`，零外部依賴）。涵蓋純函式 + CLI 整合 + stage/flush + 安全（路徑穿越/輸入驗證）。

## 11. 已知擱置（YAGNI）
稱號/段位、趨勢圖、匯出、hook 內叫模型判斷（B 方案，因燒 token 不採）、log 按月分檔。
