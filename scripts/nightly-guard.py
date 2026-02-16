#!/usr/bin/env python3
"""
nightly-guard.py — PreToolUse hook for nightly autonomous execution.
Blocks dangerous operations that the nightly runner should never do.
Exit 0 = allow, Exit 2 = block (stderr fed back to Claude).
"""
import sys
import os
import json
import re

BLOCKED_PATTERNS = [
    # Destructive
    (r'rm\s+-rf\s+/', "Blocked: rm -rf on root paths"),
    (r'rm\s+-rf\s+~', "Blocked: rm -rf on home directory"),
    (r'rm\s+-rf\s+\.\s', "Blocked: rm -rf on current directory"),
    # Git dangerous
    (r'git\s+push', "Blocked: git push not allowed in nightly mode"),
    (r'git\s+reset\s+--hard', "Blocked: git reset --hard"),
    (r'git\s+clean\s+-fd', "Blocked: git clean -fd"),
    (r'git\s+checkout\s+--\s+\.', "Blocked: git checkout -- ."),
    # Process management
    (r'kill\s+-9', "Blocked: kill -9"),
    (r'pkill', "Blocked: pkill"),
    (r'launchctl', "Blocked: launchctl modification"),
    (r'restart-bot\.sh', "Blocked: bot restart in nightly mode"),
    # Credentials
    (r'\.env', "Blocked: .env file access"),
    (r'TELEGRAM_BOT_TOKEN', "Blocked: credential access"),
    (r'API_KEY', "Blocked: API key access"),
    # Network
    (r'curl\s+.*api\.telegram', "Blocked: direct Telegram API calls"),
    (r'npm\s+publish', "Blocked: npm publish"),
    # System
    (r'sudo\s', "Blocked: sudo"),
    (r'chmod\s+777', "Blocked: chmod 777"),
    (r'crontab', "Blocked: crontab modification"),
]

def check_command(cmd):
    for pattern, msg in BLOCKED_PATTERNS:
        if re.search(pattern, cmd, re.IGNORECASE):
            return msg
    return None

def main():
    # Only active during nightly mode
    if not os.path.exists("/tmp/nightly-mode"):
        sys.exit(0)

    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # Can't parse, allow

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})

    # Only check Bash tool
    if tool_name != "Bash":
        sys.exit(0)

    command = tool_input.get("command", "")
    block_reason = check_command(command)

    if block_reason:
        print(block_reason, file=sys.stderr)
        sys.exit(2)  # Block

    sys.exit(0)  # Allow

if __name__ == "__main__":
    main()
