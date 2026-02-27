#!/usr/bin/env python3
"""
telegram-notify.py - Reliable Telegram message sender
Usage: python3 telegram-notify.py "message text"
   or: echo "message" | python3 telegram-notify.py -
   or: python3 telegram-notify.py --file /path/to/file.txt
Exit 0 on success, 1 on failure.
"""
import sys, os, json, urllib.request, urllib.parse

def load_env(env_path):
    env = {}
    try:
        for line in open(env_path):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k] = v
    except:
        pass
    return env

def send_telegram(token, chat_id, text):
    text = text[:3800]  # Telegram limit ~4096, leave margin
    data = urllib.parse.urlencode({'chat_id': chat_id, 'text': text}).encode('utf-8')
    url = f'https://api.telegram.org/bot{token}/sendMessage'
    req = urllib.request.Request(url, data=data, method='POST')
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())
        return result.get('ok', False)
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        return False

def main():
    env_path = os.path.expanduser('~/claude-telegram-bot/.env')
    env = load_env(env_path)
    token = env.get('TELEGRAM_BOT_TOKEN', '')
    chat_id = env.get('TELEGRAM_ALLOWED_USERS', '')

    if not token or not chat_id:
        print('ERROR: Missing TELEGRAM_BOT_TOKEN or TELEGRAM_ALLOWED_USERS', file=sys.stderr)
        sys.exit(1)

    # Read message from arg, file, or stdin
    if len(sys.argv) > 1:
        if sys.argv[1] == '-':
            text = sys.stdin.buffer.read().decode('utf-8', errors='ignore')
        elif sys.argv[1] == '--file' and len(sys.argv) > 2:
            with open(sys.argv[2], 'rb') as f:
                text = f.read().decode('utf-8', errors='ignore')
        else:
            text = sys.argv[1]
    else:
        text = sys.stdin.buffer.read().decode('utf-8', errors='ignore')

    if not text.strip():
        print('ERROR: Empty message', file=sys.stderr)
        sys.exit(1)

    if send_telegram(token, chat_id, text):
        print('OK')
        sys.exit(0)
    else:
        print('FAIL', file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
