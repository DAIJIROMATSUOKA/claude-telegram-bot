#!/usr/bin/env python3
"""
auto-memory-sync.py - Claude Code Stop hook
Fires when a Claude Code session ends.
Updates Auto Memory files so next session starts with fresh context.
Also appends to Journal (Dropbox) for history.

Replaces: auto-handoff.py (HANDOFF generation)
"""
import os
import sys
import subprocess
import fcntl
import time
import re
from datetime import datetime
from pathlib import Path

# Paths
PROJECT_DIR = os.environ.get("CLAUDE_PROJECT_DIR", os.path.expanduser("~/claude-telegram-bot"))
MEMORY_DIR = os.path.expanduser("~/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory")
JOURNAL_DIR = os.path.expanduser("~/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian/90_System/JARVIS/Journal")
WIP_FILE = os.path.join(PROJECT_DIR, "Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian/90_System/JARVIS/WIP.md")
DESIGN_RULES = os.path.join(PROJECT_DIR, "docs/DESIGN-RULES.md")
FEATURE_CATALOG = os.path.join(PROJECT_DIR, "docs/FEATURE-CATALOG.md")
LOG_FILE = "/tmp/auto-memory-sync.log"
LOCK_FILE = "/tmp/auto-memory-sync.lock"

def log(msg):
    with open(LOG_FILE, "a") as f:
        f.write(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}\n")

def read_file(path, default=""):
    try:
        return Path(path).read_text()
    except Exception:
        return default

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Path(path).write_text(content)

def run_cmd(cmd, cwd=None):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10, cwd=cwd)
        return r.stdout.strip()
    except Exception:
        return ""

def main():
    # Dedup: skip if ran within last 5 seconds
    STAMP_FILE = "/tmp/auto-memory-sync.stamp"
    try:
        if os.path.exists(STAMP_FILE):
            age = time.time() - os.path.getmtime(STAMP_FILE)
            if age < 5:
                return
    except Exception:
        pass

    # fcntl lock
    lock_fd = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return
    try:
        Path(STAMP_FILE).touch()
        _run()
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()

def _run():
    log("Stop hook fired - syncing Auto Memory")
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")

    # === 1. Update task-state.md from WIP + git ===
    update_task_state(date_str)

    # === 2. Update lessons.md from DESIGN-RULES §8 ===
    update_lessons(date_str)

    # === 3. Update architecture.md with recent decisions ===
    update_architecture(date_str)

    # === 4. Append to Journal (Dropbox) for history ===
    append_journal(date_str)

    log("Auto Memory sync complete")

def update_task_state(date_str):
    """Sync WIP.md + git status → memory/task-state.md"""
    wip = read_file(WIP_FILE)
    git_status = run_cmd("git status --short", cwd=PROJECT_DIR)
    git_log = run_cmd("git log --oneline -5", cwd=PROJECT_DIR)
    uncommitted = len(git_status.splitlines()) if git_status else 0

    # Parse WIP sections
    in_progress = []
    blocked = []
    done = []
    current_section = None
    for line in wip.splitlines():
        if "作業中" in line:
            current_section = "active"
        elif "ブロック中" in line:
            current_section = "blocked"
        elif "完了" in line:
            current_section = "done"
        elif line.startswith("|") and current_section and "---" not in line and "タスク" not in line:
            parts = [p.strip() for p in line.split("|") if p.strip()]
            if parts:
                label = parts[0]
                note = parts[1] if len(parts) > 1 else ""
                if current_section == "active":
                    in_progress.append(f"- [ ] {label} — {note}")
                elif current_section == "blocked":
                    blocked.append(f"- [~] {label} — {note}")
                elif current_section == "done":
                    done.append(f"- [x] {label} — {note}")

    content = f"""# Task State (Updated {date_str})

## Active
{chr(10).join(in_progress) if in_progress else "- (none)"}

## Blocked
{chr(10).join(blocked) if blocked else "- (none)"}

## Recently Completed
{chr(10).join(done[:10]) if done else "- (none)"}

## Git State
- Uncommitted: {uncommitted} files
- Recent commits:
```
{git_log}
```
"""
    write_file(os.path.join(MEMORY_DIR, "task-state.md"), content)
    log(f"task-state.md updated ({len(in_progress)} active, {len(blocked)} blocked, {len(done)} done)")

def update_lessons(date_str):
    """Extract lessons from DESIGN-RULES.md §8 → memory/lessons.md"""
    rules = read_file(DESIGN_RULES)

    # Extract section 8
    match = re.search(r'## 8\. 蓄積された教訓\n(.*?)(?=\n## \d+\.|\Z)', rules, re.DOTALL)
    if not match:
        log("lessons: section 8 not found in DESIGN-RULES")
        return

    lessons_section = match.group(1).strip()

    content = f"""# Lessons Learned (Updated {date_str})
*Auto-synced from DESIGN-RULES.md §8*

{lessons_section}
"""
    write_file(os.path.join(MEMORY_DIR, "lessons.md"), content)
    log("lessons.md updated from DESIGN-RULES")

def update_architecture(date_str):
    """Keep architecture.md fresh with recent feature info"""
    existing = read_file(os.path.join(MEMORY_DIR, "architecture.md"))
    catalog = read_file(FEATURE_CATALOG)

    # Extract recent features from FEATURE-CATALOG (last 5 entries with dates)
    recent_features = []
    for line in catalog.splitlines():
        if line.startswith('### '):
            recent_features.append(line[4:].strip())

    # Only update if we have new info
    feature_list = "\n".join(f"- {f}" for f in recent_features[-10:]) if recent_features else "(see FEATURE-CATALOG.md)"

    # Preserve existing decisions, append feature summary
    if "## Recent Features" in existing:
        existing = re.sub(r'## Recent Features.*', '', existing, flags=re.DOTALL)

    content = existing.rstrip() + f"""

## Recent Features (Updated {date_str})
{feature_list}
"""
    write_file(os.path.join(MEMORY_DIR, "architecture.md"), content)
    log("architecture.md updated")

def append_journal(date_str):
    """Append session summary to Journal (Dropbox) for history"""
    git_log = run_cmd("git log --oneline -5", cwd=PROJECT_DIR)
    git_status = run_cmd("git status --short", cwd=PROJECT_DIR)
    wip = read_file(WIP_FILE)
    time_str = datetime.now().strftime("%H:%M")

    entry = f"""## Session End {date_str} {time_str}

### Git
```
{git_log}
```
{f"Uncommitted: {git_status}" if git_status else "Clean worktree"}

### WIP Snapshot
{wip[:500] if wip else "(empty)"}

---

"""
    os.makedirs(JOURNAL_DIR, exist_ok=True)
    journal_path = os.path.join(JOURNAL_DIR, f"auto-handoff-{date_str}.md")
    with open(journal_path, "a") as f:
        f.write(entry)
    log(f"Journal appended: {journal_path}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"ERROR: {e}")
        sys.exit(0)  # Always exit 0
