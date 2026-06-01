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
- **厚程式、薄 AI（最高原則，整套系統的存在理由）**：能寫進 `exp.cjs` 的邏輯就**全部下沉到程式**——解析、日期換算（本週/本月）、加總統計、依類型/副本分群、進度條/表格/時間軸渲染、近似副本名偵測、等級計算，**一律由程式做，AI 不做**。
  - AI 每輪只負責三件極輕的事：① 辨識使用者口語意圖 → ② 發**一條短 CLI 指令** → ③ 轉述**一行指標**。
  - 每次互動 token 成本因此**固定且極小**（≈ 一條指令 + 一行 stdout），與 log/資料規模無關。
  - 推論：任何「需要 AI 讀資料再算/再排版」的設計都是錯的；改成在 `exp.cjs` 加一個子指令或參數。
- **歷程優先**：log 是唯一真相，等級是「算出來的」。改公式只需 `rebuild` 重算，不卡死歷史。
- **可移植**：純 Node、零外部依賴，所有資料在單一資料夾。路徑以 `os.homedir()` 動態解析（預設 `~/.claude/exp/`），可用環境變數 `EXP_HOME` 覆寫 → 換機器/換位置都能跑。
- **低耗 token 檢視 — 核心約束**（全域 log 會越長越大，必須遵守）：
  - **檔案優先，非 stdout**：所有 view 指令（`status` / `history`）把渲染結果**寫成檔案**，stdout 只回**一行指標**（如「→ 已產生 views/history-本週.md，42 筆」）。**使用者自己開檔讀 = 0 AI token**。這是省 token 的根本手段（即使只回 20 行，經 AI 對話仍吃 token）。
  - **永遠不直接讀 `log.jsonl`**：raw log 是 CLI 專用資料層，禁止整份 cat 進對話。
  - 兩條消費路徑：① 人類瀏覽（主要）→ 讀 CLI 產生的 view 檔；② AI 需要狀態（少數）→ 讀有上限的 `STATUS.md`，或 CLI 回的極短摘要行。
  - view 檔本身有上限渲染：`STATUS.md` 面向清單只顯示最近 N 條＋總數；`history` 預設最近 20 筆，靠 `--since/--dungeon/--type/--limit` 篩選。
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
# EXP 玩家面板

主線　Lv4　EXP 1680　▓▓▓▓▓▓░░ 360/500 到 Lv5

能力
  除錯 Lv2 ███░░░░░ │ 架構 Lv1 █░░░░░░░ │ 實作 …

副本
  【MobileAnime】Lv4　EXP 1620　已探明 2 項
    - Activity UI 結構 / Arena 戰鬥流程
```

### 6.4 `views/`（檢視指令產生的報告檔）
- `views/history.md`、`views/dungeon-<副本>.md`、`views/ability.md`、`views/report-<期間>.md`
- 固定檔名、每次覆寫；供使用者直接開檔閱讀（0 AI token）。

---

## 7. CLI 介面（`exp.cjs`，AI 自律呼叫）

### 輸出總約定（省 token 核心）
- **寫入指令**：stdout 回一行確認（如「✓ task +100｜主線 Lv4 (1680)」）。
- **檢視指令**：**一律把報告渲染成檔案**寫到 `~/.claude/exp/views/`，**stdout 只回一行指標**（如「→ views/report-本週.md（42 筆，+4200 EXP）」），由使用者自行開檔閱讀 = 0 AI token。
- view 檔用**固定檔名、每次覆寫**（不堆積垃圾，永遠是最新），篩選條件寫進檔案標頭。

### 寫入事件
```
node exp.cjs task   "<事由>" --type <類型> [--dungeon <副本>]    # +100（主線+能力+副本三線同推）
node exp.cjs lesson "<教訓>" [--type <類型>] [--dungeon <副本>]  # +1
node exp.cjs facet  <副本> "<探明面向>"                           # 副本 +20，記面向
node exp.cjs fail   "<失敗筆記>" [--type <類型>] [--dungeon <副本>] # exp 0，只進歷程
```

### 檢視（皆產生報告檔，stdout 只回指標）
```
node exp.cjs status                          # → STATUS.md          當前快照：主線+能力+副本一覽
node exp.cjs history [篩選]                   # → views/history.md    時間軸流水帳（核心）
node exp.cjs dungeon <副本>                    # → views/dungeon-<副本>.md  單一副本完整報告
node exp.cjs ability [<類型>]                  # → views/ability.md    能力分布總覽 / 單一能力明細
node exp.cjs report  --since <今日|本週|本月|YYYY-MM-DD[..YYYY-MM-DD]>  # → views/report-<期間>.md  期間彙總
```
`history` 篩選：`--dungeon` / `--type` / `--kind` / `--since` / `--limit`（預設 20）。

### 維運 / 說明
```
node exp.cjs help        # 列出所有指令與口語對照（stdout，內容精簡固定）
node exp.cjs rebuild     # 從 log.jsonl 重算 state.json + 重繪所有 view 檔（改公式後用）
node exp.cjs init
```

### 報告檔內容範例

`views/history.md`（純時間軸，一行一事件）：
```
2026-06-01 14:23  +100  [除錯]  (MobileAnime)  修好 Arena 戰鬥結算 off-by-one
2026-05-30 11:40  +20   [面向]  (MobileAnime)  Arena 戰鬥結算流程
2026-05-30 10:02  ✗     [實作]  (MobileAnime)  嘗試 A 方案失敗，未定位根因
```

`views/report-本週.md`（期間彙總）：
```
# 本週彙總 2026-05-26 ~ 06-01
完成任務 12｜教訓 5｜面向 8｜失敗 2｜本週 +1325 EXP
依類型：除錯 5、實作 4、架構 2、研究 1
依副本：MobileAnime 9、exp 3
```

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

### 8.1 口語觸發對照（使用者口語 → 指令；寫進 SKILL.md）
使用者多以自然語句要求檢視，中英夾雜皆須辨識。對照如下：

| 使用者口語（例） | 執行指令 | 回應方式 |
|------------------|---------|---------|
| 「檢視玩家面板」「show EXP status」「角色面板」「現在幾級」 | `status` | 產生 `STATUS.md`，回指標請使用者開檔 |
| 「show EXP help」「EXP 指令」「有哪些指令」 | `help` | stdout 精簡列出（內容固定，token 低） |
| 「看歷程」「EXP history」「我最近做了什麼」 | `history [篩選]` | 產生 `views/history.md`，回指標 |
| 「本週做了什麼」「週報」「這個月幹了啥」 | `report --since 本週\|本月` | 產生 `views/report-<期間>.md`，回指標 |
| 「看 X 副本」「show dungeon X」「這專案做過什麼」 | `dungeon X` | 產生 `views/dungeon-X.md`，回指標 |
| 「我哪方面強/弱」「能力分布」「show ability」 | `ability [類型]` | 產生 `views/ability.md`，回指標 |

- 通則：除 `help` 外，**檢視一律產報告檔、stdout 只回指標**，不把報告內容讀進對話。

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

1. `exp.cjs` 寫入指令：init / task / lesson / facet / fail（stdout 回確認行）
2. `exp.cjs` 檢視指令：status / history / dungeon / ability / report — **皆渲染成 `views/` 報告檔，stdout 只回指標**（固定檔名覆寫）
3. log.jsonl 讀寫、state.json 由 log 計算、STATUS.md 與 views/* 渲染
4. 路徑解析：`EXP_HOME` → `os.homedir()/.claude/exp/`（可移植）
5. 副本名推導（cwd 資料夾名）＋近似名警告
6. `--since` 解析（今日/本週/本月/單日/區間）
7. `rebuild`：從 log 重算 state + 重繪所有 view 檔；`help`：精簡指令列表（stdout）
8. SKILL.md：自律觸發規則 + 事由品質規範 + **口語觸發對照表**（§8.1）
9. 棄用舊 meritBook：**直接忽略**舊 `merit_demerit.md` 資料，不遷移、不封存。
