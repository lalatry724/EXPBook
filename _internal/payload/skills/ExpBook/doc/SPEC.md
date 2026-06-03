# ExpBook 規格書（冒險者公會制）

> 版本：guild v2（2026-06-03）。本檔為**權威規格**；操作指引見 `../SKILL.md`，實作見 `../scripts/exp.cjs`。
> 命名：**ExpBook = 系統名**；**EXP = 經驗值單位**。

---

## 1. 目的與哲學

ExpBook 是 **Agent（AI）的成長歷程系統**：把每輪工作量化成經驗值，沉澱成可回看的冒險者生涯。

核心哲學（決定一切規則）：

1. **看見成長歷程，不打考績** —— 目的是「回看走過的路」，不是評分裁決。
2. **正分階梯、只進不退** —— 所有事件 EXP ≥ 0，沒有扣分。挫折/重犯也誠實記、給最小正分，因為它們也是歷程的一部分。
3. **厚程式、薄 AI** —— 所有計算/渲染由 `exp.cjs` 完成；AI 每輪只「辨識意圖 → 發一條短指令 → 轉述一行指標」。**禁止把報告檔內容讀進對話**。
4. **獎勵成果與學習，不獎勵掙扎** —— 交付（任務）與心得（學習）給高分；苦工/失敗/重犯給 +1。不按 token/輪數計分（避免刷分，且 AI 拿不到可靠 mid-turn token 數）。

---

## 2. 資料模型：三層

每筆「經歷（event）」帶 **1 個 kind ＋ 1 個地城（必）＋ 0..N 個技能（選）**，
寫入時 **冒險者等級 + 該地城 + 每個技能 同時 +EXP**。

| 層 | 名稱 | 說明 |
|----|------|------|
| All | **冒險者等級** | 所有經歷累積＝AI 的總成長 |
| tag 類① | **地城（專案）** | 每筆必帶；跨專案累積熟練度。未指明 → 預設 `日常訓練(雜項)`。一資料夾＝一地城 |
| tag 類② | **技能（能力）** | 每筆選填、可多項。預設 7 技能恆顯示，**可自由新增**其他技能 tag |

- **升級門檻**：`LEVEL_STEP = 1000` EXP / 級。`levelFor(exp) = floor(exp/1000)+1`。
- **預設 7 技能**：除錯 / 架構 / 實作 / 重構 / 研究 / 工具 / 知識。
- 地城近似名偵測：寫入時若新地城名與既有名正規化後相同，stderr 警告（防重複建城）。

---

## 3. 五種 kind（事件類型）

| kind（key） | 顯示名 | EXP | 何時記 |
|------|--------|-----|--------|
| `task` | 任務 | **+200** | 明確交付、做完並驗證的一個版本 |
| `lesson` | 心法 | **+20** | 犯錯修正後學到的可複用新心得（禁灌水/複述舊的） |
| `chore` | 練功 | **+1** | 有做事但不構成交付：調查/跑指令/搬檔/部分進度（日常心跳） |
| `fail` | 敗戰 | **+1** | 試了沒成、死路、未得心得（新傷） |
| `regress` | 常錯 | **+1** | 重犯**已知**錯（舊傷復發） |

**互斥判斷準則：**
- 有可用產出 → `練功`；死路沒產出 → `敗戰`；死路且重犯已知錯 → `常錯`。
- **敗戰 vs 常錯＝「這個錯以前犯過嗎？」** 沒有→敗戰；有→常錯。
  「有」的判定來源：已記錄過的 fail/lesson/atom 再犯、Guardian 標 `same_file_3x`/`retry_escalation`、同輪糾正後復發。

---

## 4. 資料儲存

根目錄：`~/.claude/expbook/`（可用環境變數 `EXPBOOK_HOME` 覆寫）。

| 檔案 | 角色 |
|------|------|
| `log.jsonl` | **唯一事實來源（SoT）**。一行一事件，append-only |
| `state.json` | 由 log 重算的快取（global/dungeons/skills）。可隨時 `rebuild` |
| `STATUS.md` | 玩家面板（每次寫入/`status` 重新產生） |
| `views/*.md` | 各式檢視報告（history / dungeon-X / skill-X / report-期間） |
| `_pending.jsonl` | A+C 暫存區（stage 寫入、flush 沖刷後清空） |

**事件（event）JSON 結構：**
```json
{ "ts": "2026-06-03 10:44:53", "kind": "task", "reason": "修好難 bug",
  "dungeon": "Arcane_Rush", "skills": ["除錯","實作"], "exp": 200 }
```
- `dungeon` 省略代表無地城（實務上 CLI 一律補預設地城）。
- `skills` 省略或空陣列代表不掛技能。
- `exp` 為寫入當下快照；**state 一律以 `kind` 經 `EXP_OF` 即時重算**，故改數值後 `rebuild` 即全域生效，`exp` 欄僅供顯示/稽核。
- **向後相容**：舊事件若無 `skills` 但有 `type` 欄，`eventSkills()` 會把 `type` 視為單一技能。

---

## 5. CLI 介面（`node scripts/exp.cjs <cmd>`）

### 寫入（未給 `--dungeon` → 預設地城；`--skill` 可逗號分隔多項）
```
task    "<事由>"        [--dungeon <地城>] [--skill <技能,..>]   +200
lesson  "<心得>"        [--dungeon ..] [--skill ..]            +20
chore   "<做了什麼>"    [--dungeon ..] [--skill ..]            +1
fail    "<敗因>"        [--dungeon ..] [--skill ..]            +1
regress "<重犯的已知錯>" [--dungeon ..] [--skill ..]           +1
```
（`--type` 為 `--skill` 的舊別名，仍可用，併入技能。）

### 檢視（產報告檔，stdout 只回一行指標）
```
status                                  → STATUS.md
history [--dungeon|--skill|--kind|--since|--limit]  → views/history.md
dungeon <地城>                          → views/dungeon-<地城>.md
skill <技能>                            → views/skill-<技能>.md
report --since <今日|本週|本月|YYYY-MM-DD[..YYYY-MM-DD]>  → views/report-<期間>.md
```

### 暫存/沖刷（hook 用）、維運
```
stage --kind <task|lesson|chore|fail|regress> "<事由>" [--dungeon ..] [--skill ..]
flush                       把 _pending 全部沖進 log（Stop hook 每輪呼叫）
rebuild ｜ init ｜ help
remove --last｜--ts "<時間戳>"｜--match "<事由片段>"   從 log 移除並重建
```

---

## 6. 自律記錄機制（A+C：AI 判斷 → Stop hook 沖刷）

1. 回合中 AI 判斷該記時，呼叫 `stage`（語意由 AI 判斷），寫入 `_pending.jsonl`。
2. **Stop hook 每輪結束自動 `flush`**：把 `_pending` 全部 `appendEvent` 進 `log.jsonl`，重算 state，清空 pending。
3. 事由品質要求：寫「做了什麼、結果如何」（例「修好 Arena 戰鬥結算 off-by-one」），禁止「修了東西」。
4. **安全網**：Stop hook 偵測到「有新 commit 但本輪沒 stage」會在下一輪提醒補記。

---

## 7. 渲染規則

- 面板每列格式：`LV{等級} ({當級EXP}/{升級門檻}) Total:{總EXP}`（無進度條，三層皆同）。
- 面板（STATUS.md）順序：冒險者等級 → 地城（依 EXP 降序）→ 技能（先固定 7 項，再額外技能依 EXP 降序）。
- 歷程行格式：`時間  +EXP  [kind顯示名]  (地城)  {技能·技能} 事由`。
- 報告檔安全：檢視檔名經 `safeName()` 去除路徑穿越字元。

---

## 8. 計分範例

| 經歷 | 指令 | 結果 |
|------|------|------|
| 在 Arcane_Rush 修好難 bug，練到除錯+實作 | `task "修好難bug" --dungeon Arcane_Rush --skill 除錯,實作` | 冒險者+200、Arcane_Rush+200、除錯+200、實作+200 |
| 隨手整理檔案，無特定技能 | `chore "整理檔案"` | 冒險者+1、日常訓練(雜項)+1 |
| 學到可複用心得 | `lesson "改Stop hook自身那輪會漏記" --skill 知識` | 冒險者+20、日常訓練+20、知識+20 |
| 注入廢話被糾正後又犯 | `regress "又犯注入廢話" --skill 知識` | 冒險者+1、日常訓練+1、知識+1 |

---

## 9. 規格沿革（重大變更）

| 日期 | 變更 |
|------|------|
| 2026-06-01 | v1：主線(連續)+能力(任務類型)+副本(專案)三池；task100/lesson1/facet20/fail0；門檻 500 |
| 2026-06-03 | **guild v2**：① 數值改 task200/lesson20/門檻1000，新增 chore、fail→+1，新增 regress(覆轍) ② 移除 facet（舊 5 筆轉 lesson）③ 移除「能力」固定池、後又以**選填技能 tag**形式回歸 ④ 改為「冒險者等級 + 地城(必) + 技能(選,可多項)」架構 ⑤ kind 全面奇幻命名：任務/心法/練功/敗戰/常錯 ⑥ 預設地城「日常訓練(雜項)」 |
| 2026-06-03 | 面板簡化：移除進度條，三層列改 `LV{等級} ({當級}/{門檻}) Total:{總EXP}` 緊湊式 |

> 遷移每步皆有 `log.jsonl.bak-*` 備份留底（收於 `~/.claude/expbook/backups/`）。
