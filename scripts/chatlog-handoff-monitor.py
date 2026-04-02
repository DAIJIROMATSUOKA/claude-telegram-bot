#!/usr/bin/env python3
"""
chatlog-handoff-monitor.py
5分ごとに全ドメインのchatlogサイズを確認し、閾値超過で --activate を発火。
claude.ai直接使用時もhandoffが機能するようにする。
"""
import json, os, subprocess, sys, time
from pathlib import Path

PROJECT_DIR = os.path.expanduser("~/claude-telegram-bot")
HANDOFF_SCRIPT = f"{PROJECT_DIR}/scripts/domain-handoff.sh"
CHATLOG_STATE = os.path.expanduser("~/.claude-chatlog-state.json")
CHAT_ROUTER = f"{PROJECT_DIR}/scripts/chat-router.py"
LOG_FILE = "/tmp/chatlog-handoff-monitor.log"

# Thresholds
LINE_THRESHOLD = 1500      # chatlog lines ≈ 70% of context
COOLDOWN_SECS = 1800      # 30min: don't re-trigger same domain within this window
COOLDOWN_FILE = "/tmp/chatlog-handoff-cooldown.json"

def log(msg):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except: pass

def load_cooldowns():
    try:
        return json.load(open(COOLDOWN_FILE))
    except:
        return {}

def save_cooldowns(c):
    with open(COOLDOWN_FILE, "w") as f:
        json.dump(c, f)

def get_domain_chat_id(domain):
    """Get current chat ID for domain from chat-routing.yaml"""
    try:
        result = subprocess.run(
            ["python3", CHAT_ROUTER, "url", domain],
            capture_output=True, text=True, timeout=10
        )
        url = result.stdout.strip()
        if "/chat/" in url:
            return url.split("/chat/")[-1].split("?")[0]
    except: pass
    return None

def get_all_domains():
    try:
        result = subprocess.run(
            ["python3", CHAT_ROUTER, "list"],
            capture_output=True, text=True, timeout=10
        )
        return [line.strip() for line in result.stdout.strip().split("\n") if line.strip()]
    except: pass
    return []

def count_chatlog_lines(chat_id):
    try:
        state = json.load(open(CHATLOG_STATE))
        entry = state.get(chat_id)
        if not entry:
            return 0
        filepath = entry.get("filepath", "")
        if not filepath or not os.path.exists(filepath):
            return 0
        # Count lines
        with open(filepath, "r", errors="ignore") as f:
            return sum(1 for _ in f)
    except:
        return 0

def trigger_handoff(domain):
    log(f"Triggering --activate for {domain}")
    try:
        subprocess.Popen(
            ["bash", HANDOFF_SCRIPT, "--activate", domain],
            stdout=open(f"/tmp/chatlog-handoff-{domain}.log", "w"),
            stderr=subprocess.STDOUT
        )
        return True
    except Exception as e:
        log(f"ERROR triggering handoff for {domain}: {e}")
        return False

def main():
    log("chatlog-handoff-monitor started")
    cooldowns = load_cooldowns()
    now = time.time()

    # Skip domains that should never auto-handoff
    skip_domains = {"inbox", "direct", "forge-code", "forge-plc", "forge-vision", "forge-research"}

    # Check all domains
    try:
        state = json.load(open(CHATLOG_STATE))
    except:
        log("chatlog state not found, exiting")
        return

    # Get active chats from chat-routing.yaml
    domains = get_all_domains()
    if not domains:
        log("No domains found")
        return

    triggered = 0
    for domain in domains:
        if domain in skip_domains:
            continue

        # Check cooldown
        last_trigger = cooldowns.get(domain, 0)
        if now - last_trigger < COOLDOWN_SECS:
            remaining = int(COOLDOWN_SECS - (now - last_trigger))
            log(f"  {domain}: cooldown ({remaining}s remaining)")
            continue

        # Get current chat ID
        chat_id = get_domain_chat_id(domain)
        if not chat_id:
            continue

        # Count chatlog lines
        lines = count_chatlog_lines(chat_id)
        if lines == 0:
            continue

        log(f"  {domain} ({chat_id[:8]}): {lines} lines")

        if lines >= LINE_THRESHOLD:
            log(f"  -> THRESHOLD EXCEEDED ({lines} >= {LINE_THRESHOLD}), triggering handoff")
            if trigger_handoff(domain):
                cooldowns[domain] = now
                triggered += 1

    save_cooldowns(cooldowns)
    log(f"Done. Triggered: {triggered} handoffs")

if __name__ == "__main__":
    main()
