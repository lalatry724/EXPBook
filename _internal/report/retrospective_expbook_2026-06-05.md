# 流程檢討報告 — ExpBook v2.2 版號升級同步（2026-06-05 收束）

> 目的：將另一 session 已完成的 ExpBook 功能更新（global 版），同步回 PikaTool payload，並完成版號升級 v2.1 → v2.2。

---

## 一、做得好的地方

1. **比對先行，不盲目覆寫**：先用 `diff` 確認三個檔（SKILL.md / exp.cjs / SPEC.md）的實際差異，才決定同步方向，避免誤判「哪邊是新的」。
2. **版號一致性工具閉環**：改完即跑 `version-check.py`，輸出 10/10 DRIFT 0，機械驗證無需人工逐列核對，直接入驗收清單。
3. **SPEC ChangeLog 同步寫入**：版號升版同時補 v2.2 ChangeLog 條目（5 項功能逐一列舉），SPEC 可獨立閱讀；過去版升版常忘記這步。
4. **雙向 SPEC 同步**：payload SPEC.md 更新後立刻 cp 回 global，避免下次 diff 又回到需要手動判斷哪邊是真相源。
5. **零廢話 turns**：全程 5 個 Bash / diff 指令即完成，無重複讀同一檔、無失敗重試。

---

## 二、該改進的地方

1. **SPEC 真相源不明確**
   - 現象：payload SPEC.md 和 global SPEC.md 在任務前版本相同（都是 v2.1），但 SKILL.md 和 exp.cjs 已在 global 更新但版號沒跟著升。
   - 根因：global 的程式改完沒有立即升版 SPEC.md，形成「程式超前、規格落後」的短暫漂移。
   - **改進**：ExpBook 更新程式後，應在**同一 session** 立刻升版 SPEC.md ChangeLog，不留給「版號同步任務」再補。

2. **payload ↔ global 沒有自動檢查**
   - 現象：需靠人工記得「這裡有更新，去那邊同步」。
   - 根因：manifest.json 描述的是安裝方向（payload → ~/.claude），沒有反向偵測。
   - **改進**：可在 closeout Step 3 加入反向 diff 提示（偵測 global 比 payload 新的情況）；短期靠 version-check.py 當警報已足夠。

---

## 三、Token 浪費點 / 優化機會

- 無 devlog Turn 可追蹤（本 session 任務量極小，無低效行為值得記錄）。
- 估算：整個同步任務約 5 輪工具呼叫，token 消耗極低（< 5k 生成）。

---

## 四、需求耗時 / 來回次數

| 需求 | 使用者輪數 | 反覆修正次數 | 主要卡點 |
|------|-----------|------------|---------|
| 比對雙邊版本 | 1 | 0 | — |
| 同步 SKILL.md + exp.cjs | 1 | 0 | — |
| 升版 SPEC.md（雙邊）| 1 | 0 | — |
| 更新 README | 1 | 0 | — |
| 驗收 version-check | 1 | 0 | — |

整體：5 user turns / 5 功能 / 0 反覆修正。屬典型輕量同步任務。

---

## 五、下次類似任務的檢查清單（actionable）

- [ ] 先用 `diff payload global` 確認實際差異，再決定同步方向
- [ ] 升版號時同步補 SPEC.md ChangeLog 條目（列出本次功能變更）
- [ ] 升版後立刻跑 `version-check.py` 確認 0 drift
- [ ] SPEC.md 更新後記得 cp 回 global（payload ↔ global 兩邊都更新）
- [ ] 若 global 程式比 payload 新但 SPEC 版號未升 → 此次有版號漂移，需在更新程式的同一 session 升版

---

## 六、可沉澱為全域記憶的行為原則（建議晉升 atom）

- 「ExpBook 程式更新後應在同一 session 立刻升版 SPEC.md ChangeLog」—— 可 append 至 `pikatool-版號與時間戳規範` atom。
- 無其他新的跨專案普遍教訓（本次任務過於輕量）。

---

## 七、本次新增的全域知識

- 無新 atom 寫入（任務輕量，教訓已在 `pikatool-版號與時間戳規範` 既有 atom 涵蓋範圍）。
- 新建文件：本報告 `_internal/docs/retrospective_expbook_2026-06-05.md`。

---

## 八、結案交付品檢查

- [x] `_0.README.md` ExpBook 版號已更新至 v2.2
- [x] payload SKILL.md == global SKILL.md（diff 確認）
- [x] payload exp.cjs == global exp.cjs（diff 確認）
- [x] 兩邊 SPEC.md = v2.2，ChangeLog 補齊
- [x] version-check 10/10 DRIFT 0
- [x] 本檢討報告已寫入 `_internal/docs/`
- [ ] `_INDEX.md` + `_CHANGELOG.md` 更新（Step 2 補完）
- [ ] git commit（Step 5）
- [ ] EXP staged（Step 6）
