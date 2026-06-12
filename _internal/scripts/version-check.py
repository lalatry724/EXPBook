#!/usr/bin/env python3
"""version-check.py — PikaTool 工具版號一致性稽核

比對 README 「工具一覽」表的版號 vs 各工具 SPEC 的權威版號，揪出 drift。
真相源 = 各工具 SPEC（版本：vX 標記，或 H1 標題尾的 vX）；README 表只是複本。

用法：
    python3 _internal/scripts/version-check.py   # mac 無 bare python，一律 python3
回傳碼：0 = 全一致；1 = 有 drift / 缺漏 / README 多列。
"""
import json, re, sys
from pathlib import Path

# Windows console 預設 cp950，中文輸出會 mojibake → 強制 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT     = Path(__file__).resolve().parents[2]      # _internal/scripts/ → 專案 root
INTERNAL = ROOT / "_internal"                        # manifest src 的基準（src 已含 payload/ 前綴）
PAYLOAD  = ROOT / "_internal" / "payload"
MANIFEST = ROOT / "_internal" / "manifest.json"
README   = ROOT / "_0.README.md"

# 特例：SPEC 不在 manifest files[] 裡、或路徑特殊的工具
SPEC_OVERRIDE = {
    "devlog":  PAYLOAD / "devlog_spec.md",              # 版本在 H1 標題尾
    "expbook": PAYLOAD / "skills" / "ExpBook" / "doc" / "SPEC.md",
}

VER_RE = re.compile(r"v\d+(?:\.\d+)*")


def norm(s: str) -> str:
    """工具名正規化：小寫、只留英數。model-lock/TODOList → modellock/todolist"""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def spec_version(path: Path):
    """從 SPEC 取權威版號。優先 '版本：vX' → 次選 H1 標題的 vX → 末選全文最後一個 vX。"""
    if not path or not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"版本[:：]\s*(v\d+(?:\.\d+)*)", text)
    if m:
        return m.group(1)
    for line in text.splitlines():
        if line.startswith("# "):
            m = VER_RE.search(line)
            return m.group(0) if m else None
        if line.strip():
            break
    vers = VER_RE.findall(text)
    return vers[-1] if vers else None


def find_spec(tool: dict):
    """定位工具的 SPEC 檔：先查特例表，再從 manifest files[] 找檔名含 spec 的。"""
    if tool["id"] in SPEC_OVERRIDE:
        return SPEC_OVERRIDE[tool["id"]]
    for f in tool["files"]:
        if "spec" in Path(f["src"]).name.lower():
            return INTERNAL / f["src"]          # src 已含 payload/ 前綴
    return None


def readme_versions() -> dict:
    """解析 README 工具表： | n | **name** | vX | date | ... | → {norm(name): vX}"""
    text = README.read_text(encoding="utf-8", errors="replace")
    out = {}
    for m in re.finditer(r"^\|\s*\d+\s*\|\s*\*\*(.+?)\*\*\s*\|\s*(v[\d.]+)\s*\|", text, re.M):
        out[norm(m.group(1))] = m.group(2)
    return out


def main():
    tools = json.loads(MANIFEST.read_text(encoding="utf-8"))["tools"]
    rv = readme_versions()

    drift, missing, ok = [], [], []
    seen = set()
    for t in tools:
        key = norm(t["id"])
        seen.add(key)
        sv = spec_version(find_spec(t))
        rmv = rv.get(key)
        if sv is None:
            missing.append((t["id"], "SPEC 無可解析版號"))
        elif rmv is None:
            missing.append((t["id"], "README 表無此列"))
        elif sv != rmv:
            drift.append((t["id"], sv, rmv))
        else:
            ok.append((t["id"], sv))
    extra = [n for n in rv if n not in seen]

    bad = len(drift) + len(missing) + len(extra)
    print(f"[version-check] 工具 {len(tools)}｜一致 {len(ok)}｜DRIFT {len(drift)}｜異常 {len(missing) + len(extra)}")
    for id_, sv, rmv in drift:
        print(f"  X DRIFT  {id_}: SPEC={sv} != README={rmv}")
    for id_, why in missing:
        print(f"  ! {why}: {id_}")
    for n in extra:
        print(f"  ! README 多出一列: {n}（manifest 無對應工具）")
    if bad:
        print(f"  → 不一致，請修正後再結案。")
        sys.exit(1)
    print("  OK 全部版號一致")
    sys.exit(0)


if __name__ == "__main__":
    main()
