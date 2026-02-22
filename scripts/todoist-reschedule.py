#!/usr/bin/env python3
"""Helper for croppy-dispatch.sh: /todoist reschedule [YYYY-MM-DD]"""
import json, sys, requests
from datetime import datetime, timedelta

TARGET = sys.argv[1] if len(sys.argv) > 1 else (datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')

with open('/Users/daijiromatsuokam1/.claude/jarvis_config.json') as f:
    config = json.load(f)
tk = config['rules']['todoist']['api_token']
hd = {'Authorization': f'Bearer {tk}'}
API = 'https://api.todoist.com/api/v1'

all_t = []
cur = None
while True:
    p = {'query': 'overdue'}
    if cur: p['cursor'] = cur
    r = requests.get(f'{API}/tasks/filter', headers=hd, params=p)
    r.raise_for_status()
    d = r.json()
    all_t.extend(d.get('results', []))
    cur = d.get('next_cursor')
    if not cur: break

if not all_t:
    print('No overdue tasks.')
    sys.exit(0)

ok = ng = 0
for t in all_t:
    ds = (t.get('due') or {}).get('date', '')
    if 'T' in ds:
        tp = ds.split('T')[1] or '00:00:00Z'
        pl = {'due_datetime': f'{TARGET}T{tp}'}
    else:
        pl = {'due_date': TARGET}
    try:
        r = requests.post(f'{API}/tasks/{t["id"]}', headers=hd, json=pl)
        r.raise_for_status()
        ok += 1
    except:
        ng += 1

print(f'Done: {ok}/{len(all_t)} -> {TARGET}' + (f' ({ng} errors)' if ng else ''))
