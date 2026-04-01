#!/usr/bin/env python3
"""Rename a claude.ai conversation via API.
Usage: rename-conversation.py <chat_uuid> <new_title>
"""
import json, urllib.request, sys, os

if len(sys.argv) < 3:
    print("usage: rename-conversation.py <chat_uuid> <title>", file=sys.stderr)
    sys.exit(1)

chat_uuid = sys.argv[1]
new_title = sys.argv[2]

cfg = json.load(open(os.path.expanduser("~/.claude-chatlog-config.json")))
sk, org = cfg["session_key"], cfg["org_id"]

url = f"https://claude.ai/api/organizations/{org}/chat_conversations/{chat_uuid}"
body = json.dumps({"name": new_title}).encode()
req = urllib.request.Request(url, data=body, method="PUT", headers={
    "Cookie": f"sessionKey={sk}",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://claude.ai/",
    "Origin": "https://claude.ai",
    "Content-Type": "application/json",
    "anthropic-client-sha": "unknown",
    "anthropic-client-platform": "web",
})
try:
    resp = urllib.request.urlopen(req)
    print(f"OK: renamed to {new_title}")
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
