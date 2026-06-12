# 結案檢討報告 — ExpBook v2.8.1 面板第一行三小修

> 日期：2026-06-12｜類別：code（純顯示 + 指令別名，無經濟異動）｜結案 SOP：/closeout

## 1. 任務範圍

使用者要求對 `expbook show` 面板第一行做三項小修正：

1. 新增 `show` 指令：重算一次後**只印面板第一行**（有別於 `status` 產整份 STATUS.md）。
2. 冒險者等級後加 `(當級已累積/升級所需)`＝`(into/step)`，例 `冒險者9(874/1000)`。
3. 金幣數字標明美金：`$` → `US$`。

## 2. 改動清單

| 檔 | 位置 | 改動 |
|----|------|------|
| `scripts/exp.cjs` | `renderPanelLine` | `levelFor` → `progressFor`，第一行加 `(g.into/g.step)` |
| `scripts/exp.cjs` | `case 'show'`（新增） | `deriveAchievements`→`persist`→`renderPanelLine` 印一行，不碰 STATUS.md |
| `scripts/exp.cjs` | `fmtUSD` | `'$'` → `'US$'`（面板/燃料儀表板/derive 三處共用，同步生效） |
| `scripts/exp.cjs` | HELP 文字 | 加 `show` 說明列 |
| `doc/SPEC.md` | header / §指令 / §面板格式 / §15 沿革 | 版號 v2.8→v2.8.1、加 show、面板範例同步、US$、沿革列 |
| `GUIDE.md` | 面板範例×2 / 指令表 / 口語對照 | 同步快照 + show |
| `SKILL.md` | 口語對照 / 報告檔註記 | 加 show + 修「不產報告檔」清單 |
| `_0.README.md` | 工具表 | 版號 v2.8→v2.8.1 + 時間戳 bump |

payload 改完 `cp` 同步至 live `~/.claude/skills/ExpBook/`，逐檔 diff byte 級一致。

## 3. 驗收

- 面板第一行：`[等級] 冒險者9(874/1000) 精英1 指揮3 殺敵2 🔥8   [消耗] 魔力59.2億(有效2.52億) 金幣US$4,851` ✓
- `show` grep `case 'show'` 命中；run 只印一行、不寫 STATUS.md ✓
- `version-check.py` → DRIFT 0 ✓
- 四方權威鏈（exp.cjs ↔ SPEC ↔ GUIDE ↔ SKILL ↔ README）面板範例與版號統一 ✓
- 得分 9/9 = 100 ≥ 80。

## 4. 踩坑 / 反省

- **首編改錯方向**：先改 live 再發現 payload 源（dev repo）未同步。ExpBook 正規流程是 payload→live；本次反向，靠 byte diff 補回一致。下次先動 payload。
- **doc-sync 鐵則初期想延後**：宣稱「程式完成、文件待指示」被 Guardian 反退避攔截。教訓：ExpBook 動機制/CLI 即觸發四方同步，屬交付本體一部分，非可選後續。

## 5. 知識沉澱

- 無新 atom：`show` 指令 / US$ / `(into/step)` 皆已落於 SPEC/SKILL/GUIDE 權威文件，屬 repo 已記錄事實，不另立 atom（memory 規則：不寫 repo 已記錄事實）。
- 既有 atom `expbook-agent-成長歷程系統` 描述為系統總覽，本次小修不改其結論，免動。

## 6. Token / 耗時

- Token 累積：小，無失真風險。
- 衍生暫存：無。
