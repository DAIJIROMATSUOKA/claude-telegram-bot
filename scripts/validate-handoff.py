#!/usr/bin/env python3
"""Handoff quality validation - 3-element check per REMAINING item.
Elements: 現状(status), 次アクション(next action), 完了条件(done criteria)
Usage: python3 validate-handoff.py <summary-file>
"""
import sys, re

if len(sys.argv) < 2:
    print("Usage: validate-handoff.py <summary-file>")
    sys.exit(1)

text = open(sys.argv[1]).read()
lines = text.split("\n")
warnings = []

# === REMAINING validation ===
in_remaining = False
items = []
for line in lines:
    if line.strip().startswith("## REMAINING"):
        in_remaining = True
        continue
    if in_remaining and line.strip().startswith("## "):
        break
    s = line.strip()
    if in_remaining and s and (s.startswith("- ") or re.match(r"^\d+\.?\s+", s)):
        items.append(s)

if not items:
    warnings.append("NO_REMAINING: REMAININGセクションが空。本当に全タスク完了？")

STATUS_KWS = [
    "完了", "未着手", "ブロック", "pending", "done", "fail", "error",
    "ok", "ng", "running", "waiting", "blocked", "稼働", "壊れ",
    "動かない", "未実装", "済み", "途中", "wip", "live", "broken",
    "不具合", "bug", "成功", "失敗", "未テスト", "untested",
]
ACTION_KWS = [
    "実行", "deploy", "commit", "push", "run", "test", "verify",
    "check", "bash", "python", "script", "exec", "修正", "追加",
    "削除", "更新", "確認", "調査", "実装", "設計", "fix", "add",
    "remove", "update", "install", "create", "作成", "書き換え",
    "migration", "移行", "手動", "manual", "dj",
]
DONE_KWS = [
    "完了条件", "done when", "すれば", "したら", "になれば",
    "pass", "green", "0 fail", "0fail", "confirm", "確認できれば",
]
SPECIFICITY_PATS = [
    r"/", r"\.py", r"\.sh", r"\.ts", r"\.js", r"\.md",
    r"M\d{4}", r"commit", r"PR", r"deploy", r"\d{2,}", r"http",
]

for item in items:
    iw = []
    low = item.lower()

    if not any(kw in low for kw in STATUS_KWS):
        iw.append("NO_STATUS")
    if not any(kw in low for kw in ACTION_KWS):
        iw.append("NO_ACTION")

    has_done = any(kw in low for kw in DONE_KWS)
    has_arrow = "\u2192" in item or "\u21d2" in item or "->" in item
    has_specifics = any(re.search(p, item) for p in SPECIFICITY_PATS)
    if not has_done and not has_arrow and not has_specifics:
        iw.append("NO_DONE")

    if len(item) < 30:
        iw.append("SHORT")

    if iw:
        warnings.append("  " + ",".join(iw) + ": " + item)

# === ARTIFACTS context check ===
in_artifacts = False
for line in lines:
    if line.strip().startswith("## ARTIFACTS"):
        in_artifacts = True
        continue
    if in_artifacts and line.strip().startswith("## "):
        break
    s = line.strip()
    if in_artifacts and s and (s.startswith("- ") or re.match(r"^\d+", s)):
        parts = re.split(r"\s*[\u2014\u2013]\s*", s, maxsplit=1)
        if len(parts) == 2 and len(parts[1]) < 15:
            warnings.append("  ARTIFACT_THIN: " + s + "  \u2190 変更理由を追記")

# === COMPRESSED E: boundary check ===
in_compressed = False
for line in lines:
    if line.strip().startswith("## COMPRESSED"):
        in_compressed = True
        continue
    if in_compressed and line.strip().startswith("## "):
        break
    if in_compressed and line.strip().startswith("E:"):
        entry = line.strip()
        bkw = ["ok", "ng", "=ok", "=ng", "works", "fails", "when",
               "<", ">", "char", "byte", "動く", "動かない", "成功", "失敗", "可", "不可"]
        if not any(kw in entry.lower() for kw in bkw):
            warnings.append("  E_NO_BOUNDARY: " + entry + "  \u2190 境界条件を含めて")

# === Output ===
if warnings:
    print("\u26a0\ufe0f HANDOFF品質警告:")
    for w in warnings:
        print(w)
    print()
    print('良い例: "3. テスト137fail \u2014 723中137fail(19%),未着手。`bun test`実行\u21920failで完了"')
    print('悪い例: "3. テスト137 fail \u2014 batch task01で対応予定"')
    print()
    print("次セッションが再調査なしで着手できるよう、現状・次アクション・完了条件を含めてください。")
else:
    print("OK")
