#!/usr/bin/env python3
"""WIP Tracker - 途中タスク管理"""
import sys, os, datetime

WIP_FILE = os.path.expanduser("~/claude-telegram-bot/autonomous/state/WIP.md")
os.makedirs(os.path.dirname(WIP_FILE), exist_ok=True)

TEMPLATE = """# WIP Tracker
# 🦞/Claude Code が更新。新チャットで必ず読む。

## 🔴 作業中 (In Progress)

## 🟡 ブロック中 (Blocked)

## ✅ 完了 (Done)
"""

def load():
    if not os.path.exists(WIP_FILE):
        with open(WIP_FILE, "w") as f:
            f.write(TEMPLATE)
    with open(WIP_FILE, "r") as f:
        return f.read()

def save(content):
    with open(WIP_FILE, "w") as f:
        f.write(content)

def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

def cmd_add(task, detail=""):
    content = load()
    if f"| {task} |" in content:
        print(f"ALREADY EXISTS: {task}")
        return
    marker = "## 🔴 作業中 (In Progress)"
    line = f"| {task} | {detail} | {now()} |"
    content = content.replace(marker, marker + "\n" + line)
    save(content)
    print(f"ADDED: {task}")

def cmd_done(task, result="完了"):
    content = load()
    lines = content.split("\n")
    new_lines = []
    found = False
    for line in lines:
        if f"| {task} |" in line:
            found = True
            continue
        new_lines.append(line)
    if not found:
        print(f"NOT FOUND: {task}")
        return
    result_lines = []
    for line in new_lines:
        result_lines.append(line)
        if "## ✅ 完了 (Done)" in line:
            result_lines.append(f"| {task} | {result} | {now()} |")
    save("\n".join(result_lines))
    print(f"DONE: {task}")

def cmd_block(task, reason):
    content = load()
    lines = content.split("\n")
    new_lines = []
    found = False
    for line in lines:
        if f"| {task} |" in line:
            found = True
            continue
        new_lines.append(line)
    if not found:
        print(f"NOT FOUND: {task}")
        return
    result_lines = []
    for line in new_lines:
        result_lines.append(line)
        if "## 🟡 ブロック中 (Blocked)" in line:
            result_lines.append(f"| {task} | {reason} | {now()} |")
    save("\n".join(result_lines))
    print(f"BLOCKED: {task}")

def cmd_clean():
    content = load()
    lines = content.split("\n")
    cutoff = (datetime.datetime.now() - datetime.timedelta(days=30)).strftime("%Y-%m-%d")
    new_lines = []
    in_done = False
    removed = 0
    for line in lines:
        if "## ✅ 完了 (Done)" in line:
            in_done = True
            new_lines.append(line)
            continue
        if in_done and line.startswith("|"):
            parts = line.split("|")
            if len(parts) >= 4:
                date_part = parts[3].strip()[:10]
                if date_part < cutoff:
                    removed += 1
                    continue
        if line.startswith("## ") and in_done:
            in_done = False
        new_lines.append(line)
    save("\n".join(new_lines))
    print(f"Cleaned {removed} old items")

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] == "list":
        print(load())
    elif args[0] == "add":
        cmd_add(args[1] if len(args) > 1 else "", args[2] if len(args) > 2 else "")
    elif args[0] == "done":
        cmd_done(args[1] if len(args) > 1 else "", args[2] if len(args) > 2 else "完了")
    elif args[0] == "block":
        cmd_block(args[1] if len(args) > 1 else "", args[2] if len(args) > 2 else "")
    elif args[0] == "clean":
        cmd_clean()
    else:
        print("Usage: wip.py {add|done|block|list|clean} [task] [detail]")
        sys.exit(1)
