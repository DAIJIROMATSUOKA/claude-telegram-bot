#!/usr/bin/env python3
"""tg-notify.py - Send Telegram message reading .env for credentials.
Usage: python3 tg-notify.py <env_file> <msg_file>
"""
import sys, urllib.request, urllib.parse, json

if len(sys.argv) < 3:
    print("Usage: tg-notify.py <env_file> <msg_file>")
    sys.exit(1)

env_file = sys.argv[1]
msg_file = sys.argv[2]

# Read .env
env = {}
with open(env_file) as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k] = v

token = env.get('TELEGRAM_BOT_TOKEN', '')
chat = env.get('TELEGRAM_ALLOWED_USERS', '')

if not token or not chat:
    print(f"TG ERROR: missing token(len={len(token)}) or chat_id({chat})")
    sys.exit(1)

# Read message
with open(msg_file, encoding='utf-8') as f:
    msg = f.read().strip()

if not msg:
    print("TG ERROR: empty message")
    sys.exit(1)

# Send
data = urllib.parse.urlencode({'chat_id': chat, 'text': msg}).encode('utf-8')
req = urllib.request.Request(
    f'https://api.telegram.org/bot{token}/sendMessage',
    data=data
)

try:
    resp = json.loads(urllib.request.urlopen(req).read().decode())
    if resp.get('ok'):
        print('TG OK')
    else:
        print(f"TG FAIL: {resp.get('description', 'unknown')}")
        sys.exit(1)
except Exception as e:
    print(f"TG ERROR: {e}")
    sys.exit(1)
