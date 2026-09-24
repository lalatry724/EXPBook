# ExpBook 全盤檢討報告（v3 重設前審查）

> 日期：2026-09-23。範圍：運作方式／記錄方式／報告方式／耗能，以及「蒐集性／累積性／遊戲性」現況盤點。
> 證據基礎：親讀 SPEC.md、v2.5 design、SKILL.md、live STATUS.md；五個唯讀 agent 分掃規格文件（GUIDE/README/plans）、實作（exp.cjs 1139 行 + 兩支 hook + 測試）、live 資料（log.jsonl 892 筆 + achievements/state + 副本計時）、開發史（11 份 retro + 67 commit + 24 份 session 摘要）、外部線索（記憶 atom + 191 份對話歸檔 + 其他 skill 依賴）。
> 標示：【實證】= 有檔案:行號或實跑數字；【推論】= 由實證推導。工作筆記（含使用者原話出處）：`~/.claude/projects/C--AI-claude-EXPBook/memory/_staging/expbook-v3-audit-notes.md`。

---

## 0. 一句結論

ExpBook 的**核心經濟（三層 EXP、log.jsonl SoT、Stop hook 沖刷）是健康的**：四個月 892 筆事件、reason 品質高、零壞行。
但 v2.5 疊上去的**衍生層在資料層就斷了累積性**（30 天滾動視窗被當生涯統計）、**回饋迴路從未接通**（徽章/彩蛋/PR 在 hook 路徑一次都沒觸發）、**面板被自由 tag 淹沒**（78 地城/236 技能，91% 篇幅是一次性長尾）。
結果是使用者最初的目的「回頭檢視成長歷程」在使用期發生次數趨近零，ExpBook 退化成收尾時手打「+exp」的儀式。

---

## 1. 亮線：七個結構性發現

### F1 累積性在資料層斷裂【實證】
- 衍生層資料源 = `~/.claude/projects/*/*.jsonl`，Claude Code 預設 30 天清理；現存最舊檔 2026-08-24，achievements.json `window.from` = 08-20。
- `scanTranscripts()` 每次全量重掃（exp.cjs:810-878）；`last_scanned_ts` 只寫不讀（:979）→ 沒有增量、沒有累積帳本。
- 面板「生涯統計」的對話 2,158 / 魔力 130.7 億 / 金幣 US$9,585 / 委託 D2C5B17 全是 34 天視窗值。6 月校準對話 2,394 → 9 月 2,158，數字「倒退」。records.maxDayToken 51.0M > 視窗內 max 23.2M，證明視窗曾更大。
- 徽章條件吃視窗值（exp.cjs:101-149）：沙場宿將 2 萬對話、著作等身 2000 萬字、鋼鐵意志 500hr、公會柱石 100 委託日、萬卷藏書 5000 本、健談老兵 5000 對話 → **數學上永遠解不開**（月產能 ~2k 對話 / 200 萬字 / 140hr / 24 委託日）。
- 指揮 Lv3、殺敵 Lv2 三個月不動 → 投入軸實質死軸。
- 資料備份 repo `expbook-data` 自 06-09 零 commit：HEAD log.jsonl 50 行 vs 現 892 行，842 筆（94%）未提交；跨機可攜停擺 3.5 個月。

### F2 標籤爆炸淹沒「看見歷程」【實證】
- 地城 78 個，其中 31 個屬 10 個重名叢集（TCSM製程|tcsm製程線|TCSM|TCSM引擎|tcsm|TCSM 引擎；Arcane_Rush|arcane-rush|Arcane Rush|集卡冊|Collection…）；40 個地城 EXP ≤220（只記過 ≤1 個 task）。
- 技能 236 個，176 個只用過一次、223 個 LV1；同義碎片：部署 ×8 種寫法、golden ×6、git外科式 ×5、並行agent ×9。
- 根因：程式沒有任何 dungeon/skill 推斷，全靠 AI 每次手填 `--dungeon/--skill`；近似名警告只在直接 `task` 指令、`stage/flush` 路徑沒有（exp.cjs:699-702）；`cwd` 欄寫了沒人讀；SKILL_GROUPS 11 類自 v2.4 未再維護，「未分類」反成主體。
- 後果：STATUS.md 324 行 12,208 字元，地城 78 行 + 技能 211 行 = 91% 篇幅，有效資訊 <1 分鐘、逐行讀 3–5 分鐘。技能分類小計含細項雙算（實作 29,024 vs state 28,024）。

### F3 遊戲性回饋迴路從未接通【實證】
- Stop hook 呼叫 `flushPending()` 函式（expbook-stop.cjs:20），不是 CLI `flush` → 不 derive、不解鎖徽章、不印彩蛋、不播 PR。design §3.4「flush 一行彩蛋」在 hook 路徑**一次都沒觸發過**。
- hook stdout 本就不露出；徽章/彩蛋/PR 只在使用者主動叫 status/show/flush/derive 才更新。26/47 枚已解鎖，但解鎖瞬間對使用者不可見。06-12 上線日一次解 17 枚，之後 4 個月只 9 枚。
- 升級無播報（無「🆙 冒險者升 LvN」）；彩蛋每日寶箱是固定字串；design「整百 task／破 $ 關」未實作。

### F4 精英軸與第 4 柱的張力【推論，依實證】
- 精英分 = 當日 billable token 加權（D1/C2/B3/A5/S25），不含任何成果驗證；一個 S 日（>5000 萬 token）= 半級，一個驗證交付的 task 對精英零貢獻。C 類 7 枚徽章全是燒量徽章。
- 第 4 柱「不按 token 計分」被「零 EXP」字面守住，精神上精英軸開了系統唯一「多燒 token → 榮譽等級升」的通道。面板把 ② 放榮譽半邊、⑤⑥ 放代價半邊，但 ② 本質是 ⑤ 的加權版。
- Gate（Lv20/50/100 退役 D/C/B）以 ≈2 分/日速度要 ≈2 年才觸發第一階 → 實務等於線性累加，「隱藏價值感」只來自 Lv0 隱藏。

### F5 「有加到嗎？」信任缺口【實證】
- 使用者 4 個月問 ≥8 次「有加 exp 嗎」，手打「+exp」60+ 次，07-21 原話「closeout 常常有漏，所以我才會又全部再打一次」。
- 安全網只在「10 分鐘內有新 commit 且本輪沒 stage」提醒；其餘靠 AI 自律。實證根因至少一次是 hook 被 settings 合併漏帶（06-04）。
- closeout skill 的 exp.cjs 路徑仍指 `~/.gemini/`（closeout SKILL.md:87、SPEC.md:57），06-12 已裁決棄 gemini → 潛在靜默略過。

### F6 記錄品質高但時間戳與歸屬失真【實證】
- reason：min 20 / median 130 / max 1,081 字，抽樣 30/30 具體（檔名、hash、數字），0 筆模糊，0 組重複。問題是偏長（300–1000 字小檢討）。
- 78.1% 事件與他筆同秒 ts（最大同秒 17 筆）→ ts = flush 時間，非發生時間；`stagePending` 只存 `{kind,reason,dungeon,skills}`（exp.cjs:645），ts/cwd 在 flush 才補（handoff #051 第 3 項，未做）。
- 132 筆（14.8%）cwd 是 `skills/ExpBook` 目錄（AI 先 cd 進腳本目錄再 stage）；61 筆無 cwd；111 筆（12.4%）無 skills，含 35 個 task。
- subagent transcript 無過濾混入使用者指標：92 turns / 31.7 萬字（14.4%）/ 3,033 萬 billable（10.2%）算成「使用者對話/打字」。
- 週末 0 筆事件（公司帳號）→「假日狂戰士」不可能；fail 21 vs regress 91 → AI 幾乎不記「新傷」。

### F7 耗能：hook 輕、檢視重、文件鏈重【實證】
| 項目 | 實測 | 備註 |
|---|---|---|
| prompt hook（每次 prompt） | wall ~1.0s、輸出 0 字元 | node 啟動 + require 63KB exp.cjs，只為檢查 `_reminder.txt` 存不存在 |
| Stop hook | 0.33–0.45s | pending 空提前 return；2 個 git 子行程；隨 log.jsonl 線性 |
| `status` / `derive` / `show` | 8.4s / 6.1s / 5.9s | 每次全量讀 327 檔 706MB、parse 5.2 萬則 usage；隨 transcript 池線性 |
| atom 注入 | ≈3.3k token | trigger 含泛用詞（技能/地城/EXP）；access read_hits 247、useful 36.9 vs used_fail 86.6 |
| SKILL.md | ≈2.2k token | skill 觸發時 |
| STATUS.md 若被讀 | ≈8k token | 91% 是長尾列表 |
| 四方文件鏈（SPEC+GUIDE+design+README） | ≈30k token | 改 ExpBook 時必讀 |

---

## 2. 四切面檢討

### 2.1 運作方式
- **健康**：A+C 機制（AI stage → Stop hook flush）架構正確、hook 極輕、log.jsonl append-only 零壞行、payload↔live 三檔 byte 一致。
- **問題**：(a) hook 走函式不走 CLI，衍生層回饋全斷（F3）；(b) 信任缺口靠手打補（F5）；(c) closeout 路徑指錯 CLI home；(d) 多 session 並行 Stop 時 readPending→append→truncate 非原子，可丟事件無日誌；(e) readLog/readPending 逐行 JSON.parse 無 try → 一壞行 = Stop hook 內靜默吞、pending 永久卡死；(f) readAchievements 壞檔 → prev={} → 全部徽章重新解鎖、records 歸零（只進不退靜默失守）；(g) payload↔live 方向錯亂重蹈 4 次，反向 diff 從未實作。

### 2.2 記錄方式
- **健康**：五 kind 語意清楚、reason 四要素落實、EXP 快照優先不回溯。
- **問題**：(a) 地城/技能自由 tag 無推斷無收斂（F2）；(b) stage 不存 ts/cwd（F6）；(c) 111 筆無 skills；(d) lesson ≈ task 一比一、fail 極少 → kind 判準在實務上偏向「每 task 配一 lesson」的模板；(e) reason 過長，成本每筆付、收益（回看）未兌現；(f) 06-05 要的「指定 +N 分」未落地。

### 2.3 報告方式
- **健康**：一行式面板（`show`）是唯一可讀入口，使用者明確要求且喜歡。
- **問題**：(a) STATUS.md 91% 噪音（F2）；(b) views/ 5 檔全過期（最新 08-27，兩檔 06-03），無任何程式讀，27 天無人產生；(c) 心法 349 筆無任何可翻閱視圖（第 4 柱「學習」半壁無法回看）；(d) 委託只有計數無日誌；(e) 徽章無進度提示；(f) 「輸入 0.00億」單位失效；(g) 書本換算使用者 06-12 明說「無感」至今未換；(h) 文件鏈 ≥17 條 drift，含 SPEC:83 與程式相反、SPEC:10 主角措辭（design #028）從未落地、GUIDE 展示不存在的第二行面板、SPEC §15 版本序倒置、測試 50 個 4 fail。

### 2.4 耗能
- 每輪固定：~1.4s wall、0 token（無 reminder 時）；atom 命中 +3.3k token。
- 每次看面板 6–8s。derive 死碼白建 52k 個 `scan.messages/perSession` 物件。
- 定價表 `PRICING` 與本機 `~/.claude/tools/token-usage-pricing.json` 重複維護（09-23 v2.8.2 就是為此再改一次）。

---

## 3. 哲學鐵則對照

| 鐵則 | 核心經濟 | 衍生層 |
|---|---|---|
| 1 看見歷程不打考績 | 守住（無扣分、無評語） | 面板噪音讓「看見」失效（F2）；回看行為趨零 |
| 2 正分只進不退 | 守住（唯一倒退是 `remove`） | 指揮/殺敵 Total 隨視窗漂移（F1）；achievements 壞檔靜默歸零 |
| 3 厚程式薄 AI | 守住 | 守住，但「薄」到使用者也不讀 → 檢視成本推給人、人也不看 |
| 4 不獎勵掙扎不刷分 | 守住 | 字面守住（零 EXP）、精神被精英軸打開（F4） |
| 5 主角＝使用者 | SPEC:10/28 至今寫「AI 的成長」 | 指標混入 subagent 產出（F6） |

---

## 4. 蒐集性／累積性／遊戲性現況盤點

### 已有
47 徽章（5 階、2 隱藏、只進不退）｜單一稱號（自動/釘選）｜streak + 週護符 + PR｜每日委託 D–S 分級｜精英 Gate（唯一需經營軸）｜四軸等級｜雙消耗負面框架｜書本換算｜彩蛋 4 句台詞｜個人 PR 四項（實為三項）。

### 缺席（依對使用者原話的貼合度排序）
1. **心法集**：349 筆 lesson 是「學習」的全部證據，沒有任何集子可翻。使用者 06-08 要求詳述是為了「未來閱讀時能有幫助」。
2. **地城圖鑑**：地城應是有限、可命名、可歸戶的「地圖」，現在是 78 個自由字串。使用者 06-01：「副本基本等於我在處理的專案」「基本上就用資料夾名」。
3. **徽章進度**：`toNext` 算了不顯示；玩家不知「百戰之身」還差幾個。
4. **回饋瞬間**：升級、解鎖、PR 刷新在工作中不可見。
5. **委託日誌**：「討伐記錄」只有數字。
6. **從常錯畢業**：第 2 柱說挫折是歷程一部分，沒有「傷癒合」的正向機制。
7. **稱號收藏**：只能戴一枚、無列表、隱藏徽章永不能當稱號。
8. **月度戰報**：design 定案項降級為候選，未做。
9. **累積帳本**：所有衍生指標缺「每日快照 append-only」。

### 設計約束（歷史上明確否決，不回頭提）
扣分｜按 token/輪數加 EXP｜成就給 EXP｜錢當等級錨｜input_tokens 當投入錨｜cache_read 計入度量｜session 級／per-task 委託｜B/M 單位｜LV50 解鎖閘｜「專家」命名｜純啟發式 hook 判 kind｜hook 內叫小模型｜有收益的隨機獎勵｜資料放 skill 夾｜排行榜｜與其他系統耦合。

### 使用者提過、可用的包裝素材
公會聲望等級、獵人等級、裝備熟練度、村莊建設度、承受傷害/藥水/HP 隱喻；「LV50 後小任務加分變少、要精英任務才加」；主題「異世界冒險者公會，各種都可以加進來」。

---

## 5. 設計方向提案（待裁決，裁決後才寫 spec）

三條路線都以「核心經濟不動、log.jsonl 不動」為前提。

### 路線 A｜修根基（累積性 + 可信賴）— 建議必做
1. **每日快照帳本** `ledger.jsonl`：Stop hook 每日首次 flush 時把當日 scan 增量（對話/打字/billable/cost/委託級）append 一行；衍生指標 = Σledger，不再依賴 transcript 存活。舊視窗值以現有 achievements.json 為起始基線。
2. **stage 即存 ts/cwd**；cwd 對映地城別名表 `dungeons.json`（cwd → 正名），stage 未給 `--dungeon` 時自動推斷，給了就走別名正規化。
3. **hook 走 CLI flush**（或 flushPending 後補一次輕量 derive）並把「本輪入帳 + 升級 + 解鎖」寫進 `_reminder.txt`，下輪 prompt hook 一行露出 → 回饋瞬間可見、「有加到嗎」焦慮消失。
4. readLog/readPending 壞行隔離、achievements 壞檔不重置、flush 加檔鎖。
5. 資料 repo 自動 commit（Stop hook 內 `git -C ~/.claude/expbook commit`，不 push；push 由使用者）。
6. prompt hook 改成先 `existsSync(_reminder)` 再 require exp.cjs → 常態 ~50ms。

### 路線 B｜收斂與圖鑑化（蒐集性）
1. **地城圖鑑**：地城改「有限實體」——正名 + 別名 + 首入日 + 最高單日 + 里程（LV5 通關/LV10 精通）；78 → 約 25 座，歷史別名合併走一次性 `migrate`。
2. **技能改閉合分類**：SKILL_GROUPS 升為權威（約 15 類），自由 tag 只做註記不升級不上面板；歷史 236 tag 對映表一次性歸戶。
3. **心法集** `lessons` 視圖：按地城/技能/月份翻閱，每則一行標題 + 展開；求道者徽章梯度 50/100/200/500。
4. **徽章進度**：面板列「最近 3 枚將解鎖：百戰之身 360/500」。
5. **稱號收藏列** + 隱藏徽章可當稱號。

### 路線 C｜遊戲性補足（在 A、B 之上）
1. **委託日誌**：最近 7 日委託級 + 當日主要地城（ledger 已有）。
2. **從常錯畢業**：某 regress 主題 30 天未再犯 → 「傷癒合」徽章/事件（純衍生、零 EXP）。
3. **月度戰報**：`report --since 本月` 加徽章/PR/委託/心法統計摘要。
4. **精英軸誠實化**：二選一——(a) SPEC 標明「精英＝高強度委託日加權」並移到消耗半邊；(b) 精英分改「當日有 task 的委託日才計分」（把成果驗證接回去）。建議 (b)。
5. **書本換算換錨**（使用者 06-12 要求）：候選「A4 疊高 N 公尺」「朗讀 N 小時」；或直接拿掉。
6. **面板重排**：一行面板 + 四軸 + 地城 top 5 + 技能 15 類 + 最近解鎖/將解鎖 + 燃料；長尾全部進 views/。

### 蒐集的定義（一句話）
ExpBook 蒐集的是**真實發生過的東西**（做過的專案、學到的心法、達成的里程）。不做隨機掉落、不做貨幣、不做抽卡。與其他系統完全無關，不互相參照。

---

## 6. 可直接修的 bug 類（不需設計裁決）
1. SPEC:83 改為「e.exp 快照優先、改 rate 不回溯」。
2. SPEC:10/28、SKILL:3、README:1 主角措辭「AI 的成長」→「使用者的成長」（design #028）。
3. GUIDE:22-23 刪不存在的第二行範例；三份文件校準快照統一。
4. SPEC §4 檔案表補 achievements.json/_last_flush.txt/config.json/_reminder.txt/_seen_commits.json/backups/；§5 補 lastflush/derive；§7 渲染規則重寫；§15 版本序修正。
5. panel.test.cjs 4 個斷言跟上 v2.8.1；SPEC「51/51」改實數。
6. closeout SKILL.md:87 / SPEC.md:57 路徑 `~/.gemini/` → `~/.claude/`。
7. scanTranscripts 過濾 `subagents/` 目錄；死碼 scan.messages/perSession 刪除。
8. weekIndex 註解「Monday 對齊」改為實際週日起算，或改碼。
9. skills/ExpBook 的 .bak ×2、expbook/ 的 devlog.md/userChatLog.md/.claude/ 殘留、backups/ 自標冗餘 2 檔清掉。
10. 疑重複入帳 1 組（06-03 17:44 PikaTool 封裝重構）確認後 remove。
11. PRICING 改讀 `~/.claude/tools/token-usage-pricing.json`，不再雙維護。

---

## 7. 本階段驗收清單（done-gate R1，類別 docs，閾值 80）

| # | 驗收項 | 權重 | 驗證方式 | 狀態 | 證據 |
|---|---|---|---|---|---|
| 1 | 四切面（運作/記錄/報告/耗能）各有實證發現 | 2 | 逐節對照 §2 | PASS | §2.1–2.4 每節附 檔案:行號 或實測數字 |
| 2 | 累積性斷裂有一手實證 | 2 | ls transcript 池 + grep last_scanned + achievements window | PASS | 最舊檔 08-24；:979 只寫不讀；window.from 08-20 |
| 3 | 標籤爆炸有量化 | 1 | node 叢集腳本 | PASS | 78 地城/31 重名；236 技能/176 一次性 |
| 4 | 回饋迴路未接通有碼證 | 1 | expbook-stop.cjs:20 | PASS | 呼叫 flushPending 非 CLI flush |
| 5 | 耗能有實跑計時 | 1 | 副本上 time ×3 取中位 | PASS | hook 1.0s/0.4s；status 8.4s |
| 6 | 使用者原話錨定設計約束 | 1 | 對話歸檔逐條引用 | PASS | §4 約束清單 + 原話出處在 staging 筆記 |
| 7 | 設計提案不違反五鐵則與否決清單 | 1 | 逐項對照 §3/§4 | PASS | 路線 A/B/C 皆零 EXP 入口、無扣分、無隨機收益 |

分數 = 9/9 × 100 = 100 ≥ 80。本階段（審查）完工；設計 spec 需使用者裁決路線後另開階段。
