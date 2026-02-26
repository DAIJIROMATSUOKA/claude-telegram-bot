#!/usr/bin/env python3
"""X (Twitter) Search Fetcher - uses existing Chrome session via AppleScript
Usage: python3 x-fetch.py "search query" [max_tweets]
No API keys needed. Uses DJ's logged-in Chrome session.
"""
import subprocess, sys, tempfile, os, json

query = sys.argv[1] if len(sys.argv) > 1 else 'Claude Code OR OpenClaw'
max_tweets = int(sys.argv[2]) if len(sys.argv) > 2 else 15
q = query.replace(' ', '+')
url = f'https://x.com/search?q={q}&f=live'

# JS: extract tweets, close tab after
js = (
    f"var t=document.querySelectorAll('[data-testid=tweetText]');"
    f"var r=[];"
    f"for(var i=0;i<Math.min(t.length,{max_tweets});i++){{"
    f"r.push((i+1)+String.fromCharCode(46,32)+t[i].textContent)}}"
    f"r.join(String.fromCharCode(10))"
)

# AppleScript: open tab, wait, extract, close tab
lines = [
    'tell application "Google Chrome"',
    f'    set newTab to make new tab at end of tabs of window 1 with properties {{URL:"{url}"}}',
    '    delay 8',
    f'    set pageData to execute newTab javascript "{js}"',
    '    close newTab',
    '    return pageData',
    'end tell',
]
ascript = '\n'.join(lines) + '\n'

tmp = tempfile.NamedTemporaryFile(mode='w', suffix='.applescript', delete=False)
tmp.write(ascript)
tmp.close()

result = subprocess.run(['osascript', tmp.name], capture_output=True, text=True, timeout=45)
os.unlink(tmp.name)

if result.returncode == 0:
    output = result.stdout.strip()
    if output:
        print(f"=== X Search: {query} ({url}) ===")
        print(output)
        print(f"=== {len(output.splitlines())} tweets fetched ===")
    else:
        print("No tweets found (page may not have loaded)")
        sys.exit(1)
else:
    print('ERROR:', result.stderr, file=sys.stderr)
    sys.exit(1)
