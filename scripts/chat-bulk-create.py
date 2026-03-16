#!/usr/bin/env python3
"""
chat-bulk-create.py — 専門チャット一括作成
場所: ~/claude-telegram-bot/scripts/chat-bulk-create.py

フロー（各ドメインごと）:
  1. プロジェクトURLをChrome新タブで開く（→新チャット自動生成）
  2. READY待ち
  3. bootstrap promptをinject
  4. 応答待ち（Claudeが文脈を理解するまで）
  5. タブURLからchat_id取得
  6. chatlog-api.pyのrename APIでタイトル設定
  7. chat-routing.yamlにURL書き込み

Usage:
  python3 chat-bulk-create.py                    # 未作成ドメインを全部作成
  python3 chat-bulk-create.py inbox fa vision     # 指定ドメインのみ作成
  python3 chat-bulk-create.py --dry-run           # 作成予定の一覧表示のみ
"""

import sys
import os
import time
import subprocess
import tempfile
from datetime import datetime

import yaml

YAML_PATH = os.path.expanduser("~/claude-telegram-bot/autonomous/state/chat-routing.yaml")
TAB_MANAGER = os.path.expanduser("~/claude-telegram-bot/scripts/croppy-tab-manager.sh")

# Timing
LOAD_WAIT = 10        # 新タブ読み込み待ち（秒）
READY_CHECKS = 3      # 安定READY判定の連続回数
READY_INTERVAL = 2    # READY判定の間隔（秒）
READY_TIMEOUT = 60    # READY待ちタイムアウト（秒）
RESPONSE_TIMEOUT = 120  # bootstrap応答待ちタイムアウト（秒）
BETWEEN_DOMAINS = 5   # ドメイン間の待ち時間（秒）


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def run(cmd, **kwargs):
    """シェルコマンド実行"""
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, **kwargs)
    return r.stdout.strip(), r.stderr.strip(), r.returncode


def load_yaml():
    with open(YAML_PATH, "r") as f:
        return yaml.safe_load(f)


def save_yaml(cfg):
    with open(YAML_PATH, "w") as f:
        yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    # Auto-sync Obsidian chat list (same as chat-router.py)
    try:
        import subprocess
        subprocess.run(
            ["python3", os.path.expanduser("~/claude-telegram-bot/scripts/chat-router.py"), "sync-obsidian"],
            timeout=5, capture_output=True
        )
    except:
        pass


def rename_chat_chrome(wt, new_title):
    """Chrome JS経由でチャットタイトルを変更（tab-manager rename-conversation）"""
    out, _, rc = run(f'bash "{TAB_MANAGER}" rename-conversation "{wt}" "{new_title}"')
    if "200:" in out:
        log(f"  RENAMED: {new_title[:60]}")
        return True
    else:
        log(f"  RENAME: {out}")
        return False


def check_status(wt):
    """タブのステータス確認（READY/BUSY/NO_EDITOR）"""
    out, _, _ = run(f'bash "{TAB_MANAGER}" check-status "{wt}"')
    return out.strip()


def wait_ready(wt, timeout=READY_TIMEOUT):
    """安定READY待ち（3連続チェック）"""
    ready_count = 0
    elapsed = 0
    while elapsed < timeout:
        status = check_status(wt)
        if status == "READY":
            ready_count += 1
            if ready_count >= READY_CHECKS:
                return True
        else:
            ready_count = 0
        time.sleep(READY_INTERVAL)
        elapsed += READY_INTERVAL
    return False


def inject_bootstrap(wt, bootstrap_text):
    """bootstrap promptをinject"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(bootstrap_text)
        tmp_path = f.name

    try:
        out, _, rc = run(f'bash "{TAB_MANAGER}" inject-file "{wt}" "{tmp_path}"')
        return "INSERTED" in out or "SENT" in out
    finally:
        os.unlink(tmp_path)


def wait_response(wt, timeout=RESPONSE_TIMEOUT):
    """応答完了待ち（BUSY→READY遷移を検出）"""
    saw_busy = False
    ready_after_busy = 0
    elapsed = 0
    while elapsed < timeout:
        status = check_status(wt)
        if status == "BUSY":
            saw_busy = True
            ready_after_busy = 0
        elif status == "READY":
            if saw_busy:
                ready_after_busy += 1
                if ready_after_busy >= 2:  # 2連続READYで確定
                    return True
            elif elapsed > 15:
                # BUSYを見ないまま15秒経過→既に応答済みと判断
                return True
        time.sleep(3)
        elapsed += 3
    return True  # タイムアウトでも続行（応答は来てるはず）


def get_tab_url(wt):
    """タブのURLを取得"""
    widx, tidx = wt.split(":")
    script = f'''
tell application "Google Chrome"
  set t to tab {tidx} of window {widx}
  return URL of t
end tell'''
    out, _, _ = run(f"osascript -e '{script}'")
    return out.strip()


def extract_chat_id(url):
    """URLからchat_id抽出"""
    # https://claude.ai/chat/UUID or https://claude.ai/project/PID/chat/UUID
    if "/chat/" in url:
        return url.split("/chat/")[-1].split("?")[0].split("#")[0]
    return None


def open_new_chat(project_uuid):
    """プロジェクトURLで新タブを開く → エディタREADY待ち"""
    project_url = f"https://claude.ai/project/{project_uuid}"

    # 現在のタブ数を取得
    out, _, _ = run('''osascript -e 'tell application "Google Chrome" to return ((index of front window as text) & " " & ((count of tabs of front window) as text))' ''')
    parts = out.split()
    if len(parts) < 2:
        return None
    widx = parts[0]
    tabs_before = int(parts[1])

    # 新タブを開く
    run(f'''osascript -e '
tell application "Google Chrome"
  tell window {widx}
    set newTab to make new tab
    set URL of newTab to "{project_url}"
  end tell
end tell' ''')

    new_tidx = tabs_before + 1
    wt = f"{widx}:{new_tidx}"
    log(f"  Opened tab {wt}, waiting for editor...")

    # エディタがREADYになるまで待つ（最大60秒）
    # プロジェクトページ読み込み→エディタ表示まで時間がかかる
    time.sleep(8)  # 初回読み込み待ち
    if not wait_ready(wt, timeout=60):
        log(f"  WARNING: editor not READY after 60s, proceeding anyway")

    return wt


def create_domain_chat(domain_name, domain_cfg, project_uuid):
    """1ドメインのチャット作成"""
    log(f"--- {domain_name} ---")

    # 1. 新タブ
    wt = open_new_chat(project_uuid)
    if not wt:
        log(f"  FAILED: Chrome not responding")
        return False

    # 2. READY待ち
    if not wait_ready(wt):
        log(f"  FAILED: not READY after {READY_TIMEOUT}s")
        return False
    log(f"  READY at {wt}")

    # 3. bootstrap inject
    bootstrap = domain_cfg.get("bootstrap", f"あなたは{domain_name}専門チャットです。")
    if not inject_bootstrap(wt, bootstrap):
        log(f"  FAILED: inject failed")
        return False
    log(f"  Bootstrap injected")

    # 4. 応答待ち
    wait_response(wt)
    log(f"  Response received")

    # 5. URL取得（inject後に/project/→/chat/に遷移するのを待つ）
    url = ""
    chat_id = None
    for i in range(15):
        url = get_tab_url(wt)
        chat_id = extract_chat_id(url)
        if chat_id:
            break
        time.sleep(2)
    if not chat_id:
        log(f"  FAILED: could not extract chat_id from {url}")
        return False
    log(f"  Chat ID: {chat_id}")

    # 6. タイトル設定（Chrome JS経由）
    title_tmpl = domain_cfg.get("title_template", domain_name)
    title = title_tmpl.replace("{date}", datetime.now().strftime("%Y-%m-%d"))
    rename_chat_chrome(wt, title)

    # 7. URL書き込み
    chat_url = f"https://claude.ai/chat/{chat_id}"
    return chat_url


def main():
    dry_run = "--dry-run" in sys.argv
    rename_only = "--rename-only" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    cfg = load_yaml()
    project_uuid = cfg.get("default_project", "")
    domains = cfg.get("domains", {})

    # --- rename-only モード ---
    if rename_only:
        if args:
            targets = [a for a in args if a in domains]
        else:
            targets = [name for name, d in domains.items() if d.get("url", "")]

        log(f"Renaming {len(targets)} chats...")
        for domain_name in targets:
            d = domains[domain_name]
            url = d.get("url", "")
            if not url:
                log(f"SKIP {domain_name}: no URL")
                continue
            title = d.get("title_template", domain_name).replace("{date}", datetime.now().strftime("%Y-%m-%d"))

            # Chrome新タブでURL開く→rename→閉じる
            log(f"--- {domain_name}: {title} ---")
            out, _, _ = run('''osascript -e 'tell application "Google Chrome" to return ((index of front window as text) & " " & ((count of tabs of front window) as text))' ''')
            parts = out.split()
            widx, tabs_before = parts[0], int(parts[1])
            run(f'''osascript -e 'tell application "Google Chrome" to tell window {widx} to set URL of (make new tab) to "{url}"' ''')
            new_tidx = tabs_before + 1
            wt = f"{widx}:{new_tidx}"
            time.sleep(5)
            rename_chat_chrome(wt, title)
            # タブ閉じる
            run(f'''osascript -e 'tell application "Google Chrome" to tell window {widx} to delete tab {new_tidx}' ''')
            time.sleep(1)
        log("Rename done")
        return

    # --- 通常モード（チャット作成） ---

    # 対象ドメイン決定
    if args:
        targets = [a for a in args if a in domains]
    else:
        targets = [name for name, d in domains.items() if not d.get("url", "")]

    if not targets:
        log("All domains already have URLs (or no matching domains)")
        return

    log(f"Creating {len(targets)} chats: {', '.join(targets)}")

    if dry_run:
        for t in targets:
            d = domains[t]
            title = d.get("title_template", t).replace("{date}", datetime.now().strftime("%Y-%m-%d"))
            log(f"  {t}: {title}")
        return

    created = 0
    failed = []

    for i, domain_name in enumerate(targets):
        domain_cfg = domains[domain_name]

        # 既にURLがあるドメインはスキップ（冪等性）
        if domain_cfg.get("url", "") and domain_name not in args:
            log(f"SKIP {domain_name}: already has URL")
            continue

        chat_url = create_domain_chat(domain_name, domain_cfg, project_uuid)

        if chat_url:
            # YAMLに書き込み（毎回保存 — 途中で死んでも部分的に保存される）
            cfg["domains"][domain_name]["url"] = chat_url
            save_yaml(cfg)
            log(f"  SAVED: {domain_name} → {chat_url}")
            created += 1
        else:
            failed.append(domain_name)

        # 次のドメインまで待つ（レート制限回避）
        if i < len(targets) - 1:
            log(f"  Waiting {BETWEEN_DOMAINS}s before next...")
            time.sleep(BETWEEN_DOMAINS)

    log(f"\nDone: {created} created, {len(failed)} failed")
    if failed:
        log(f"Failed: {', '.join(failed)}")
        log("Re-run to retry failed domains")


if __name__ == "__main__":
    main()
