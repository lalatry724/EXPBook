#!/usr/bin/env python3
"""PikaTool 安裝器：複製 payload + merge settings hook + 建資料夾。

支援雙環境：
  --target claude  →  ~/.claude（Claude Code，預設行為，逐 prompt hook）
  --target agy     →  ~/.gemini（Google Antigravity，原生歷史匯出 + .toml 指令）
  --target both    →  兩者都裝
  --target auto    →  一律裝 claude；若偵測到 ~/.gemini 再加裝 agy（預設）
跨 win/mac/Linux，idempotent。
"""
import argparse
import json
import os
import shutil
import sys
from pathlib import Path


def _py_exec():
    """hook 執行時要用的 python 解譯器。

    跨平台關鍵：Windows 慣用 `python`，類 Unix（mac/Linux）多半只有 `python3`。
    優先用 PATH 上存在的指令名（可攜、不綁特定 venv），都找不到才退回安裝當下的
    絕對解譯器路徑（sys.executable）。
    """
    candidates = ("python", "python3") if os.name == "nt" else ("python3", "python")
    for c in candidates:
        if shutil.which(c):
            return c
    return Path(sys.executable).as_posix()


PY_EXEC = _py_exec()


def _resolve_placeholders(obj, home_posix):
    """把 {CLAUDE_HOME}/{GEMINI_HOME}/{PY} 佔位符換成實際值。

    {CLAUDE_HOME}/{GEMINI_HOME} → 目標 home 的 posix 絕對路徑；
    {PY} → 本機可用的 python 解譯器（見 _py_exec）。
    """
    if isinstance(obj, str):
        return (obj.replace("{CLAUDE_HOME}", home_posix)
                   .replace("{GEMINI_HOME}", home_posix)
                   .replace("{PY}", PY_EXEC))
    if isinstance(obj, list):
        return [_resolve_placeholders(x, home_posix) for x in obj]
    if isinstance(obj, dict):
        return {k: _resolve_placeholders(v, home_posix) for k, v in obj.items()}
    return obj


def _load_json(path: Path):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"  ! {path.name} 非合法 JSON，跳過該檔 merge")
            return None
    return {}


def copy_files(internal: Path, home: Path, files: list, report: list):
    home_posix = home.as_posix()
    for f in files:
        src = internal / f["src"]
        dst = home / f["dst"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            shutil.copy2(dst, dst.with_suffix(dst.suffix + ".bak"))
        if f.get("template"):
            # 文字檔：解析佔位符後寫入（.toml 指令需嵌入目標 home 絕對路徑）
            text = _resolve_placeholders(src.read_text(encoding="utf-8"), home_posix)
            dst.write_text(text, encoding="utf-8")
        else:
            shutil.copy2(src, dst)
        report.append(f"  + {f['dst']}")


def make_dirs(home: Path, dirs: list, report: list):
    for d in dirs:
        p = home / d
        if not p.exists():
            p.mkdir(parents=True, exist_ok=True)
            report.append(f"  mkdir {d}")


def merge_hooks(home: Path, hooks: list, report: list):
    """把 hook group merge 進對應 settings_file 的 hooks[event]（只增不蓋、依 match 去重）。"""
    home_posix = home.as_posix()
    pending = {}
    for h in hooks:
        pending.setdefault(h["settings_file"], []).append(h)
    for sfile, entries in pending.items():
        path = home / sfile
        data = _load_json(path)
        if data is None:
            continue
        data.setdefault("hooks", {})
        for h in entries:
            event = h["event"]
            arr = data["hooks"].setdefault(event, [])
            exists = any(
                h["match"] in hook.get("command", "")
                for grp in arr for hook in grp.get("hooks", [])
            )
            if exists:
                report.append(f"  = {sfile}:{event} 已有 {h['match']}，跳過")
                continue
            arr.append(_resolve_placeholders(h["group"], home_posix))
            report.append(f"  + {sfile}:{event} 註冊 {h['match']}")
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def merge_trusted_hooks(home: Path, spec: dict, report: list):
    """agy trusted_hooks.json：把匯出指令加進白名單（每個資料夾 key + 全域 ""），免每次確認。"""
    th = spec.get("trusted_hooks")
    if not th:
        return
    home_posix = home.as_posix()
    path = home / th["settings_file"]
    data = _load_json(path)
    if data is None:
        return
    entries = [_resolve_placeholders(e, home_posix) for e in th["entries"]]
    keys = list(data.keys())
    if "" not in keys:
        keys.append("")  # 全域白名單 key
    for k in keys:
        arr = data.setdefault(k, [])
        for e in entries:
            if e not in arr:
                arr.append(e)
                report.append(f"  + trusted_hooks[{k or 'global'}] {e[:48]}…")
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def install_claude(internal: Path, home: Path) -> list:
    home.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((internal / "manifest.json").read_text(encoding="utf-8"))
    files, dirs, hooks = [], [], []
    for tool in manifest["tools"]:
        files += tool.get("files", [])
        dirs += tool.get("dirs", [])
        hooks += tool.get("hooks", [])
    report = [f"[claude] -> {home}"]
    copy_files(internal, home, files, report)
    make_dirs(home, dirs, report)
    merge_hooks(home, hooks, report)
    return report


def run(internal, home) -> list:
    """向後相容入口（等同安裝 claude 目標）。"""
    return install_claude(Path(internal), Path(home))


def install_agy(internal: Path, home: Path) -> list:
    manifest = json.loads((internal / "manifest.json").read_text(encoding="utf-8"))
    spec = manifest.get("agy")
    if not spec:
        return ["[agy] manifest 無 agy 區段，略過"]
    home.mkdir(parents=True, exist_ok=True)
    report = [f"[agy] -> {home}"]
    copy_files(internal, home, spec.get("files", []), report)
    make_dirs(home, spec.get("dirs", []), report)
    merge_hooks(home, spec.get("hooks", []), report)
    merge_trusted_hooks(home, spec, report)
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description="PikaTool installer")
    ap.add_argument("--target", choices=["claude", "agy", "both", "auto"], default="auto",
                    help="安裝目標（預設 auto：裝 claude，偵測到 ~/.gemini 再加裝 agy）")
    ap.add_argument("--home", default=None,
                    help="覆寫目標目錄（單一 target 時用；預設 ~/.claude 或 ~/.gemini）")
    ap.add_argument("--gemini-home", default=None, help="覆寫 agy 目標目錄（預設 ~/.gemini）")
    args = ap.parse_args(argv)

    internal = Path(__file__).resolve().parent.parent
    claude_home = Path(args.home).expanduser() if args.home else (Path.home() / ".claude")
    gemini_home = Path(args.gemini_home).expanduser() if args.gemini_home else (Path.home() / ".gemini")

    target = args.target
    do_claude = target in ("claude", "both", "auto")
    do_agy = target in ("agy", "both") or (target == "auto" and gemini_home.exists())
    if target == "agy" and args.home:  # 單裝 agy 時 --home 視為 agy home
        gemini_home = Path(args.home).expanduser()

    print(f"PikaTool installer — target={target}")
    report = []
    if do_claude:
        report += install_claude(internal, claude_home)
    if do_agy:
        report += install_agy(internal, gemini_home)
    print("\n".join(report))
    print(f"\n完成。共 {len(report)} 行動作。")
    if do_claude:
        print("• Claude：請重啟 Claude Code 讓 hook 生效。")
    if do_agy:
        print("• agy：請重啟 Antigravity CLI 讓 settings.json hook 與 .toml 指令生效。")
        print("  （/cmdlog 增量匯出、/history 檢視；SessionEnd 自動匯出。"
              "若仍跳確認，表示該 agy 版本 trusted_hooks 語意不同，於該專案授權一次即可。）")
    if target == "auto" and not do_agy:
        print("• 未偵測到 ~/.gemini，略過 agy（如需請用 --target agy）。")
    print("note: work-report / retrospect 完整功能需另裝 workflow-guardian（無 atom 時降級運作）。")
    if shutil.which("node") is None:
        print("warning: 未偵測到 node，chatLog/expBook 的 hook 需要 node 才能運作。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
