#!/usr/bin/env python3
"""
telegram-notify.py - LINE notification sender (drop-in replacement for Telegram version)
Usage: python3 telegram-notify.py "message text"
   or: echo "message" | python3 telegram-notify.py -
   or: python3 telegram-notify.py --file /path/to/file.txt
Exit 0 on success, 1 on failure.
"""
import sys, os, json, urllib.request

def load_env(env_path):
    env = {}
    try:
        for line in open(env_path):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k] = v.strip('"').strip("'")
    except:
        pass
    return env

def send_line(token, user_id, text):
    text = text[:5000]  # LINE limit
    data = json.dumps({
        "to": user_id,
        "messages": [{"type": "text", "text": text}]
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://api.line.me/v2/bot/message/push',
        data=data,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {token}'
        },
        method='POST'
    )
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return resp.status == 200
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        return False

def main():
    env_path = os.path.expanduser('~/.jarvis-line-env')
    env = load_env(env_path)
    token = env.get('LINE_CHANNEL_TOKEN', '')
    user_id = env.get('LINE_USER_ID', '')

    if not token or not user_id:
        print('ERROR: ~/.jarvis-line-env missing LINE_CHANNEL_TOKEN or LINE_USER_ID', file=sys.stderr)
        sys.exit(1)

    # Parse args
    if len(sys.argv) > 1 and sys.argv[1] == '--file':
        if len(sys.argv) < 3:
            print('Usage: --file <path>', file=sys.stderr)
            sys.exit(1)
        with open(sys.argv[2], 'r') as f:
            msg = f.read().strip()
    elif len(sys.argv) > 1 and sys.argv[1] == '-':
        msg = sys.stdin.read().strip()
    elif len(sys.argv) > 1:
        msg = ' '.join(sys.argv[1:])
    else:
        msg = sys.stdin.read().strip()

    if not msg:
        print('No message to send', file=sys.stderr)
        sys.exit(1)

    # LINE 5000 char limit - split if needed
    chunks = [msg[i:i+5000] for i in range(0, len(msg), 5000)]
    ok = True
    for chunk in chunks:
        if not send_line(token, user_id, chunk):
            ok = False
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
