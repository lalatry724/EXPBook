# ExpBook 開發 repo — 守門指引

> 這裡是 **ExpBook（Agent/使用者成長歷程系統）的開發 repo**。
> 系統 live 安裝在 `~/.claude/skills/ExpBook/`；本 repo 的 payload 源在 `_internal/payload/skills/ExpBook/`。

## ⛔ 改 ExpBook 任何碼/設計前，先讀權威文件（禁憑記憶改）

| 要改什麼 | 先讀哪份（權威順序） |
|---------|--------------------|
| **任何修改的第一站** | `_internal/payload/skills/ExpBook/doc/SPEC.md`（**執行期權威規格**，涵蓋核心經濟三層 + v2.5 衍生層） |
| 衍生層細節 rationale（精英/指揮/殺敵/委託/徽章/儀表板的「為何這樣定」） | `docs/superpowers/specs/2026-06-11-expbook-v2.5-design.md`（設計定稿 + 真實數據基準附錄） |
| 實作 | `_internal/payload/skills/ExpBook/scripts/exp.cjs`（純 Node 零依賴） |
| 人讀上手手冊 | `_internal/payload/skills/ExpBook/GUIDE.md` |

## 核心不可違反（哲學鐵則，動數值/機制前對照）

1. **看見成長歷程，不打考績**。
2. **正分階梯、只進不退**——所有 EXP ≥ 0，衍生層等級也只進不退。
3. **厚程式、薄 AI**——計算/渲染全在 exp.cjs；AI 每輪只「辨識意圖→發一條短指令→轉述一行指標」，**禁讀報告檔進對話**。
4. **獎勵成果與學習、不獎勵掙扎、不刷分**——衍生層一律**純衍生·零 EXP 入口**，不得新增可被刷的計分管道。
5. 主角＝**使用者本人**（v2.5 定調）；AI＝記錄引擎＋協作夥伴。「薄 AI」只約束執行面。

## 改完必做 — 文件一致性鐵則（結案 / closeout 必過）

動到 ExpBook 任何數值/機制，結案前**四方權威鏈全部同步一致**：
程式 `scripts/exp.cjs` ↔ 執行期權威 `doc/SPEC.md` ↔ 企劃 `docs/superpowers/specs/*-design.md`
　↔ 人讀 `GUIDE.md`/`SKILL.md` ↔ 對外 `_0.README.md`

逐項清單（缺一不可，不適用要明寫原因）：
1. **SPEC.md**：改對應節 + `§15 規格沿革` 加版本列 + header `版本：vX` bump。
2. **design 檔**：rationale 變動才動——舊設計加 ⚠supersede 標記（保留歷史不改寫）+ ChangeLog 補 vX-design 列。
3. **GUIDE.md**：對應敘事段 + 沿革表 + **面板範例/校準值**同步。
4. **SKILL.md**：CLI/行為若變才動。
5. **_0.README.md**：工具表版號 + 時間戳（YYYY-MM-DD HH:MM:SS）bump。
6. **版號閘**：跑 `python _internal/scripts/version-check.py` → 必須 **DRIFT 0**。
7. **面板/校準統一基準**：所有面板範例與校準數字錨**同一份 live 快照**（跑 `exp.cjs derive` 取最新），跨 SPEC/GUIDE 不得各說各話。
8. **payload→live**：改完 `cp` payload 到 `~/.claude/skills/ExpBook/` 才生效。
