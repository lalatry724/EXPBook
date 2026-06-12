# ExpBook 規格書（冒險者公會制）

> 版本：v2.7（2026-06-12）。本檔為**權威規格**；操作指引見 `../SKILL.md`，實作見 `../scripts/exp.cjs`。
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

### 2.1 技能分類（render-time 分組，v2.4+）

技能 tag 可自由新增，易長成扁平長列。面板改以 **分類小計** 呈現：`exp.cjs` 的 `SKILL_GROUPS` 表把細 tag 歸入「群組 → 分類」（核心 6 + 工具鏈 5），`categorizeSkills()` 在渲染時加總各分類小計。

- **純渲染、非破壞**：log.jsonl 原始 tag 完全不動（保留為明細，`status` 以 `‹a·b·c›` 顯示成員；history/report 不受影響）。
- **可回溯可調**：要新增/搬動分類只改 `SKILL_GROUPS` 表，rebuild 即生效。
- **零遺失**：未列入任何分類的 tag 自動歸「未分類」群並提示補進 `SKILL_GROUPS`。
- **守恆**：所有分類小計總和 = 原始技能槽位總和（Σ exp×技能數），仍 ≥ 總 EXP（技能維度本即重疊計分；地城維度才與總 EXP 相等）。

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

根目錄：所屬 CLI home 的 `expbook/`（由 `exp.cjs:resolveHome()` 從 `__dirname` 推導：Claude→`~/.claude/expbook/`、gemini→`~/.gemini/expbook/`；可用環境變數 `EXPBOOK_HOME` 覆寫）。

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
3. 事由品質要求（詳細，禁摘要）：reason 要讓未來回溯能還原當時情境，**不可一兩句帶過**。至少涵蓋 ① 具體做了什麼（逐項，非「修了東西」）② 涉及檔案／模組／函式 ③ 結果如何（成功／失敗／部署狀態；有 commit 附 hash）④ 為何而做（觸發原因／需求背景，非顯而易見時）。禁止籠統摘要（「修好 bug」「調整介面」「更新程式」）。好例：「修好 Arena 戰鬥結算 off-by-one：結算 hp 多扣 1（damage.lua:42 floor→round），改回後 E2E smoke 3 場通過，commit a1b2c3」。
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

## 9. 衍生層總覽（v2.5；純衍生 · 零 EXP · 只進不退）

§1–§8 是**核心經濟（三層 EXP）**。以下 §9–§14 是 **v2.5 衍生層**：在不動核心經濟的前提下疊加的敘事/遊戲化機制。

哲學鐵則（不可違反）：

- **純衍生、零 EXP 入口**：所有衍生機制都不寫 `log.jsonl`、不影響任何 EXP，不得新增可被刷的計分管道（守第 4 柱「不刷分」）。
- **資料源**：`~/.claude/projects/*/*.jsonl` 每訊息 `usage`（input / output / cache_creation / cache_read）＋ `log.jsonl`。
- **度量基準＝計費等效 token ＝ input + output + cache_creation**（排除 cache_read；實測佔比 ~96% 且隨對話自動膨脹、最廉價，計入會嚴重失真並誘刷）。
- **主角＝使用者本人**：衍生等級＝使用者投入 AI 協作的累積證明。「薄 AI」僅約束執行面。
- **存檔**：衍生結果寫 `achievements.json`（衍生快取，可 rebuild 重算），不污染 SoT。

---

## 10. 四等級軸（皆只進不退；面板左半＝榮譽等級）

| # | 名稱 | 錨定 | 曲線 | 公式（`exp.cjs`） |
|---|------|------|------|------------------|
| ① | 冒險者 | 成果量（現有 task+200 等 EXP） | 線性 | `levelFor(exp)=⌊exp/1000⌋+1`（§2，現狀不動） |
| ② | 精英 | 高價值成果（委託規模權重） | 指數累進 | 見下 §10.1 |
| ③ | 指揮 | 對話次數（真打字則數，排權限 Enter／系統注入） | 線性除數 | `commandLevel=⌊對話次數/1000⌋+1`（`COMMAND_DIVISOR=1000`） |
| ④ | 殺敵 | 打字量（輸入文字量扣可偵測 code） | 線性除數 | `slayLevel=⌊(打字字元數−code字元)/1000000⌋+1`（`SLAY_DIVISOR=1e6`，每 100 萬字 +1 級） |

**1-based 慣例**：三個基本軸（①冒險者 ③指揮 ④殺敵）皆 **1-based、預設 Lv1**（與 `levelFor` 一致，零輸入也是 Lv1）。②精英不在此列：Lv50 解鎖、預設 0。

- **成果組（①②）**：你產出什麼。② 後期門檻指數爬升 → 拼精英任務。
- **投入組（③④）**：你付出多少、抗灌水。③ 幾乎不可刷；④ 含貼上非 code 文字（無法剔除，見 §12.4），標「輸入文字量」非「純手打」。
- 棄用 `input_tokens` 當投入錨（混系統/工具 token、受 context 膨脹灌水）。
- **曲線取捨（v2.5-doc 改）**：原 ③④ 用平方根（後期邊際遞減、防爆級）；改採**大除數線性**——刻意「不浮灌、等級該有深度」（指揮每 1000 對話、殺敵每 100 萬字才 1 級）。代價：後期不再遞減，投入越多等級線性無上限拉高。
- 校準真實值（2026-06-12 live，1-based）：對話 2,334 次 → 指揮 **Lv3**；純打字 175.8 萬字 → 殺敵 **Lv2**。

### 10.1 精英曲線（②；常數 `ELITE_*`）

```
解鎖閘：冒險者 LV50 前不計精英（面板顯示 精英0）。            ELITE_UNLOCK_LV = 50
每級門檻（精英分）：cost(n) = round(500 × 1.2^(n-1))         ELITE_BASE=500, ELITE_RATIO=1.2
精英分權重（純衍生）：D=1 C=2 B=3 A=5 S=8                    ELITE_WEIGHT
累計達標升級、無硬上限。
```
累計門檻示意：Lv1 累500／Lv2 累1,100／Lv5 累4,318／Lv10 累16,000／Lv20 累~100,000。
（原 ×1.5 過陡已棄——精英 Lv10 需 ~15 年；×1.2 前期溫和、中後期穩爬。）

**精英軸重設計提案（v2.7 記錄，碼維持凍結）**：現況雙重鎖死——冒險者 LV50 硬閘（live 僅 LV9）＋ cost(1)=500 但 live 精英分僅 53，整軸實質凍結、面板已不顯示。未來啟用建議：①**拆掉冒險者 LV50 硬閘**（與精英自身錨無因果，徒增凍結）；②精英改錨**累積 A/S 委託數**（與委託系統呼應、語意直觀「拼高價值成果」），低門檻梯度使 Lv1–5 數月可達、即時可見；③`eliteLevel()` cost 曲線連帶重定。本階段不動 `ELITE_*` 常數與 `eliteLevel()`，僅存查此提案。

---

## 11. 雙消耗儀表板 + 一行式面板（面板右半＝代價，只增不升級）

| # | 名稱 | 錨定 | 框架 |
|---|------|------|------|
| ⑤ | 魔力消耗 | 總 token 處理量（`totalProcessed`，含 cache_read） | 負面（魔力燒掉） |
| ⑥ | 金幣消耗 | token→$（依現行定價估算） | 負面（金幣花掉） |

- 負面/消耗框架刻意弱化炫耀 → 強化「不獎勵燒 token」。資料保留但不誘刷。
- ⑥ 不錨定錢做等級（定價會變）；**定價變動只重算展示欄、不影響任何等級**。穩定錨一律用 token 物理量。
- 配里程碑徽章（億級燃料、破三千刀…）給成就感，但**不做升級曲線**。

**一行式面板格式**（`renderPanelLine`，數字用中文數量級 億／萬字）：
```
[等級] 冒險者18 指揮3 殺敵2 🔥8   [消耗] 魔力55.5億(有效2.34億) 金幣$4,507
```
左＝會升級的榮譽（成果＋投入），右＝只增的代價。單位：token→億（1 億=100M）、字數→萬字、錢→$。
- **精英暫不顯示（v2.5-doc）**：②精英移為待設計 feature，面板 `[等級]` 行**不顯示精英**；`eliteLevel()`／精英分仍計算保留（燃料儀表板 §12.1 仍列精英分），供日後啟用。
- `🔥N` ＝連勤 streak（§13.3）；`(PRn)` 僅在最長連勤 > 目前時附加。

**定價表**（每百萬 token，2026-06；查 `claude-api` skill 為準，常數 `PRICING`）：

| model | input | output | cache_write | cache_read |
|-------|-------|--------|-------------|------------|
| Opus   | $5 | $25 | $6.25 | $0.5 |
| Sonnet | $3 | $15 | $3.75 | $0.3 |
| Haiku  | $1 | $5  | $1.25 | $0.1 |

錢 = Σ(各 model 各欄 × 單價)；model 名以 opus/sonnet/haiku 子字串匹配，未知不計。

---

## 12. 燃料儀表板（`renderFuelDashboard`；生涯統計、不升級、人話化）

### 12.1 委託討伐記錄 D/C/B/A/S（`QUEST_TIERS` + `QUEST_FLOOR`，v2.5-doc 改 per-day）

- **委託 ＝「每日」計費等效 token**：一天一張委託單（`questsByDay` 讀 `scan.perDay` 彙總、依界線分級），不需 task event。
- **下限 `QUEST_FLOOR` ＝ 10 萬**：當日有效 token < 10 萬不算委託（連 D 都不給），擋零星小日子灌數量。
- 改採 per-day 理由：「一天一委託」語意直觀；門檻錨**真實單日量級**——原 per-task 區間版門檻太鬆（舊錨 p25＝17 萬，而實測單日中位已 ~660 萬 → 幾乎全判 S）。
- 4 Gate 門檻（中文單位；不浮灌、S 為衝刺目標）：

| 級 | 當日有效 token | 常數區間 |
|----|----------------|---------|
| （不算委託） | < 10 萬 | `< QUEST_FLOOR(1e5)` |
| D | 10 萬 – 500 萬 | `[1e5, 5e6)` |
| C | 500 萬 – 1000 萬 | `[5e6, 1e7)` |
| B | 1000 萬 – 3000 萬 | `[1e7, 3e7)` |
| A | 3000 萬 – 5000 萬 | `[3e7, 5e7)` |
| S | > 5000 萬 | `[5e7, ∞)` |

校準（2026-06-12 live，26 天）：D10／C7／B8／A1／S0（峰值單日 ~3665 萬）。

### 12.2 token 流量明細（`FLOW_LABEL`，四分項各自累積 ＋ 人話）

| 分項 | 文案 |
|------|------|
| input | 輸入 |
| output | AI 寫出 |
| cache_creation | 首次建快取 |
| cache_read | 重複讀歷史 |

### 12.3 其餘生涯統計

- 對話次數（role=user 且非 tool_result；`startsWith('<')` 粗濾系統注入）。
- 打字量（user 訊息字元數，標 ``` code fence %）。
- 使用時間（相鄰訊息 gap < 15 分才累加，常數 `ACTIVE_GAP_MS`）。
- token 總量。
- 書本換算（**計費等效 × 0.7 字/token，10 萬字 ＝ 1 本**；常數 `BOOK_RATE=0.7`、`BOOK_CHARS=100000`）。
- 等效成本 $（展示欄）。

### 12.4 計數限制備註（誠實標註，避免假精確）

- **對話次數**為近似值：權限 Enter 不算（不產 user 訊息）；系統注入靠 `startsWith('<')` 粗濾，個位數誤差不當精確值。
- **打字量**只能扣有 ``` fence 的 code；裸貼非 code 文字（log/JSON/路徑/引用）無法剔除。「不含 code」≠ 純手打——須標「使用者輸入文字量」。

---

## 13. 四元素（純衍生 · 零 EXP · 榮譽收藏；`exp.cjs` 宣告式）

### 13.1 徽章系統（`ACHIEVEMENTS` 一張表）

結構：`{ id, name, rarity, cat, desc, cond(ctx), hidden? }`，比照 `SKILL_GROUPS` 宣告式、`cond` 純比較。
稀有度 5 階：**N / R / SR / UR / LR**（`RARITY_RANK` 1–5）。**v2.7：47 枚 八類**（原 25 枚六類；B 投入改錨 raw 里程碑、新增 G 技藝 / H 里程兩類）。
**設計鐵則**：全部純衍生·零 EXP·`cond` 只讀既有 ctx 指標 → 不新增可刷分管道；高階門檻一律錨在 live 真實值之上做梯度、不灌水。

| 類別 | 徽章（稀有度・條件） |
|------|---------------------|
| A 戰績 | 初試啼聲(N,首task)／百戰之身(R,100)／身經百戰(R,500)／千錘百鍊(SR,1000)／萬卷功成(LR,10000) |
| B 投入（對話 raw） | 見習指揮官(N,1千對話)／健談老兵(R,5千)／沙場宿將(SR,2萬)／言出法隨(UR,5萬) |
| B 投入（純打字 raw） | 筆耕不輟(N,100萬字)／筆鋒如刃(R,500萬)／著作等身(SR,2000萬)／一字千軍(UR,5000萬) |
| C 委託 | 首級(N,首S)／全階通吃(R,D~S各≥1)／委託熟手(R,30委託日)／公會柱石(SR,100委託日)／精銳獵人(SR,5A)／S級獵人(SR,10S)／巨龍討伐者(UR,單日>3000萬token) |
| D 代價（負面自嘲） | 億級法師(R,有效1億)／吞噬者(SR,10億)／燒錢如焚(SR,$1000)／你知道燒了多少嗎(SR隱藏,$3000)／揮金如土(UR,$5000)／富可敵國(LR,$10000) |
| E 習慣 | 夜術士(R,0–5點task)／晨型冒險者(R,5–8點)／假日狂戰士(R,週末)／不眠騎士(SR,單日>12hr)／馬拉松(SR,單session>6hr)／鋼鐵意志(SR,生涯≥500hr) |
| F 幽默/隱藏 | 浴火重生(R,連3fail後達成)／惜字如金(N,<10字完task)／話癆(N,單日>50對話)／手滑藝術家(N,regress≥3)／慣犯(R,regress≥10)／咖啡因中毒(SR隱藏,單日>200對話) |
| G 技藝（廣度） | 多才(R,≥5技能)／博學者(SR,≥10技能)／地城探索者(R,≥5地城)／地城征服者(SR,≥15地城)／求道者(R,心法≥50) |
| H 里程（生涯量級） | 圖書館長(R,藏書≥1000本)／萬卷藏書(SR,≥5000本)／資料洪流(SR,總處理≥100億token)／百日老兵(R,活躍≥100天) |

- 解鎖**只進不退**（`unlocked[id]=解鎖 ts`）；隱藏徽章解鎖後才現身。徽章解鎖後不因門檻調高而撤銷。
- **v2.7 supersede**：原 4 枚 level 門檻徽章（`cmd_10`/`cmd_50`/`slay_25`/`slay_50`）在 v2.6 大除數（指揮÷1000、殺敵÷100萬字）下永久鎖死，已退役、改錨對話/純打字 raw 里程碑（沿用 見習指揮官/沙場宿將/筆鋒如刃/一字千軍 名稱）。
- **新 ctx 欄**（`buildBadgeContext` 補算，純讀 log+derived）：`conversations`／`pureTyped`(typedChars−codeChars)／`questDays`(ΣtierCount)／`lessonCount`／`distinctSkills`／`distinctDungeons`／`distinctActiveDays`／`books`(`BOOK_EQUIV`=billable×0.7÷10萬)／`careerHours`(activeHours)／`totalProcessed`。舊 `commandLevel`/`slayLevel` ctx 欄保留供面板，徽章不再引用。

### 13.2 稱號（`deriveTitle`）

- 由已解鎖徽章衍生頭銜，掛面板名旁。自動選＝**最高稀有度 → 同稀有度取最新解鎖 ts**；隱藏徽章不列入候選。
- `config.json` 的 `title_pin` 可手動釘選覆寫（STATUS.md 為輸出檔不可當輸入）。

### 13.3 streak 連勤（`computeStreak`，反焦慮版）

- 活躍日 ＝ 當日 ≥1 task event。面板 `🔥N`。
- **護符機制**：每進入一個新日曆週自動發 1 枚，斷 1 天消耗 1 枚、不算斷（`weekIndex` Monday 對齊）。
- **不歸零羞辱**：斷掉後 current 歸 0，longest（PR）永久保留。
- 慶祝里程碑：7／30（`STREAK_CELEBRATE`）。

### 13.4 隨機彩蛋（`pickEasterEgg`；flush 一行 · 薄 AI · 全無 EXP）

優先序：連擊慶祝（7/30）＞里程碑炸裂（跨億 token）＞暴擊（刷新 PR）＞每日寶箱（當日首抽）＞稀有遭遇（~3% 隨機台詞，唯一隨機項，純 flavor）。

### 13.5 里程碑回顧 / 個人 PR（`recordPRs`，即時播報 ＋ 寫 STATUS.md）

個人 PR（只進不退，取 max）：**單日最高 token／單日最多字／單委託最大／最長 streak**。

---

## 14. 衍生引擎與存檔

### 14.1 `deriveAchievements()`

- 純函式：掃 `log.jsonl` ＋ transcript（`usage`）→ 算指標（`deriveMetrics`）→ 解鎖徽章 → 讀-合併-寫 `achievements.json`。
- **觸發時機**：`flush`／`status`／`derive`（`derive` 為顯式重算入口）。
- `last_scanned_ts` 留底供增量；成就解鎖永久寫入（只進不退）。
- ExpBook 資料根：所屬 CLI home 的 `expbook/`（`EXPBOOK_HOME` 可覆寫）。

### 14.2 cwd 存檔

- 每筆 EXP event 自動記錄當下 `process.cwd()` 絕對路徑（新欄位 `cwd`），與手動 `dungeon` tag **並存**，供反推/校正地城與交叉分析。

---

## 15. 規格沿革（重大變更）

| 版本 | 日期 | 變更 |
|------|------|------|
| v1 | 2026-06-01 | 初版：主線(連續)+能力(任務類型)+副本(專案)三池；task100/lesson1/facet20/fail0；門檻 500 |
| v2 | 2026-06-03 | 改採冒險者公會主題：① 數值改 task200/lesson20/門檻1000，新增 chore、fail→+1，新增 regress(覆轍) ② 移除 facet（舊 5 筆轉 lesson）③ 移除「能力」固定池、後又以**選填技能 tag**形式回歸 ④ 改為「冒險者等級 + 地城(必) + 技能(選,可多項)」架構 ⑤ kind 全面奇幻命名：任務/心法/練功/敗戰/常錯 ⑥ 預設地城「日常訓練(雜項)」 |
| v2.1 | 2026-06-03 | 面板簡化定版：移除進度條，三層列改 `LV{等級} ({當級}/{門檻}) Total:{總EXP}` 緊湊式 |
| v2.2 | 2026-06-05 | EXP 透明度 + 可調整：① `lastflush` 指令（查本輪入帳明細）② `flush` 印每筆 `+Δ [kind]` 明細並存 `_last_flush.txt` ③ `stage` 回顯 `+EXP` 數額 ④ `config.json` 覆寫各 kind 的 EXP 數值（只影響之後新事件）⑤ `remove` 補說明（調整/回退某筆） |
| v2.3 | 2026-06-08 | 事由品質升級：由「禁『修了東西』」改為**四要素強制詳述**（① 做了什麼逐項 ② 涉及檔案/模組/函式 ③ 結果+commit ④ 為何而做），明令「不可一兩句帶過」+ 好/壞範例。同步 §6.3 + SKILL 自律記錄章 |
| v2.4 | 2026-06-09 | 技能分類（§2.1）：技能 tag 易長成扁平長列（曾累 35 個），面板改「分類小計」。`exp.cjs` 加 `SKILL_GROUPS` 表（核心6+工具鏈5）+ `categorizeSkills()` render-time 分組；純渲染非破壞（log.jsonl 原 tag 保留為明細，`‹a·b·c›` 顯示成員）；未列入 tag 自動歸「未分類」群；守恆＝分類小計總和=原始技能槽位總和 |
| v2.5 | 2026-06-11 | **衍生層（主體）**：疊加四等級軸（②精英 ③指揮 ④殺敵）＋雙消耗儀表板（⑤魔力 ⑥金幣）＋四元素（徽章25枚/稱號/streak護符/彩蛋/PR）＋燃料儀表板（委託D~S/token流量/書本換算）＋衍生引擎 `deriveAchievements`＋event `cwd` 欄。皆純衍生·零 EXP。設計定稿見 `docs/superpowers/specs/2026-06-11-expbook-v2.5-design.md`。**主角定調＝使用者本人**。**+ Mac 相容修復**：`resolveHome()` 與兩 hook 載入路徑改 `__dirname` 推導 CLI home（原寫死 `~/.gemini` → Claude 下 hook no-op、資料誤落 `.gemini`）；改後雙 CLI 各自獨立、`EXPBOOK_HOME` 可覆寫 |
| v2.5-doc | 2026-06-12 | **SPEC 補完衍生層**（doc-sync 修 desync）：本檔原僅記到 §1–§8 核心經濟＋把 v2.5 誤標為「只有 Mac 修復」，衍生層全散在 design/plan 檔。新增 §9–§14（衍生層總覽/四等級軸/雙消耗儀表板/燃料儀表板/四元素/衍生引擎），數值自 `exp.cjs` 實碼取，doc/SPEC.md 自此為衍生層執行期權威。同步新增 repo 根 `CLAUDE.md` 開發守門人（改 ExpBook 前先讀 SPEC+design） |
| **v2.7** | 2026-06-12 | **徽章再設計（25→47 枚 八類）**：① **B 投入 4 枚 level 門檻徽章 supersede**（`cmd_10`/`cmd_50`/`slay_25`/`slay_50` 在 v2.6 大除數下永久鎖死）→ 改錨對話次數(1千/5千/2萬/5萬)與純打字字數(100萬/500萬/2000萬/5000萬) raw 里程碑；② **巨龍討伐者 re-anchor** 單日委託 1000萬→**3000萬**(per-day 下原值天天觸發失稀有性)；③ **新增 G 技藝**(多才/博學者/地城探索者/地城征服者/求道者)、**H 里程**(圖書館長/萬卷藏書/資料洪流/百日老兵) 兩類；④ A/C/D/E/F 各補梯度(身經百戰/委託熟手/公會柱石/精銳獵人/吞噬者/富可敵國/鋼鐵意志/慣犯/咖啡因中毒)；⑤ `buildBadgeContext` 補 10 個 ctx 欄(純讀 log+derived、零副作用)、`BOOK_EQUIV` helper；⑥ 全部純衍生·零 EXP·門檻錨 live 真實值之上、不灌水。⑦ **精英軸重設計提案**入 §10.1(碼凍結、僅存查)。測試 48/48 綠。三軸等級試算表見 `_internal/report/level-calc-2026-06-12.md` |
| **v2.6** | 2026-06-12 | **等級/委託/面板精修（異動大，逐項）**：① 指揮等級 sqrt→**線性 ÷1000**（每 1000 對話 +1 級）；② 殺敵等級 sqrt→**線性 ÷100 萬字**（每 100 萬純打字 +1 級）；③ 三基本軸（冒險者/指揮/殺敵）統一 **1-based、預設 Lv1**；④ **精英等級移出面板顯示**（移為待設計 feature，`eliteLevel()`/精英分 計算保留）；⑤ **委託 per-task 區間→per-day**（一天一委託，`questsByDay` 讀 `scan.perDay`）；⑥ **委託界線重訂 4 Gate 500萬/1000萬/3000萬/5000萬**（中文單位，原錨太鬆全判 S）；⑦ **委託下限 `QUEST_FLOOR`＝10 萬**（不到不算委託）；⑧ STATUS 面板新增 **指揮/殺敵 與冒險者同款詳列**（新增 `progressBy` 通用 1-based 進度）；⑨ **`FLOW_LABEL.input`「你新送進」→「輸入」**；⑩ 提示鏈修補：新增 repo 根 `CLAUDE.md` 開發守門人（破口1）+ §9–14 衍生層基線補完（破口2，見 v2.5-doc）。校準 live：指揮 Lv3／殺敵 Lv2／委託 D10·C7·B8·A1·S0；測試 42/42 綠 |

> 遷移每步皆有 `log.jsonl.bak-*` 備份留底（收於該 CLI home 的 `expbook/backups/`：Claude `~/.claude/expbook/backups/`／gemini `~/.gemini/expbook/backups/`）。
