#!/usr/bin/env python3
"""Handoff quality validation v2 — stricter 3-element check.
Each REMAINING item must contain:
  1. 現状 (what's broken/blocked, concrete status)
  2. 次アクション (specific command/script/step, not "対応予定")
  3. 完了条件 (measurable done-when)

Usage: python3 validate-handoff.py <summary-file>
"""
import sys, re

if len(sys.argv) < 2:
    print("Usage: validate-handoff.py <summary-file>")
    sys.exit(1)

text = open(sys.argv[1]).read()
lines = text.split("\n")
warnings = []

# ============================================================
# REMAINING validation
# ============================================================
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

# --- Keyword sets ---
# Status: must describe WHAT is happening, not just label
STATUS_CONCRETE = [
    "完了", "未着手", "ブロック", "pending", "done", "fail", "error",
    "ok", "ng", "running", "waiting", "blocked", "稼働", "壊れ",
    "動かない", "未実装", "済み", "途中", "wip", "live", "broken",
    "不具合", "bug", "成功", "失敗", "未テスト", "untested",
    "件", "箇所", "%", "個",  # quantifiers indicate concrete status
]

# Action: must be SPECIFIC (script/command/file), not vague
ACTION_VAGUE = ["対応", "対応予定", "予定", "やる", "する", "検討", "検証"]
ACTION_SPECIFIC = [
    ".py", ".sh", ".ts", ".js", ".md", ".yaml", ".json",
    "bash ", "python3 ", "bun ", "npm ", "curl ", "git ",
    "deploy", "commit", "push", "run ", "exec",
    "script.google.com",  # specific platform
    "DJ手動",  # explicit owner assignment counts
]

# Done condition: measurable outcome
DONE_MARKERS = [
    "完了条件", "done when", "すれば", "したら", "になれば",
    "→0", "→OK", "→完了", "→pass", "→green",
    "pass", "green", "0 fail", "0fail", "confirm",
    "確認できれば", "で完了", "になったら",
    "通れば", "出れば", "消えれば", "なくなれば",
]
# Arrows + specifics together imply a done condition
HAS_OUTCOME_PATTERN = re.compile(r"[→⇒\->]\s*\S")


for item in items:
    iw = []
    low = item.lower()

    # 1. Status check
    if not any(kw in low for kw in STATUS_CONCRETE):
        iw.append("NO_CONTEXT")

    # 2. Action check — must be specific, not just "対応予定"
    has_specific_action = any(kw in item for kw in ACTION_SPECIFIC)
    has_vague_only = any(kw in low for kw in ACTION_VAGUE) and not has_specific_action
    if not has_specific_action:
        if has_vague_only:
            iw.append("VAGUE_ACTION")
        else:
            iw.append("NO_ACTION")

    # 3. Done condition check
    has_done = any(kw in low for kw in DONE_MARKERS)
    has_outcome = bool(HAS_OUTCOME_PATTERN.search(item))
    if not has_done and not has_outcome:
        iw.append("NO_DONE")

    # 4. Length — short items almost always lack context
    if len(item) < 40:
        iw.append("SHORT")

    if iw:
        # Build actionable hint
        hints = []
        if "NO_CONTEXT" in iw:
            hints.append("現在の状態(完了/未着手/ブロック中)と次アクションを含めてください")
        if "VAGUE_ACTION" in iw:
            hints.append("「対応予定」ではなく具体的なスクリプト名・コマンドを書いてください")
        if "NO_ACTION" in iw:
            hints.append("次に何をやるか(スクリプト名/コマンド/DJ手動)を含めてください")
        if "NO_DONE" in iw:
            hints.append("完了条件(→0fail, →OK等)を含めてください")
        hint_str = "  ← " + "、".join(hints) if hints else ""
        warnings.append(f"  {','.join(iw)}: {item}{hint_str}")


# ============================================================
# ARTIFACTS context check
# ============================================================
in_artifacts = False
artifact_items = []
for line in lines:
    if line.strip().startswith("## ARTIFACTS"):
        in_artifacts = True
        continue
    if in_artifacts and line.strip().startswith("## "):
        break
    s = line.strip()
    if in_artifacts and s and (s.startswith("- ") or re.match(r"^\d+", s)):
        artifact_items.append(s)

for a in artifact_items:
    # Split on em-dash or en-dash
    parts = re.split(r"\s*[—–]\s*", a, maxsplit=1)
    if len(parts) < 2:
        warnings.append(f"  ARTIFACT_NO_DESC: {a}  ← 変更理由・目的を追記 (例: — COM直接化でAgent SDK依存排除)")
    elif len(parts) == 2 and len(parts[1]) < 15:
        warnings.append(f"  ARTIFACT_THIN: {a}  ← 変更理由を追記 (次セッションが「なぜ」を理解できるように)")


# ============================================================
# COMPRESSED E: boundary check
# ============================================================
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
               "<", ">", "char", "byte", "動く", "動かない", "成功", "失敗", "可", "不可",
               "必須", "不要", "専用", "限定", "のみ"]
        if not any(kw in entry.lower() for kw in bkw):
            warnings.append(f"  E_NO_BOUNDARY: {entry}  ← 境界条件を含めて (何がOK/何がNG)")


# ============================================================
# Output
# ============================================================
if warnings:
    remaining_warns = [w for w in warnings if not w.startswith("  ARTIFACT") and not w.startswith("  E_")]
    artifact_warns = [w for w in warnings if w.startswith("  ARTIFACT")]
    e_warns = [w for w in warnings if w.startswith("  E_")]

    if remaining_warns:
        print("⚠️ REMAINING items lack detail (what/how/status):")
        for w in remaining_warns:
            print(w)
    if artifact_warns:
        print("⚠️ ARTIFACTS lack context:")
        for w in artifact_warns:
            print(w)
    if e_warns:
        print("⚠️ COMPRESSED E: entries lack boundary conditions:")
        for w in e_warns:
            print(w)

    print()
    print("次セッションが自力で判断できるよう、各項目にスクリプト名・現在の状態・境界条件を含めてください。")
else:
    print("OK")
