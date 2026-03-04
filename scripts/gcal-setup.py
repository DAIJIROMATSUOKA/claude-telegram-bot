#!/usr/bin/env python3
"""
Google Calendar OAuth初回セットアップ
実行方法: python3 scripts/gcal-setup.py
事前準備:
  1. Google Cloud Console → API とサービス → 認証情報
  2. 「認証情報を作成」→「OAuth クライアント ID」→「デスクトップ アプリ」
  3. JSONをダウンロード → ~/.claude/gcal-credentials.json として保存
"""

import os
import sys

CREDENTIALS_PATH = os.path.expanduser("~/.claude/gcal-credentials.json")
TOKEN_PATH = os.path.expanduser("~/.claude/gcal-token.json")
SCOPES = [
    "https://www.googleapis.com/auth/calendar",  # 読み書きフル
]

def main():
    if not os.path.exists(CREDENTIALS_PATH):
        print(f"❌ 認証情報ファイルが見つからない: {CREDENTIALS_PATH}")
        print()
        print("手順:")
        print("  1. https://console.cloud.google.com/ を開く")
        print("  2. プロジェクトを選択（または新規作成）")
        print("  3. 「APIとサービス」→「ライブラリ」→「Google Calendar API」を有効化")
        print("  4. 「APIとサービス」→「認証情報」→「認証情報を作成」")
        print("  5. 「OAuthクライアントID」→「デスクトップアプリ」→作成")
        print("  6. JSONをダウンロード → ~/.claude/gcal-credentials.json として保存")
        sys.exit(1)

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
    except ImportError:
        print("依存パッケージをインストール中...")
        os.system("pip3 install google-auth google-auth-oauthlib google-api-python-client --break-system-packages -q")
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials

    # 既存トークンのチェック
    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
        if creds and creds.valid:
            print(f"✅ 既存トークンが有効: {TOKEN_PATH}")
            _verify_access(creds)
            return
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            print("✅ トークンをリフレッシュ")
            _save_token(creds)
            _verify_access(creds)
            return

    # 新規認証フロー
    print("ブラウザでGoogleアカウントの認証を行います...")
    flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
    creds = flow.run_local_server(port=0, open_browser=True)
    _save_token(creds)
    print(f"✅ トークン保存完了: {TOKEN_PATH}")
    _verify_access(creds)

def _save_token(creds):
    with open(TOKEN_PATH, "w") as f:
        f.write(creds.to_json())
    os.chmod(TOKEN_PATH, 0o600)

def _verify_access(creds):
    from googleapiclient.discovery import build
    service = build("calendar", "v3", credentials=creds)
    calendars = service.calendarList().list().execute()
    items = calendars.get("items", [])
    print(f"\n✅ アクセス確認完了。カレンダー一覧 ({len(items)}件):")
    for cal in items[:10]:
        primary = " ← PRIMARY" if cal.get("primary") else ""
        print(f"  - {cal['summary']}{primary}  (id: {cal['id']})")

if __name__ == "__main__":
    main()
