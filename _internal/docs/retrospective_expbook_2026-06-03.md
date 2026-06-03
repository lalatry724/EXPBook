# 結案報告 — ExpBook 重設計為「冒險者公會制」+ 資料跨機可攜（2026-06-03）

> 範圍：把 ExpBook 從 v1（主線+能力+副本三池、task100/lesson1/facet20/fail0）重設計為 guild v2，並把個人 EXP 資料搬到私人 GitHub repo、用 junction 接回，達成跨機可攜。
> 工作對象皆為 **live**：`~/.claude/skills/ExpBook/`（非 PikaTool payload）。

## 一、最終成果（已驗證）

**模型（guild v2）**：兩條主軸 + 選填技能
- **冒險者等級（All）** + **地城（專案，必，預設「日常訓練(雜項)」）** + **技能（能力，選填、可多項，預設 7：除錯/架構/實作/重構/研究/工具/知識，可新增）**
- 每筆 = kind + 地城(1) + 技能(0..N) → 冒險者 + 該地城 + 各技能 同時 +EXP
- 門檻 1000 EXP/級

**5 種 kind（正分階梯、只進不退）**：任務+200 / 心法+20 / 練功+1 / 敗戰+1 / 常錯+1
- 互斥：有產出→練功；死路沒產出→敗戰；死路且重犯已知錯→常錯
- 哲學：看歷程不打考績、只進不退、厚程式薄 AI、獎勵成果與學習不獎勵掙扎

**檔案**：`SKILL.md`(root) + `doc/SPEC.md`(權威規格) + `scripts/exp.cjs`(實作)。skill 夾已整理乾淨（刪除測試誤生的 scripts/.claude 與 scripts/devlog.md）。

**資料現況**：冒險者 Lv2 EXP 1300｜地城 工作流1120/Arcane_Rush20/SVN-Auto-Update160｜技能 除錯260/實作200/工具740。

## 二、資料跨機可攜（本次關鍵架構）

- **私人資料 repo**：`<private-data-repo>`（與公開 **PikaTool** 工具包完全分離，私人歷程不外流）
- **本機 clone**：`<local-path>`
- **接法**：`~/.claude/expbook` 是指向 clone 的**目錄 junction**（mklink /J 等價，免管理員、即時生效、程式零改）
- **同步**：在 clone `git push` / 別機 `git pull`
- **repo 只追蹤** `log.jsonl`（唯一事實來源）+ `backups/`；`state.json/STATUS.md/views/_pending/_seen_commits` 進 .gitignore（可由 rebuild 重生）
- 已初始 commit + push 到 `origin main`

### 別台電腦上線步驟（重要，存查）
```
1. git clone <private-data-repo> <local-path>
2. （PowerShell）若 ~/.claude/expbook 已存在先移走/刪空，再：
   New-Item -ItemType Junction -Path "$HOME\.claude\expbook" -Target "<local-path>"
3. 之後該機產生的紀錄都落在 clone；定期 git pull / push 即同步
```

## 三、過程檢討（誠實）

1. **需求高度迭代、來回多輪**：EXP 數值表前後改了 4 次（成長導向→fail+1→放大尺度→公會制），kind 概念也反覆（移除能力→又以選填技能回歸；移除 facet）。根因：這是「主觀體驗設計」，難一次到位。
   - **改進**：這類「給人看/體驗向」設計，先用一兩個極端範例（如「今天這種苦工 session 該幾分」）對齊價值觀，再定數值，可少繞圈。本次後段已採此法（用「今天」回測每個方案）。
2. **整檔重寫 vs 小修的取捨得當**：動到 ~10 區塊（移除兩大概念）時改用整檔 Write，避免 same_file 連環 Edit 與 Guardian FixEscalation 誤報——正確選擇。
3. **資料安全意識落實**：每次破壞性遷移前都先備份（bak-pre-normalize / -remove-facet / -guild），搬家用「先移進 clone→驗證→才建 junction」順序，全程未遺失 1300 EXP。
4. **Guardian FixEscalation(retry=13) 為誤判**：它把「逐步演進規格」當成「同一 bug 反覆修」。每次變更皆驗證通過、是新需求 → 未觸發 /fix-escalation，正確。
5. **隱私邊界守住**：堅持「skill=可分發程式、data=私人歷程」分離，否決把資料塞進會打包的 skill 夾，避免重蹈 `.claude/` 個資外流的覆轍。

## 四、待辦（未完，交下一 session）

- [ ] **PikaTool payload 同步**：repo 內 `_internal/payload/skills/ExpBook/` 仍是舊結構（舊 exp.cjs、無 doc/SPEC.md）。依政策留待打包時整批同步。
- [ ] **`c:\AI\claude\exp` git commit**：本 session 仍有未提交變動（含先前 .gitignore、工作匯報、本報告）。
- [ ] **舊 v1 規格** `_internal/archive/docs/specs/expbook-spec.md` 已過時 → 留作歷史或加「已被 guild v2 取代」標註（未決）。
- [ ] 全域 atom：本次行為原則（可攜架構、整檔重寫時機）尚未寫入，待裁決。

## 五、驗收

| 項 | 證據 | 狀態 |
|----|------|------|
| guild v2 模型運作 | 煙霧測試：多技能/預設地城/7技能面板皆正確 | ✅ |
| 舊資料遷移無損 | 冒險者 1300、技能由歷史 type 還原 | ✅ |
| skill 夾整理 | 僅 SKILL.md + doc/SPEC.md + scripts/exp.cjs；垃圾已清 | ✅ |
| 資料可攜 | junction 讀 1300、實體在 clone、push origin main 成功 | ✅ |
| 隱私分離 | data repo 私有、與 PikaTool 分離、只追蹤 log+backups | ✅ |

---

# 續：v2.1 面板簡化 + closeout SOP 建立（同日下午）

> 範圍：① ExpBook 面板輸出簡化定版 v2.1 ② 把「結案 SOP」固化為 `/closeout` 命令 ③ 首次 dogfood 用 /closeout 收尾本身。

## 一、做得好的地方
1. **驗收閘門抓到真實遺漏**：Step 0 對「面板無進度條」逐項驗證時，grep 抓出 dungeon/skill 檢視報告標題列（exp.cjs:182,193）仍是舊格式 `bar()`——前一輪只改了 STATUS 主面板。沒有機械驗證就會漏。直接印證 done-gate「無證據判 FAIL」的價值。
2. **brainstorming 先釐清範圍，少繞圈**：建 closeout 前用 3 個多選題鎖定（通用 vs 工具專用 / 純清單 vs 腳本 / 報告委派 vs 自寫），避免做出 ExpBook 綁死的窄 skill。最終定為「通用編排層 + 委派 /retrospect」。
3. **發現既有資產、不重造**：建命令前查到 `/retrospect` 早已寫「結案 SOP 第 1.5 步」——使用者半年前就預留位置。closeout 改為純編排、委派既有工具（retrospect/exp.cjs/atom_write/git），零重複邏輯。
4. **死碼順手清**：`bar()` 失去所有呼叫端後移除，smoke test 通過才算數。

## 二、該改進的地方（誠實列出本輪實際踩的坑）
1. **「全改」需求第一次只改一半**（最大教訓）
   - 現象：使用者要「三層每一行都簡化」，首版只改 STATUS 面板（renderStatus + lvLine），漏了 renderDungeon/renderSkill 兩個檢視報告的同類標題列。
   - 根因：改前沒先 grep 出**所有**輸出該格式的位置就動手；憑「面板」單一心智模型，沒涵蓋「檢視報告也有層級行」。
   - 改進：格式類全域改動，**先 grep 列出所有產出點**再逐一改（已體現在 closeout Step 0 的 grep 驗收）。對應 Guardian 自知「multi_file 首次 50%」。
2. **雙 repo 拓樸到 Step 5 才浮現**：`~/.claude` 自身是 git repo 這件事，開工時沒先確認，導致同步策略要中途插入決策。改進：結案 SOP Step 3/5 應在**開工 onboarding** 就探明 repo 拓樸（live/payload/data 各在哪、各自 .git）。

## 三、下次類似任務的檢查清單（actionable）
- [ ] 格式/介面類「全部改」需求 → 動手前先 `grep` 列出所有產出點，逐一對照才算全
- [ ] 建新 skill/命令前 → 先查既有 commands/skills 是否已有重疊或預留鉤子（如 retrospect 的「第1.5步」）
- [ ] 移除函式 → 先確認 0 呼叫端，改完跑 smoke test 才宣稱清乾淨
- [ ] 任務開工 onboarding → 探明涉及哪些 git repo（live ~/.claude／dev payload／data），免得同步階段才發現

## 四、可沉澱為全域記憶的行為原則（建議晉升 atom）
- 「結案有固定 SOP：驗收→報告→沉澱→payload同步→git→EXP，用 /closeout 編排」—— 新候選，可寫入 closeout 自身說明，暫不另開 atom（命令檔即文件）。
- 「格式全域改動先 grep 全產出點再動手」—— 併入既有 multi_file 自知，不另開 atom。

## 五、本次新增/更新
- `~/.claude/commands/closeout.md`（新）— 結案 SOP 6 步編排命令
- `~/.claude/skills/ExpBook/scripts/exp.cjs` — 面板/檢視報告三層列簡化、移除 bar() 死碼
- `~/.claude/skills/ExpBook/doc/SPEC.md` — §7 渲染規則改寫、§9 沿革 +1 條（v2.1）
- `expbook-agent-成長歷程系統` atom — 升 guild v2（前一輪已 replace）

## 六、驗收
| 項 | 證據 | 狀態 |
|----|------|------|
| 面板三層統一格式 | status/dungeon/skill 輸出皆 `LV (x/y) Total:z` | ✅ |
| 無進度條殘留 | grep bar 全檔 0 | ✅ |
| SPEC 與實作一致 | §7/§9 已更新 | ✅ |
| closeout 命令可用 | /closeout 已載入並執行本次結案 | ✅ |
| Step 0 機械算分 | 8/8 = 100 ≥ 80 | ✅ |
