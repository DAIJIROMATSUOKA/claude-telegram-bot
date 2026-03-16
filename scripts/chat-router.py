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

    else:
        print(f"ERROR: unknown command '{cmd}'", file=sys.stderr)
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
