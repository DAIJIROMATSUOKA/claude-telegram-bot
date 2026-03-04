#!/usr/bin/env python3
"""
gcal-todoist.py — Google Calendar + Todoist 統合スクリプト
Usage:
  python3 gcal-todoist.py today
  python3 gcal-todoist.py tomorrow
  python3 gcal-todoist.py week
  python3 gcal-todoist.py add "明日14時 打ち合わせ 松岡"
  python3 gcal-todoist.py task "タスク名"
  python3 gcal-todoist.py done <todoist_task_id>
  python3 gcal-todoist.py briefing     # 朝ブリーフィング用（cal+tasks統合）
"""

import sys
import os
import json
import datetime
from zoneinfo import ZoneInfo

# ===== 定数 =====
TOKEN_PATH = os.path.expanduser("~/.claude/gcal-token.json")
CREDENTIALS_PATH = os.path.expanduser("~/.claude/gcal-credentials.json")
CONFIG_PATH = os.path.expanduser("~/.claude/jarvis_config.json")
SCOPES = ["https://www.googleapis.com/auth/calendar"]
TZ = ZoneInfo("Asia/Tokyo")
TODOIST_API = "https://api.todoist.com/api/v1"

# ===== Google Calendar 認証 =====
def get_cal_service():
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
    except ImportError:
        os.system("pip3 install google-auth google-auth-oauthlib google-api-python-client --break-system-packages -q 2>/dev/null")
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build

    if not os.path.exists(TOKEN_PATH):
        print("❌ 未認証。まず: python3 scripts/gcal-setup.py を実行")
        sys.exit(1)

    creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())

    return build("calendar", "v3", credentials=creds)

# ===== Todoist token =====
def get_todoist_token():
    try:
        with open(CONFIG_PATH) as f:
            config = json.load(f)
        token = config.get("rules", {}).get("todoist", {}).get("api_token")
        if not token:
            raise ValueError("token not found")
        return token
    except Exception as e:
        print(f"❌ Todoistトークンが見つからない ({CONFIG_PATH}): {e}")
        sys.exit(1)

# ===== カレンダーイベント取得 =====
def get_events(service, date_start: datetime.date, date_end: datetime.date) -> list:
    """date_start から date_end（exclusive）までのイベントを取得"""
    time_min = datetime.datetime.combine(date_start, datetime.time.min, tzinfo=TZ).isoformat()
    time_max = datetime.datetime.combine(date_end, datetime.time.min, tzinfo=TZ).isoformat()

    result = service.events().list(
        calendarId="primary",
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy="startTime",
        maxResults=50,
    ).execute()

    events = []
    for e in result.get("items", []):
        start = e["start"].get("dateTime", e["start"].get("date", ""))
        end = e["end"].get("dateTime", e["end"].get("date", ""))
        is_allday = "T" not in start

        if is_allday:
            time_str = "終日"
        else:
            dt = datetime.datetime.fromisoformat(start).astimezone(TZ)
            dt_end = datetime.datetime.fromisoformat(end).astimezone(TZ)
            time_str = f"{dt.strftime('%H:%M')}〜{dt_end.strftime('%H:%M')}"

        events.append({
            "title": e.get("summary", "(無題)"),
            "time": time_str,
            "location": e.get("location", ""),
            "id": e.get("id", ""),
            "is_allday": is_allday,
            "start_dt": start,
        })

    return events

# ===== 日時表現をタイトルから除去 =====
import re as _re

def _strip_datetime_from_title(title: str) -> str:
    patterns = [
        r"(今日|明日|明後日|昨日)",
        r"(今週|来週|再来週|今月|来月)",
        r"(月曜|火曜|水曜|木曜|金曜|土曜|日曜)日?",
        r"\d{4}[/\-]\d{1,2}[/\-]\d{1,2}",
        r"\d{1,2}[/\-]\d{1,2}",
        r"(午前|午後)\d{1,2}時",
        r"\d{1,2}時\d{0,2}分?",
        r"\d{1,2}:\d{2}",
    ]
    result = title
    for p in patterns:
        result = _re.sub(p, "", result)
    return _re.sub(r"[\s\u3000]+", " ", result).strip()

# ===== イベント作成 =====
def create_event(service, text: str) -> str:
    """自然言語テキストからイベントを作成 (Google quickAdd 使用)"""
    result = service.events().quickAdd(
        calendarId="primary",
        text=text,
    ).execute()

    raw_summary = result.get("summary", "(無題)")
    clean_summary = _strip_datetime_from_title(raw_summary) or raw_summary
    if clean_summary != raw_summary:
        service.events().patch(
            calendarId="primary",
            eventId=result["id"],
            body={"summary": clean_summary},
        ).execute()
        result["summary"] = clean_summary

    start = result["start"].get("dateTime", result["start"].get("date", ""))
    is_allday = "T" not in start
    if is_allday:
        time_str = start
    else:
        dt = datetime.datetime.fromisoformat(start).astimezone(TZ)
        time_str = dt.strftime("%m/%d %H:%M")

    return f"\u2705 \u30a4\u30d9\u30f3\u30c8\u4f5c\u6210: {result.get('summary', '(\u7121\u984c)')} @ {time_str}\nID: {result['id']}"

# ===== Todoist タスク取得 =====
def get_todoist_tasks(token: str, filter_str: str = "today") -> list:
    import urllib.request
    url = f"{TODOIST_API}/tasks?filter={urllib.parse.quote(filter_str)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=10) as res:
        tasks = json.loads(res.read()).get("results", [])

    return [{"id": t["id"], "content": t["content"], "priority": t.get("priority", 1),
             "due": t.get("due", {}).get("string", "") if t.get("due") else ""} for t in tasks]

# ===== Todoist タスク追加 =====
def add_todoist_task(token: str, content: str) -> str:
    import urllib.request
    import urllib.parse
    data = json.dumps({"content": content, "due_string": "today"}).encode()
    req = urllib.request.Request(
        f"{TODOIST_API}/tasks",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        task = json.loads(res.read())
    return f"✅ タスク追加: {task['content']} (ID: {task['id']})"

# ===== Todoist タスク完了 =====
def complete_todoist_task(token: str, task_id: str) -> str:
    import urllib.request
    req = urllib.request.Request(
        f"{TODOIST_API}/tasks/{task_id}/close",
        data=b"",
        headers={"Authorization": f"Bearer {token}"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        pass  # 204 No Content
    return f"✅ タスク完了: {task_id}"

# ===== フォーマット =====
def format_events(events: list, label: str) -> str:
    if not events:
        return f"📅 {label}: 予定なし"

    lines = [f"📅 <b>{label}</b>"]
    for e in events:
        loc = f" 📍{e['location']}" if e["location"] else ""
        lines.append(f"  {e['time']} {e['title']}{loc}")
    return "\n".join(lines)

def format_tasks(tasks: list) -> str:
    if not tasks:
        return "✅ Todoist: タスクなし"

    priority_icon = {4: "🔴", 3: "🟠", 2: "🔵", 1: "⚪"}
    lines = ["📋 <b>今日のタスク</b>"]
    for t in tasks:
        icon = priority_icon.get(t["priority"], "⚪")
        lines.append(f"  {icon} {t['content']}  <code>{t['id']}</code>")
    return "\n".join(lines)

# ===== メイン =====
def main():
    import urllib.parse  # ensure available

    if len(sys.argv) < 2:
        print("Usage: gcal-todoist.py <today|tomorrow|week|add|task|done|briefing> [args...]")
        sys.exit(1)

    cmd = sys.argv[1].lower()
    today = datetime.date.today()

    # === today ===
    if cmd == "today":
        service = get_cal_service()
        token = get_todoist_token()
        events = get_events(service, today, today + datetime.timedelta(days=1))
        tasks = get_todoist_tasks(token, "today")
        print(format_events(events, f"今日 {today.strftime('%m/%d(%a)')}"))
        print()
        print(format_tasks(tasks))

    # === tomorrow ===
    elif cmd == "tomorrow":
        service = get_cal_service()
        tomorrow = today + datetime.timedelta(days=1)
        events = get_events(service, tomorrow, tomorrow + datetime.timedelta(days=1))
        token = get_todoist_token()
        tasks = get_todoist_tasks(token, "tomorrow")
        print(format_events(events, f"明日 {tomorrow.strftime('%m/%d(%a)')}"))
        print()
        print(format_tasks(tasks))

    # === week ===
    elif cmd == "week":
        service = get_cal_service()
        end = today + datetime.timedelta(days=7)
        # 日ごとに取得してグループ化
        lines = [f"📅 <b>今週 ({today.strftime('%m/%d')}〜{end.strftime('%m/%d')})</b>"]
        current = today
        day_names = ["月", "火", "水", "木", "金", "土", "日"]
        while current < end:
            events = get_events(service, current, current + datetime.timedelta(days=1))
            if events:
                lines.append(f"\n<b>{current.strftime('%m/%d')}({day_names[current.weekday()]})</b>")
                for e in events:
                    lines.append(f"  {e['time']} {e['title']}")
            current += datetime.timedelta(days=1)
        print("\n".join(lines))

    # === add ===
    elif cmd == "add":
        if len(sys.argv) < 3:
            print("Usage: gcal-todoist.py add 'テキスト'")
            sys.exit(1)
        service = get_cal_service()
        text = " ".join(sys.argv[2:])
        print(create_event(service, text))

    # === task ===
    elif cmd == "task":
        if len(sys.argv) < 3:
            print("Usage: gcal-todoist.py task 'タスク名'")
            sys.exit(1)
        token = get_todoist_token()
        content = " ".join(sys.argv[2:])
        print(add_todoist_task(token, content))

    # === done ===
    elif cmd == "done":
        if len(sys.argv) < 3:
            print("Usage: gcal-todoist.py done <task_id>")
            sys.exit(1)
        token = get_todoist_token()
        print(complete_todoist_task(token, sys.argv[2]))

    # === briefing (朝ブリーフィング統合出力) ===
    elif cmd == "briefing":
        service = get_cal_service()
        token = get_todoist_token()
        tomorrow = today + datetime.timedelta(days=1)

        today_events = get_events(service, today, today + datetime.timedelta(days=1))
        tomorrow_events = get_events(service, tomorrow, tomorrow + datetime.timedelta(days=1))
        tasks = get_todoist_tasks(token, "today")[:10]

        day_names = ["月", "火", "水", "木", "金", "土", "日"]
        parts = []
        parts.append(f"🌅 <b>おはようございます</b> ({today.strftime('%m/%d')}({day_names[today.weekday()]}))")
        parts.append("")
        parts.append(format_events(today_events, f"今日 {today.strftime('%m/%d')}"))
        parts.append("")
        parts.append(format_events(tomorrow_events, f"明日 {tomorrow.strftime('%m/%d')}"))
        parts.append("")
        parts.append(format_tasks(tasks))
        print("\n".join(parts))

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)

if __name__ == "__main__":
    main()
