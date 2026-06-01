# EXP — Agent 成長歷程系統 設計規格 (Design Spec)

> 系統 / 專案名稱：**EXP**

- 日期：2026-06-01
- 狀態：設計定稿，待實作計畫
- 範圍：全域、可移植、AI 自律觸發

---

## 1. 目的（為什麼做）

這**不是**「讓 Agent 變強」的遊戲幻想，而是一套**可瀏覽的工作歷程工具**。

- EXP 只是「一件事被完成」的計量單位。
- 真正的價值是：**回頭瀏覽主線（Agent 全域）與專案的 EXP 獲得歷程，藉此搞清楚「我（透過 Agent）到底做了哪些事」。**
- 因此 `log.jsonl`（事件歷程）是主角；等級/能力/副本只是歷程算出來的摘要。

### 核心設計原則
- **歷程優先**：log 是唯一真相，等級是「算出來的」。改公式只需 `rebuild` 重算，不卡死歷史。
- **可移植**：純 Node、零外部依賴，所有資料在單一資料夾。路徑以 `os.homedir()` 動態解析（預設 `~/.claude/exp/`），可用環境變數 `EXP_HOME` 覆寫 → 換機器/換位置都能跑。
- **低耗 token 檢視**（全域 log 會越長越大，必須遵守）：
  - **永遠不直接讀 `log.jsonl`**；一律透過 CLI 取切片。raw log 是 CLI 專用資料層，禁止整份 cat 進對話。
  - 看現況 → 讀 `STATUS.md`（有上限渲染：面向清單只顯示最近 N 條＋總數）。成本低且固定。
  - 看歷程 → `history` 預設只回**最近 20 筆**，靠 `--since/--dungeon/--type/--limit` 篩選；token 成本由查詢決定，與 log 總大小無關。
- **完全獨立**：不綁定、不讀取任何既有技能（journal / retrospect / work-report / 自知機制）。
- **YAGNI**：先做夠用的，未來再長。

---

## 2. 三系統正交模型

```
在【副本】(≈專案) 裡幹活
   ├─→ 賺 EXP ──→ 餵【等級】(全域使用度，一個總數字)
   ├─→ 推進對應【能力】(該任務類型的熟練度)
   └─→ 推進該【副本】的 EXP / 探明面向
一次活動，同時推三條線（互不重疊）。
```

| 系統 | 衡量 | 性質 |
|------|------|------|
| 等級 | 整體使用度（全部加總成一個數字） | 連續數值，單調遞增 |
| 能力 | 處理「某類任務」的熟練度（動詞導向，可跨專案遷移） | 7 類，各自 EXP/等級 |
| 副本 | 在「某專案」挖多深（名詞導向，territorial） | ≈ 資料夾，各自 EXP/等級 + 探明面向清單 |

---

## 3. 等級與 EXP 機制

- **加分**：完成任務 `+100`；錯誤中學到教訓 `+1`。
- **等級公式（固定級距）**：`Lv = floor(EXP / 500) + 1`
  - 每 500 EXP 升一級＝大約每 5 個任務升一級，永遠不變難、可預測。
  - 未來可改公式；改後跑 `rebuild` 即用新公式重算所有等級。
- 同一公式套用於：全域、每個能力、每個副本。

### EXP 流向（一次 `task` 同時推三條線）
| 事件 | 全域 EXP | 能力[type] | 副本 EXP | 備註 |
|------|---------|-----------|---------|------|
| `task`（含 type，預設帶當前副本） | +100 | +100 | +100 | 主要成長事件 |
| `lesson`（可選 type/副本） | +1 | +1（若給 type） | +1（若有副本） | 錯誤中學到教訓 |
| `facet`（副本） | 0 | 0 | +20 | 探明一個新面向，副本專屬 |
| `fail`（失敗筆記，A4-ii） | 0 | 0 | 0 | 只進歷程，不影響任何等級 |

---

## 4. 能力分類（7 類）

除錯 Debug ／ 架構 Architecture ／ 實作 Implementation ／ 重構 Refactor ／ 研究 Research ／ 工具 Tooling ／ 知識 Knowledge

- 與環境既有「自知」機制**完全切開**，不共用分類、不讀其資料。
- 未來可增刪，分類字串即類型 key。

---

## 5. 副本系統

- **副本名 = 專案資料夾名**：`--dungeon` 不指定時，自動取當前工作目錄的資料夾名。原則上一資料夾＝一專案。
- `state.json` 維護**副本登記表**；CLI 偵測近似名稱（大小寫/前綴差異）時**警告**，避免歷程碎裂（如 `MobileAnime` vs `0.MobileAnime`）。
- 每個副本：自有 EXP/等級（同公式）＋ **已探明面向清單**（`facet` 累積的自由文字條目）。
- 「探索度」＝副本等級；「做了多少項目」＝探明面向數。

---

## 6. 資料結構（`~/.claude/exp/`）

> 路徑解析：`EXP_HOME` 環境變數優先；否則 `os.homedir()/.claude/exp/`。所有檔案在此單一資料夾，零外部依賴 → 可移植/可relocate。

### 6.1 `log.jsonl`（主角，append-only）
每行一筆事件：
```json
{"ts":"2026-06-01 14:23:05","kind":"task","reason":"修好 Arena 戰鬥結算 off-by-one","type":"除錯","dungeon":"MobileAnime","exp":100}
{"ts":"2026-05-30 10:02:11","kind":"fail","reason":"嘗試 A 方案失敗，未定位根因","type":"實作","dungeon":"MobileAnime","exp":0}
{"ts":"2026-05-30 11:40:00","kind":"facet","reason":"Arena 戰鬥結算流程","dungeon":"MobileAnime","exp":20}
```
- `kind`：`task | lesson | facet | fail`
- `type`：能力類型（facet/fail 可省）
- `dungeon`：副本名（可省，省則只算全域）
- `exp`：本筆 EXP 增量

### 6.2 `state.json`（由 log 算出的摘要）
```json
{
  "global": { "exp": 1680 },
  "abilities": { "除錯": { "exp": 800 }, "架構": { "exp": 300 } },
  "dungeons": {
    "MobileAnime": { "exp": 1620, "facets": ["Activity UI 結構", "Arena 戰鬥流程"] }
  },
  "updated": "2026-06-01 14:23:05"
}
```
- 只存原始 `exp`，**等級在渲染時計算**（改公式不需資料遷移）。

### 6.3 `STATUS.md`（渲染的狀態板）
每次寫入後重繪，可隨時 glance：
```
# Agent 狀態板

主線　Lv4　EXP 1680　▓▓▓▓▓▓░░ 360/500 到 Lv5

能力
  除錯 Lv2 ███░░░░░ │ 架構 Lv1 █░░░░░░░ │ 實作 …

副本
  【MobileAnime】Lv4　EXP 1620　已探明 2 項
    - Activity UI 結構 / Arena 戰鬥流程
```

---

## 7. CLI 介面（`exp.cjs`，AI 自律呼叫）

```
node exp.cjs task   "<事由>" --type <類型> [--dungeon <副本>]   # +100（三線同推）
node exp.cjs lesson "<教訓>" [--type <類型>] [--dungeon <副本>] # +1
node exp.cjs facet  <副本> "<探明面向>"                          # 副本 +20，記面向
node exp.cjs fail   "<失敗筆記>" [--type <類型>] [--dungeon <副本>] # exp 0，只進歷程
node exp.cjs history [--dungeon X] [--type Y] [--kind K] [--since 今日|本週|本月|YYYY-MM-DD] [--limit N]
node exp.cjs status                                              # 印當前狀態板
node exp.cjs rebuild                                            # 從 log 重算 state + STATUS.md
node exp.cjs init
```

### `history`（核心功能）— 純時間軸流水帳，一行一事件
```
2026-06-01 14:23  +100  [除錯]  (MobileAnime)  修好 Arena 戰鬥結算 off-by-one
2026-05-30 11:40  +20   [面向]  (MobileAnime)  Arena 戰鬥結算流程
2026-05-30 10:02  ✗     [實作]  (MobileAnime)  嘗試 A 方案失敗，未定位根因
```
- 篩選：`--dungeon`（某專案歷程）、`--type`、`--kind`、`--since`、`--limit`
- 預設不帶副本：印主線（全域）時間軸。

### 副本名預設推導
- `--dungeon` 省略時，取「當前工作目錄資料夾名」為副本。

---

## 8. AI 自律觸發規則（寫進 SKILL.md）

- **記 `task`**：使用者**一個明確交付**，且我**做完並驗證/交付**才算一個（子步驟頂多算 facet，不灌水）。
- **記 `lesson`**：犯錯後修正並學到**可複用**教訓。
- **記 `facet`**：在某副本探明一個新面向（架構/流程/陷阱…）。
- **記 `fail`**：嘗試失敗、沒學到可複用教訓，仍誠實留一筆（不影響 EXP）。
- **事由品質規範**：寫成**可讀成果句**（「修好 X 的 off-by-one」），禁止「修了東西」這種空話。
- 每輪對話結束依當輪表現呼叫；結束時可 `status` 給使用者看當前成長。

---

## 9. 使用情境

1. **週末/月底回顧**：`history --since 本週` → 一眼看做了什麼，當產出證據。
2. **專案結案/交接**：`history --dungeon MobileAnime` → 撈該專案經手全部事件。
3. **自我檢視盲區**：`status` 看哪個能力 Lv 偏低 → 知道這方面練得少。
4. **投入分布**：哪個副本 EXP 最高 → 看出時間花在哪。
5. **跨環境帶著走**：可移植，換機器/專案，成長歷程跟著走。

---

## 10. 明確擱置（YAGNI，未來再加）

稱號/段位、趨勢曲線圖、週月自動統計報表、匯出功能、hook 全自動觸發。

---

## 11. 待實作清單（給後續 writing-plans）

1. `exp.cjs`：init / task / lesson / facet / fail / history / status / rebuild
2. log.jsonl 讀寫、state.json 由 log 計算、STATUS.md 渲染
3. 副本名推導（cwd 資料夾名）＋近似名警告
4. `--since` 解析（今日/本週/本月/日期）
5. SKILL.md：自律觸發規則 + 事由品質規範
6. 棄用舊 meritBook：**直接忽略**舊 `merit_demerit.md` 資料，不遷移、不封存。
