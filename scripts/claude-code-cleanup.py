#!/usr/bin/env python3
"""claude-code-cleanup.py — Called by runner trap EXIT.
Usage: python3 claude-code-cleanup.py <current_json> <task_dir> <task_id> <exit_code> <notify_script>
"""
import json, sys, os, subprocess, glob

current   = sys.argv[1]
task_dir  = sys.argv[2]
task_id   = sys.argv[3]
exit_code = int(sys.argv[4])
notify    = sys.argv[5]

# Extract session_id from most recent Claude session
session_id = None
try:
    sessions_dir = os.path.expanduser("~/.claude/projects")
    candidates = glob.glob(os.path.join(sessions_dir, "**/*.json"), recursive=True)
    if candidates:
        newest = max(candidates, key=os.path.getmtime)
        sd = json.load(open(newest))
        session_id = sd.get("sessionId") or sd.get("session_id") or os.path.splitext(os.path.basename(newest))[0]
except Exception:
    pass

# Git diff stats for completion summary
diff_stats = ""
cwd = None
if os.path.exists(current):
    try:
        cwd = json.load(open(current)).get("cwd")
    except Exception:
        pass

if exit_code == 0 and cwd:
    try:
        r = subprocess.run(["git", "diff", "--stat", "HEAD~1"], capture_output=True, text=True, timeout=10, cwd=cwd)
        if r.returncode == 0 and r.stdout.strip():
            lines = r.stdout.strip().split("\n")
            summary_line = lines[-1] if lines else ""
            diff_stats = f"\n📊 {summary_line.strip()}"
        # New files
        r2 = subprocess.run(["git", "diff", "--name-only", "--diff-filter=A", "HEAD~1"], capture_output=True, text=True, timeout=10, cwd=cwd)
        if r2.returncode == 0 and r2.stdout.strip():
            new_files = [f for f in r2.stdout.strip().split("\n") if f]
            if new_files:
                diff_stats += f"\n🆕 New: {', '.join(new_files[:5])}"
                if len(new_files) > 5:
                    diff_stats += f" (+{len(new_files)-5} more)"
    except Exception:
        pass

# Update status
if os.path.exists(current):
    try:
        d = json.load(open(current))
        d["status"] = "done" if exit_code == 0 else "failed"
        d["exit_code"] = exit_code
        if session_id:
            d["session_id"] = session_id
        json.dump(d, open(current, "w"), indent=2)
    except Exception as e:
        print(f"cleanup json error: {e}", file=sys.stderr)

    # Archive
    done_path = os.path.join(task_dir, f"{task_id}.done.json")
    try:
        os.rename(current, done_path)
    except Exception as e:
        print(f"cleanup mv error: {e}", file=sys.stderr)

# Notify
icon = "✅" if exit_code == 0 else "❌"
msg = f"{icon} Claude Code完了 (exit={exit_code})\n🆔 {task_id}{diff_stats}"
subprocess.run(["bash", notify, msg], capture_output=True, timeout=10)
