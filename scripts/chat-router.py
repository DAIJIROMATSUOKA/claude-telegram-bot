#!/usr/bin/env python3
"""
chat-router.py — ドメイン→チャットURLルーティングエンジン
場所: ~/claude-telegram-bot/scripts/chat-router.py

Usage:
  chat-router.py route "テキスト"       → ドメイン名+URL（キーワードマッチ）
  chat-router.py url <domain>           → URL取得
  chat-router.py set-url <domain> <url> → URL更新
  chat-router.py bootstrap <domain>     → bootstrap prompt取得
  chat-router.py title <domain>         → title_template（{date}展開済み）
  chat-router.py list                   → 全ドメイン一覧
  chat-router.py unrouted               → URL未設定のドメイン一覧
"""

import sys
import os
import yaml
from datetime import datetime

YAML_PATH = os.path.expanduser("~/claude-telegram-bot/autonomous/state/chat-routing.yaml")


def load_config():
    with open(YAML_PATH, "r") as f:
        return yaml.safe_load(f)


def save_config(cfg):
    with open(YAML_PATH, "w") as f:
        yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def route(text, cfg):
    """キーワードマッチでドメイン決定。マッチなし→inbox"""
    text_lower = text.lower()
    domains = cfg.get("domains", {})

    # スコアリング: マッチしたキーワード数で優先度
    best_domain = None
    best_score = 0

    for name, d in domains.items():
        if name == "inbox":
            continue
        keywords = d.get("keywords", [])
        score = sum(1 for kw in keywords if kw.lower() in text_lower)
        if score > best_score:
            best_score = score
            best_domain = name

    if best_domain is None:
        best_domain = "inbox"

    d = domains.get(best_domain, {})
    url = d.get("url", "")
    return best_domain, url


def get_url(domain, cfg):
    return cfg.get("domains", {}).get(domain, {}).get("url", "")


def set_url(domain, url, cfg):
    if domain not in cfg.get("domains", {}):
        print(f"ERROR: unknown domain '{domain}'", file=sys.stderr)
        sys.exit(1)
    cfg["domains"][domain]["url"] = url
    save_config(cfg)
    return True


def get_bootstrap(domain, cfg):
    return cfg.get("domains", {}).get(domain, {}).get("bootstrap", "")


def get_title(domain, cfg):
    tmpl = cfg.get("domains", {}).get(domain, {}).get("title_template", domain)
    return tmpl.replace("{date}", datetime.now().strftime("%Y-%m-%d"))


def list_domains(cfg):
    domains = cfg.get("domains", {})
    for name, d in domains.items():
        url = d.get("url", "")
        status = "✅" if url else "⬜"
        kw_count = len(d.get("keywords", []))
        print(f"{status} {name:20s} kw={kw_count:2d}  {url[:60] if url else '(未作成)'}")


def list_unrouted(cfg):
    domains = cfg.get("domains", {})
    for name, d in domains.items():
        if not d.get("url", ""):
            print(name)



def archive_url(domain, cfg):
    """Move current URL to chat_history"""
    d = cfg.get("domains", {}).get(domain)
    if not d:
        return f"ERROR: unknown domain '{domain}'"
    url = d.get("url", "")
    if not url or url == "(未作成)":
        return "ERROR: no URL to archive"
    chat_id = url.split("/chat/")[-1] if "/chat/" in url else ""
    if not chat_id:
        return "ERROR: invalid URL"
    if "chat_history" not in d:
        d["chat_history"] = []
    from datetime import datetime
    entry = {
        "id": chat_id,
        "created": datetime.now().strftime("%Y-%m-%d"),
        "title": d.get("title_template", "").replace("{date}", datetime.now().strftime("%Y-%m-%d_%H%M")),
    }
    d["chat_history"].append(entry)
    save_config(cfg)
    return f"ARCHIVED: {chat_id} ({len(d['chat_history'])} entries)"


def get_field(domain, field, cfg):
    """Get a specific field from domain config"""
    d = cfg.get("domains", {}).get(domain)
    if not d:
        return ""
    val = d.get(field, "")
    if isinstance(val, list):
        import json
        return json.dumps(val)
    return str(val) if val else ""


def show_history(domain, cfg):
    """Show chat_history for a domain"""
    d = cfg.get("domains", {}).get(domain)
    if not d:
        return f"ERROR: unknown domain '{domain}'"
    history = d.get("chat_history", [])
    if not history:
        return f"{domain}: no history"
    lines = []
    for h in history:
        lines.append(f"  {h.get('created','')} | {h.get('id','')} | {h.get('title','')}")
    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    cfg = load_config()

    if cmd == "route":
        if len(sys.argv) < 3:
            print("ERROR: usage: chat-router.py route \"text\"", file=sys.stderr)
            sys.exit(1)
        text = " ".join(sys.argv[2:])
        domain, url = route(text, cfg)
        print(f"DOMAIN: {domain}")
        print(f"URL: {url}" if url else "URL: (未作成)")

    elif cmd == "url":
        if len(sys.argv) < 3:
            print("ERROR: usage: chat-router.py url <domain>", file=sys.stderr)
            sys.exit(1)
        url = get_url(sys.argv[2], cfg)
        print(url if url else "(未作成)")

    elif cmd == "set-url":
        if len(sys.argv) < 4:
            print("ERROR: usage: chat-router.py set-url <domain> <url>", file=sys.stderr)
            sys.exit(1)
        set_url(sys.argv[2], sys.argv[3], cfg)
        print(f"OK: {sys.argv[2]} → {sys.argv[3]}")

    elif cmd == "bootstrap":
        if len(sys.argv) < 3:
            print("ERROR: usage: chat-router.py bootstrap <domain>", file=sys.stderr)
            sys.exit(1)
        bs = get_bootstrap(sys.argv[2], cfg)
        print(bs)

    elif cmd == "title":
        if len(sys.argv) < 3:
            print("ERROR: usage: chat-router.py title <domain>", file=sys.stderr)
            sys.exit(1)
        print(get_title(sys.argv[2], cfg))

    elif cmd == "list":
        list_domains(cfg)

    elif cmd == "unrouted":
        list_unrouted(cfg)

    elif cmd == "archive-url":
        if len(sys.argv) < 3:
            print("ERROR: usage: chat-router.py archive-url <domain>", file=sys.stderr)
            sys.exit(1)
        print(archive_url(sys.argv[2], cfg))

    elif cmd == "get-field":
        if len(sys.argv) < 4:
            print("ERROR: usage: chat-router.py get-field <domain> <field>", file=sys.stderr)
            sys.exit(1)
        print(get_field(sys.argv[2], sys.argv[3], cfg))

    elif cmd == "history":
        if len(sys.argv) < 3:
            # Show all domains summary
            for name, d in cfg.get("domains", {}).items():
                h = d.get("chat_history", [])
                cid = d.get("url", "").split("/chat/")[-1][:8] if "/chat/" in d.get("url", "") else "?"
                print(f"{name}: current={cid} history={len(h)}")
        else:
            print(show_history(sys.argv[2], cfg))

    else:
        print(f"ERROR: unknown command '{cmd}'", file=sys.stderr)
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
