#!/usr/bin/env python3
"""Create a new claude.ai chat via API. Prints UUID to stdout."""
import json, urllib.request, sys, os

proj_uuid = sys.argv[1] if len(sys.argv) > 1 else "019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"
cfg = json.load(open(os.path.expanduser("~/.claude-chatlog-config.json")))
sk, org = cfg["session_key"], cfg["org_id"]

url = f"https://claude.ai/api/organizations/{org}/chat_conversations"
body = json.dumps({"name": "", "project_uuid": proj_uuid}).encode()
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
