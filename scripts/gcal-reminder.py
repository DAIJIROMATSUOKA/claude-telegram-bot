#!/usr/bin/env python3
"""
gcal-reminder.py — Google Calendar リマインダー → Telegram通知
LaunchAgent (com.jarvis.gcal-reminder) から5分おきに実行される

通知タイミング:
  - 通常イベント: 15分前 & 5分前
  - 終日イベント: 当日08:00に通知（日付が変わった直後の実行で送信）

重複防止: /tmp/gcal-notified.json に {eventId_window: timestamp} を記録
"""

import sys
import os
import json
import datetime
import urllib.request
import urllib.parse
from zoneinfo import ZoneInfo
from pathlib import Path

# ===== 定数 =====
TOKEN_PATH = os.path.expanduser("~/.claude/gcal-token.json")
ENV_PATH = os.path.expanduser("~/claude-telegram-bot/.env")
NOTIFIED_PATH = "/tmp/gcal-notified.json"
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
TZ = ZoneInfo("Asia/Tokyo")

# 通知ウィンドウ（分前）- (ラベル, 何分前から, 何分前まで)
NOTIFY_WINDOWS = [
    ("15min", 16, 13),   # 16〜13分前の間に実行された場合 → 15分前通知
    ("5min",   6,  3),   # 6〜3分前の間に実行された場合  → 5分前通知
]
ALLDAY_NOTIFY_HOUR = 8   # 終日イベントは08:00台に通知
NOTIFIED_TTL_HOURS = 25  # 翌日には記録をクリア

# ===== .env 読み込み =====
def load_env():
    env = {}
    try:
        with open(ENV_PATH) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return env

# ===== Telegram送信 =====
def send_telegram(token: str, chat_id: str, text: str):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = json.dumps({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
    }).encode()
    req = urllib.request.Request(url, data=data,
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())

# ===== 通知済み記録 =====
def load_notified() -> dict:
    try:
        with open(NOTIFIED_PATH) as f:
            data = json.load(f)
        # TTL切れエントリを削除
        now_ts = datetime.datetime.now().timestamp()
        cutoff = now_ts - NOTIFIED_TTL_HOURS * 3600
        return {k: v for k, v in data.items() if v > cutoff}
    except Exception:
        return {}

def save_notified(data: dict):
    try:
        with open(NOTIFIED_PATH, "w") as f:
            json.dump(data, f)
    except Exception:
        pass

# ===== Google Calendar 認証 =====
def get_cal_service():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    if not os.path.exists(TOKEN_PATH):
        print("❌ gcal token not found")
        sys.exit(1)

    creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())

    return build("calendar", "v3", credentials=creds)

# ===== イベント取得 =====
def get_upcoming_events(service) -> list:
    """今から60分以内に開始するイベントを取得（終日含む）"""
    now = datetime.datetime.now(tz=TZ)
    time_min = now.isoformat()
    time_max = (now + datetime.timedelta(minutes=60)).isoformat()
    today = now.date()

    result = service.events().list(
        calendarId="primary",
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy="startTime",
        maxResults=20,
    ).execute()

    events = []
    for e in result.get("items", []):
        start_raw = e["start"].get("dateTime", e["start"].get("date", ""))
        is_allday = "T" not in start_raw

        if is_allday:
            # 終日イベント: 当日かどうか確認
            event_date = datetime.date.fromisoformat(start_raw)
            if event_date != today:
                continue
            events.append({
                "id": e["id"],
                "title": e.get("summary", "(無題)"),
                "is_allday": True,
                "start_dt": None,
                "location": e.get("location", ""),
            })
        else:
            start_dt = datetime.datetime.fromisoformat(start_raw).astimezone(TZ)
            events.append({
                "id": e["id"],
                "title": e.get("summary", "(無題)"),
                "is_allday": False,
                "start_dt": start_dt,
                "location": e.get("location", ""),
            })

    return events

# ===== メイン =====
def main():
    env = load_env()
    bot_token = env.get("TELEGRAM_BOT_TOKEN")
    chat_id = env.get("TELEGRAM_ALLOWED_USERS")

    if not bot_token or not chat_id:
        print("❌ TELEGRAM_BOT_TOKEN or TELEGRAM_ALLOWED_USERS not set")
        sys.exit(1)

    try:
        from google.oauth2.credentials import Credentials
    except ImportError:
        os.system("pip3 install google-auth google-auth-oauthlib google-api-python-client --break-system-packages -q 2>/dev/null")

    service = get_cal_service()
    now = datetime.datetime.now(tz=TZ)
    notified = load_notified()
    sent_count = 0

    events = get_upcoming_events(service)

    for ev in events:
        event_id = ev["id"]

        if ev["is_allday"]:
            # 終日イベント: ALLDAY_NOTIFY_HOUR 台に1回のみ
            if now.hour != ALLDAY_NOTIFY_HOUR:
                continue
            key = f"{event_id}_allday_{now.date()}"
            if key in notified:
                continue
            msg = f"📅 <b>終日イベント</b>\n{ev['title']}"
            if ev["location"]:
                msg += f"\n📍 {ev['location']}"
            send_telegram(bot_token, chat_id, msg)
            notified[key] = now.timestamp()
            sent_count += 1

        else:
            start_dt = ev["start_dt"]
            minutes_until = (start_dt - now).total_seconds() / 60

            for label, upper, lower in NOTIFY_WINDOWS:
                if not (lower <= minutes_until <= upper):
                    continue
                key = f"{event_id}_{label}"
                if key in notified:
                    continue

                # 通知メッセージ
                mins = int(round(minutes_until))
                time_str = start_dt.strftime("%H:%M")
                if label == "5min":
                    prefix = f"⏰ <b>あと{mins}分</b>"
                else:
                    prefix = f"📅 <b>あと{mins}分</b>"

                msg = f"{prefix}\n{ev['title']}  {time_str}〜"
                if ev["location"]:
                    msg += f"\n📍 {ev['location']}"

                send_telegram(bot_token, chat_id, msg)
                notified[key] = now.timestamp()
                sent_count += 1

    save_notified(notified)
    if sent_count:
        print(f"[gcal-reminder] Sent {sent_count} notification(s)")
    else:
        print(f"[gcal-reminder] No notifications ({len(events)} events checked)")

if __name__ == "__main__":
    main()
