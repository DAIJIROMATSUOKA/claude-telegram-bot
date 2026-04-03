#!/usr/bin/env python3
"""
auto-handoff.py - Claude Code Stop hook
Fires when a Claude Code session ends.
Generates HANDOFF automatically from Auto Memory + git state.
Saves to: Journal (Dropbox, append) + docs/HANDOFF (git repo, overwrite)
"""
import os
import sys
import subprocess
import fcntl
import re
import time
from datetime import datetime
from pathlib import Path

# Paths
PROJECT_DIR = os.environ.get("CLAUDE_PROJECT_DIR", os.path.expanduser("~/claude-telegram-bot"))
MEMORY_DIR = os.path.expanduser("~/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory")
JOURNAL_DIR = os.path.expanduser("~/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian/90_System/JARVIS/Journal")
ENV_FILE = os.path.join(PROJECT_DIR, ".env")
LOG_FILE = "/tmp/auto-handoff.log"
LOCK_FILE = "/tmp/auto-handoff.lock"

def log(msg):
    with open(LOG_FILE, "a") as f:
        f.write(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}\n")

def read_file(path, default=""):
    try:
        return Path(path).read_text()
    except Exception:
        return default

def run_cmd(cmd, cwd=None):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10, cwd=cwd)
        return r.stdout.strip()
    except Exception:
        return ""

def main():
    # Layer 1: Timestamp dedup - skip if ran within last 5 seconds
    STAMP_FILE = "/tmp/auto-handoff.stamp"
    try:
        if os.path.exists(STAMP_FILE):
            age = time.time() - os.path.getmtime(STAMP_FILE)
            if age < 5:
                return  # Another instance just ran
    except Exception:
        pass

    # Layer 2: fcntl lock - prevent concurrent execution
    lock_fd = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return  # Another instance running
    try:
        # Write stamp BEFORE work (prevents second process from starting)
        Path(STAMP_FILE).touch()
        _run()
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


def update_m1_state():
    """Auto-update M1.md with session summary on Stop hook"""
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M")
    iso_str = now.strftime("%Y-%m-%dT%H:%M+09:00")

    m1_path = os.path.join(PROJECT_DIR, "autonomous/state/M1.md")

    # Gather session info from git
    recent_commits = run_cmd("git log --oneline --since='12 hours ago'", cwd=PROJECT_DIR)
    git_diff_names = run_cmd("git diff --name-only HEAD~5 HEAD 2>/dev/null || echo ''", cwd=PROJECT_DIR)

    # Read task-state for context
    tasks_md = read_file(os.path.join(MEMORY_DIR, "task-state.md"))

    # Build commit summary (deduplicate, max 10 lines)
    commit_lines = []
    if recent_commits:
        for line in recent_commits.splitlines()[:10]:
            # Strip hash, keep message
            parts = line.split(" ", 1)
            if len(parts) == 2:
                commit_lines.append(f"- {parts[1]}")

    # Build changed files summary
    file_summary = ""
    if git_diff_names:
        files = [f for f in git_diff_names.splitlines() if f.strip()]
        if files:
            file_summary = f"- Changed files: {', '.join(files[:8])}"
            if len(files) > 8:
                file_summary += f" (+{len(files)-8} more)"

    # Read previous M1.md to preserve older session history
    prev_m1 = read_file(m1_path)
    prev_sections = ""
    # Extract previous session summaries (keep last 2)
    prev_matches = re.findall(r"(### Previous:.*?)(?=### Previous:|## NEXT_ACTION|$)", prev_m1, re.DOTALL)
    if prev_matches:
        prev_sections = "\n".join(prev_matches[:2]).strip()

    # Build new M1.md
    session_body = "### Session work\n"
    if commit_lines:
        session_body += "\n".join(commit_lines) + "\n"
    else:
        session_body += "- (no git commits this session)\n"
    if file_summary:
        session_body += file_summary + "\n"

    # Task state snippet (first 5 lines)
    task_snippet = ""
    if tasks_md:
        task_lines = [l for l in tasks_md.splitlines() if l.strip()][:5]
        if task_lines:
            task_snippet = "\n### Task State\n" + "\n".join(task_lines) + "\n"

    m1_content = f"""# M1 State
STATUS: IDLE
UPDATED: {iso_str}
OPERATOR: croppy (claude.ai)

## SESSION SUMMARY ({date_str})

{session_body}{task_snippet}
## NEXT_ACTION
Ask DJ
"""

    os.makedirs(os.path.dirname(m1_path), exist_ok=True)
    with open(m1_path, "w") as f:
        f.write(m1_content)
    log(f"M1.md updated: STATUS=IDLE, UPDATED={iso_str}")

def _run():
    log("Stop hook fired")
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M")

    # Read memory files
    memory_md = read_file(os.path.join(MEMORY_DIR, "MEMORY.md"))
    arch_md = read_file(os.path.join(MEMORY_DIR, "architecture.md"))
    lessons_md = read_file(os.path.join(MEMORY_DIR, "lessons.md"))
    tasks_md = read_file(os.path.join(MEMORY_DIR, "task-state.md"))

    # Git state
    git_status = run_cmd("git status --short", cwd=PROJECT_DIR)
    git_branch = run_cmd("git branch --show-current", cwd=PROJECT_DIR)
    git_log = run_cmd("git log --oneline -5", cwd=PROJECT_DIR)
    git_diff_stat = run_cmd("git diff --stat", cwd=PROJECT_DIR)

    # M1 state
    m1_state = read_file(os.path.join(PROJECT_DIR, "autonomous/state/M1.md"))

    # Build HANDOFF
    bt = chr(96) * 3  # backtick fence
    uncommitted = len(git_status.splitlines()) if git_status else 0
    diff_part = f"- Diff stats:\n{bt}\n{git_diff_stat}\n{bt}" if git_diff_stat else ""

    lines = [
        f"# Auto-HANDOFF {date_str} {time_str}",
        "*Generated by Stop hook (auto-handoff.py)*",
        "",
        "---",
        "",
        "## Git State",
        f"- Branch: {git_branch}",
        f"- Uncommitted: {uncommitted} files",
        bt,
        git_status or "(clean)",
        bt,
        "- Recent commits:",
        bt,
        git_log,
        bt,
        diff_part,
        "",
        "---",
        "",
        "## M1 State",
        bt,
        m1_state or "(not found)",
        bt,
        "",
        "---",
        "",
        "## Memory Snapshot",
        "",
        "### MEMORY.md",
        memory_md,
        "",
        "### Task State",
        tasks_md,
        "",
        "### Architecture Decisions",
        arch_md,
        "",
        "### Lessons Learned",
        lessons_md,
    ]
    handoff = "\n".join(lines)

    # 1. Save to Journal (Dropbox) - append (multiple sessions per day)
    os.makedirs(JOURNAL_DIR, exist_ok=True)
    journal_path = os.path.join(JOURNAL_DIR, f"auto-handoff-{date_str}.md")
    with open(journal_path, "a") as f:
        f.write(handoff + "\n\n---\n\n")
    log(f"Journal saved: {journal_path}")

    # 2. Save to docs/ (git repo) - overwrite (latest session wins)
    docs_dir = os.path.join(PROJECT_DIR, "docs")
    os.makedirs(docs_dir, exist_ok=True)
    docs_path = os.path.join(docs_dir, f"HANDOFF_{date_str}.md")
    with open(docs_path, "w") as f:
        f.write(handoff + "\n")
    log(f"docs/ saved: {docs_path}")

    # Sync memory -> croppy-notes
    sync_script = os.path.join(PROJECT_DIR, "scripts/memory-sync.sh")
    if os.path.exists(sync_script):
        run_cmd(f"bash {sync_script}")
        log("memory-sync executed")

    # Auto-update M1.md
    try:
        update_m1_state()
    except Exception as e:
        log(f"M1.md update failed: {e}")

    # Telegram通知: セッション完了
    # デフォルトは通知OFF。session-end-notify.shが別途通知するため二重通知防止。
    # 明示的に AUTO_HANDOFF_NOTIFY=1 を設定した場合のみ送信する。
    if os.environ.get("AUTO_HANDOFF_NOTIFY") == "1":
        try:
            env = {}
            env_path = os.path.join(PROJECT_DIR, ".env")
            if os.path.exists(env_path):
                with open(env_path) as ef:
                    for line in ef:
                        line = line.strip()
                        if "=" in line and not line.startswith("#"):
                            k, v = line.split("=", 1)
                            env[k.strip()] = v.strip().strip('"').strip("'")
            token = env.get("TELEGRAM_BOT_TOKEN", "")
            chat_id = env.get("TELEGRAM_ALLOWED_USERS", "")
            if token and chat_id:
                import urllib.request, urllib.parse
                msg = "\U0001F99E Claude Code セッション完了\n" + datetime.now().strftime("%H:%M JST")
                data = urllib.parse.urlencode({"chat_id": chat_id, "text": msg}).encode()
                req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data)
                urllib.request.urlopen(req, timeout=10)
                log("Telegram notified")
            else:
                log("Telegram: missing token/chat_id")
        except Exception as e:
            log(f"Telegram notify failed: {e}")
    else:
        log("Telegram notify skipped (AUTO_HANDOFF_NOTIFY != 1)")

    log("Done")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"ERROR: {e}")
        sys.exit(0)  # Always exit 0 - Stop hooks should not block
