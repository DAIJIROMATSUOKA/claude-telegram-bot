#!/usr/bin/env python3
"""Handoff quality validation v3 — session evidence cross-check.

Checks:
  1. REMAINING items: 現状・次アクション・完了条件 (v2)
  2. ARTIFACTS context (v2)
  3. COMPRESSED E: boundary conditions (v2)
  4. [NEW] Git commits: each session commit appears in summary
  5. [NEW] 【決定】marks: each decision from chatlog reflected in DECISIONS

Usage:
  python3 validate-handoff.py <summary-file> [--commits-file FILE] [--decisions-file FILE]
"""
import sys, re, argparse

parser = argparse.ArgumentParser()
parser.add_argument("summary_file")
parser.add_argument("--commits-file", default=None, help="git log --oneline output for session")
parser.add_argument("--decisions-file", default=None, help="【決定】 lines extracted from chatlog")
args = parser.parse_args()

text = open(args.summary_file).read()
lines = text.split("\n")
warnings = []

# ============================================================
# Helper: extract section content
# ============================================================
def extract_section(section_header):
    """Extract lines under ## HEADER until next ## or EOF."""
    result = []
    in_section = False
    for line in lines:
        if line.strip().startswith(f"## {section_header}"):
            in_section = True
            continue
        if in_section and line.strip().startswith("## "):
            break
        if in_section:
            result.append(line)
    return "\n".join(result)


# ============================================================
# REMAINING validation (v2 — unchanged)
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

STATUS_CONCRETE = [
    "完了", "未着手", "ブロック", "pending", "done", "fail", "error",
    "ok", "ng", "running", "waiting", "blocked", "稼働", "壊れ",
    "動かない", "未実装", "済み", "途中", "wip", "live", "broken",
    "不具合", "bug", "成功", "失敗", "未テスト", "untested",
    "件", "箇所", "%", "個",
]
ACTION_VAGUE = ["対応", "対応予定", "予定", "やる", "する", "検討", "検証"]
ACTION_SPECIFIC = [
    ".py", ".sh", ".ts", ".js", ".md", ".yaml", ".json",
    "bash ", "python3 ", "bun ", "npm ", "curl ", "git ",
    "deploy", "commit", "push", "run ", "exec",
    "script.google.com", "DJ手動",
]
DONE_MARKERS = [
    "完了条件", "done when", "すれば", "したら", "になれば",
    "→0", "→OK", "→完了", "→pass", "→green",
    "pass", "green", "0 fail", "0fail", "confirm",
    "確認できれば", "で完了", "になったら",
    "通れば", "出れば", "消えれば", "なくなれば",
]
HAS_OUTCOME_PATTERN = re.compile(r"[→⇒\->]\s*\S")

for item in items:
    iw = []
    low = item.lower()

    if not any(kw in low for kw in STATUS_CONCRETE):
        iw.append("NO_CONTEXT")
    has_specific_action = any(kw in item for kw in ACTION_SPECIFIC)
    has_vague_only = any(kw in low for kw in ACTION_VAGUE) and not has_specific_action
    if not has_specific_action:
        if has_vague_only:
            iw.append("VAGUE_ACTION")
        else:
            iw.append("NO_ACTION")
    has_done = any(kw in low for kw in DONE_MARKERS)
    has_outcome = bool(HAS_OUTCOME_PATTERN.search(item))
    if not has_done and not has_outcome:
        iw.append("NO_DONE")
    if len(item) < 40:
        iw.append("SHORT")

    if iw:
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
# ARTIFACTS context check (v2 — unchanged)
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
    parts = re.split(r"\s*[—–]\s*", a, maxsplit=1)
    if len(parts) < 2:
        warnings.append(f"  ARTIFACT_NO_DESC: {a}  ← 変更理由・目的を追記 (例: — COM直接化でAgent SDK依存排除)")
    elif len(parts) == 2 and len(parts[1]) < 15:
        warnings.append(f"  ARTIFACT_THIN: {a}  ← 変更理由を追記 (次セッションが「なぜ」を理解できるように)")


# ============================================================
# COMPRESSED E: boundary check (v2 — unchanged)
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
# [NEW] Git commit cross-check
# ============================================================
commit_warnings = []
if args.commits_file:
    try:
        commit_lines = [l.strip() for l in open(args.commits_file) if l.strip()]
    except FileNotFoundError:
        commit_lines = []

    if commit_lines:
        # Full summary text (ARTIFACTS + COMPRESSED + body) for hash search
        full_text_lower = text.lower()

        for cl in commit_lines:
            # Format: "abc1234 commit message here"
            parts = cl.split(None, 1)
            if not parts:
                continue
            commit_hash = parts[0]
            commit_msg = parts[1] if len(parts) > 1 else ""

            # Check if commit hash (short) appears anywhere in summary
            if commit_hash.lower() not in full_text_lower:
                # Also check if commit message keywords appear (fuzzy match)
                # Extract significant words from commit msg (>3 chars, not common)
                STOP_WORDS = {"fix", "chore", "feat", "add", "update", "remove",
                              "the", "and", "for", "with", "from", "this", "that",
                              "refactor", "improve", "use", "set", "get"}
                msg_words = set(
                    w.lower().strip("()[],:.'\"")
                    for w in re.split(r"[\s/\-_]+", commit_msg)
                    if len(w) > 3 and w.lower() not in STOP_WORDS
                )
                # Check if at least 2 significant words from commit msg appear in summary
                found_words = [w for w in msg_words if w in full_text_lower]
                if len(found_words) < 2:
                    commit_warnings.append(
                        f"  COMMIT_MISSING: {cl}  ← ARTIFACTS/COMPRESSEDにこのcommitの記録がない"
                    )


# ============================================================
# [NEW] 【決定】cross-check
# ============================================================
decision_warnings = []
if args.decisions_file:
    try:
        decision_lines = [l.strip() for l in open(args.decisions_file) if l.strip()]
    except FileNotFoundError:
        decision_lines = []

    if decision_lines:
        # Extract DECISIONS section
        decisions_section = extract_section("DECISIONS").lower()
        # Also check COMPRESSED D: lines
        compressed_d = []
        in_c = False
        for line in lines:
            if line.strip().startswith("## COMPRESSED"):
                in_c = True
                continue
            if in_c and line.strip().startswith("## "):
                break
            if in_c and line.strip().startswith("D:"):
                compressed_d.append(line.strip().lower())
        decisions_plus_compressed = decisions_section + "\n" + "\n".join(compressed_d)

        for dl in decision_lines:
            # Skip lines that are just the marker or meta-discussion about handoff
            if "handoff" in dl.lower() or "validate" in dl.lower():
                continue
            if dl == "【決定】" or len(dl) < 10:
                continue

            # Clean: remove ### 【決定】 prefix
            clean = re.sub(r"^#+\s*", "", dl)
            clean = clean.replace("【決定】", "").strip()
            if not clean or len(clean) < 5:
                continue

            # Extract keywords from decision text
            STOP_JP = {"する", "した", "ない", "ある", "これ", "それ", "ため", "こと"}
            # For Japanese: extract katakana/ascii words > 2 chars
            kw_pattern = re.compile(r"[A-Za-z0-9_\-\.]{3,}|[ァ-ヶー]{2,}")
            keywords = set(kw_pattern.findall(clean))
            keywords -= STOP_JP

            if not keywords:
                continue

            # Check if at least 40% of keywords appear in DECISIONS or COMPRESSED D:
            found = sum(1 for kw in keywords if kw.lower() in decisions_plus_compressed)
            ratio = found / len(keywords) if keywords else 0

            if ratio < 0.4:
                short_clean = clean[:80] + ("..." if len(clean) > 80 else "")
                decision_warnings.append(
                    f"  DECISION_MISSING: {short_clean}  ← DECISIONS/COMPRESSED D:に反映されていない可能性"
                )


# ============================================================
# Output
# ============================================================
remaining_warns = [w for w in warnings if not w.startswith("  ARTIFACT") and not w.startswith("  E_")]
artifact_warns = [w for w in warnings if w.startswith("  ARTIFACT")]
e_warns = [w for w in warnings if w.startswith("  E_")]

has_any = remaining_warns or artifact_warns or e_warns or commit_warnings or decision_warnings

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
if commit_warnings:
    print("⚠️ Session commits not reflected in summary:")
    for w in commit_warnings:
        print(w)
if decision_warnings:
    print("⚠️ 【決定】marks not reflected in DECISIONS:")
    for w in decision_warnings:
        print(w)

if has_any:
    print()
    print("次セッションが自力で判断できるよう、各項目にスクリプト名・現在の状態・境界条件を含めてください。")
else:
    print("OK")
