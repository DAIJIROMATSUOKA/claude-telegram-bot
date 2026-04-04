#!/usr/bin/env python3
"""claude-code-cleanup.py — Called by runner trap EXIT.
Usage: python3 claude-code-cleanup.py <current_json> <task_dir> <task_id> <exit_code> <notify_script>
"""
import json, sys, os, subprocess

current   = sys.argv[1]
task_dir  = sys.argv[2]
task_id   = sys.argv[3]
exit_code = int(sys.argv[4])
notify    = sys.argv[5]

# Update status
if os.path.exists(current):
    try:
        d = json.load(open(current))
        d["status"] = "done" if exit_code == 0 else "failed"
        d["exit_code"] = exit_code
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
msg = f"{icon} Claude Code完了 (exit={exit_code})\n🆔 {task_id}"
subprocess.run(["bash", notify, msg], capture_output=True, timeout=10)
