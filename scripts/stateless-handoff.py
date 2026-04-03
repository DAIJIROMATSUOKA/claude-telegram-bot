#!/usr/bin/env python3
"""Create a new claude.ai chat via API. Optionally set name.
Usage: stateless-handoff.py [project_uuid] [--name "chat name"]
Prints UUID to stdout.
"""
import json, urllib.request, sys, os

args = [a for a in sys.argv[1:] if not a.startswith("--")]
flags = {sys.argv[i]: sys.argv[i+1] for i in range(1, len(sys.argv)-1) if sys.argv[i].startswith("--")}

proj_uuid = args[0] if args else "019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"
chat_name = flags.get("--name", "")

cfg = json.load(open(os.path.expanduser("~/.claude-chatlog-config.json")))
sk, org = cfg["session_key"], cfg["org_id"]

url = f"https://claude.ai/api/organizations/{org}/chat_conversations"
body = json.dumps({"name": chat_name, "project_uuid": proj_uuid, "model": "claude-opus-4-6"}).encode()
req = urllib.request.Request(url, data=body, method="POST", headers={
    "Cookie": f"sessionKey={sk}",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://claude.ai/",
    "Origin": "https://claude.ai",
    "Content-Type": "application/json",
    "anthropic-client-sha": "unknown",
    "anthropic-client-platform": "web",
})
resp = urllib.request.urlopen(req)
data = json.loads(resp.read())
print(data["uuid"])
