#!/usr/bin/env python3
"""
auto-handoff-claude-ai.py — DJ直接投稿時のauto-handoff
chatlog-api.pyから5分ごとに呼ばれる。
非活動チャット（前回更新あり→今回更新なし）を検出→要約→croppy-notes追記。

Usage: python3 auto-handoff-claude-ai.py
"""
import json, os, sys, subprocess, datetime, hashlib, time
from pathlib import Path

# --- Config ---
STATE_FILE = os.path.expanduser("~/.claude-chatlog-handoff-state.json")
CHATLOG_STATE = os.path.expanduser("~/.claude-chatlog-state.json")
CROPPY_NOTES = os.path.expanduser(
    "~/Machinelab Dropbox/Matsuoka Daijiro/JARVIS-Journal/croppy-notes.md"
)
M1_STATE = os.path.expanduser("~/claude-telegram-bot/autonomous/state/M1.md")
LOG_FILE = "/tmp/auto-handoff-claude-ai.log"
CLAUDE_BIN = "/opt/homebrew/bin/claude"

# JARVIS Worker Project UUID
JARVIS_PROJECT = "019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"

# Handoff script for new chat creation
HANDOFF_SCRIPT = os.path.expanduser("~/claude-telegram-bot/scripts/croppy-session-handoff.sh")
HANDOFF_DIR = os.path.expanduser("~/claude-telegram-bot/autonomous/state/handoffs")

# Inactivity threshold: 2 polls (10 min) without update = session ended
INACTIVITY_POLLS = 6  # 5min x 6 = 30min inactivity before handoff

# Skip chats shorter than this (not worth summarizing)
MIN_MESSAGES = 4

def log(msg):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except:
        pass

def load_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except:
        return default or {}

def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def _extract_key_signals(chat_text):
    """Extract key signals from full chat text: commits, decisions, errors, fixes."""
    import re as _re
    signals = []
    for line in chat_text.split("\n"):
        if _re.search(r"(commit|feat:|fix:|docs:|refactor:)", line, _re.IGNORECASE):
            signals.append(line.strip()[:200])
        elif _re.search(r"(DECIDED|D:|adopted)", line):
            signals.append(line.strip()[:200])
        elif _re.search(r"(pushed|deployed|DONE)", line):
            signals.append(line.strip()[:200])
    seen = set()
    unique = []
    for s in signals:
        if s not in seen:
            seen.add(s)
            unique.append(s)
    return "\n".join(unique[:30])


def summarize_with_claude(chat_text, title):
    """Claude Code CLI で要約生成（従量課金API不使用）"""
    prompt = f"""以下はclaude.aiでのDJの作業チャットログです。
タイトル: {title}

SESSION SUMMARYを3-8行で生成してください。含める内容:
- 何をやったか（決定事項、実装内容、commit hashを全て列挙）
- 残課題
- 次のアクション

=== 全文から抽出したキーシグナル ===

{_extract_key_signals(chat_text)}

=== Chat tail ===
{chat_text[-5000:]}"""

    try:
        result = subprocess.run(
            [CLAUDE_BIN, "-p", prompt, "--output-format", "text"],
            capture_output=True, text=True, timeout=300,
            stdin=subprocess.DEVNULL,
            env={**os.environ, "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}"}
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        log(f"Claude CLI failed: exit={result.returncode} stderr={result.stderr[:200]}")
    except subprocess.TimeoutExpired:
        log("Claude CLI timeout (120s)")
    except Exception as e:
        log(f"Claude CLI error: {e}")
    return None

def append_to_croppy_notes(title, summary, chat_id):
    """handoff-summariesに要約を書き込み(croppy-notes肥大化防止)"""
    date = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    summary_dir = os.path.expanduser("~/Machinelab Dropbox/Matsuoka Daijiro/JARVIS-Journal/handoff-summaries")
    os.makedirs(summary_dir, exist_ok=True)
    summary_file = os.path.join(summary_dir, f"{today}.md")
    entry = f"\n## {date} Auto-Handoff: {title}\n{summary}\n"
    with open(summary_file, "a") as f:
        f.write(entry)
    log(f"Appended to handoff-summaries/{today}.md: {title[:50]}")

def update_m1_state(title, summary):
    """M1.mdのSESSION SUMMARYを更新"""
    try:
        content = Path(M1_STATE).read_text()
        # Replace SESSION SUMMARY section
        import re
        new_summary = f"""## SESSION SUMMARY (claude.ai {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')})

### {title}
{summary}
"""
        if "## SESSION SUMMARY" in content:
            # Greedy match: replace ALL SESSION SUMMARY content up to next ## or end
            content = re.sub(
                r"## SESSION SUMMARY.*?(?=\n## NEXT_ACTION|\Z)",
                new_summary.rstrip() + "\n",
                content,
                count=1,
                flags=re.DOTALL,
            )
        else:
            content += "\n" + new_summary

        # Update timestamp
        content = re.sub(
            r"UPDATED: .*",
            f"UPDATED: {datetime.datetime.now().strftime('%Y-%m-%dT%H:%M+09:00')}",
            content,
        )

        Path(M1_STATE).write_text(content)
        log(f"Updated M1.md")
    except Exception as e:
        log(f"M1.md update failed: {e}")

def send_completion_reminder(title, summary="", chat_id="", new_url=None):
    """セッション完了時にTelegram通知"""
    try:
        import urllib.request, urllib.parse
        # Load .env
        env = {}
        env_path = os.path.expanduser("~/claude-telegram-bot/.env")
        if os.path.exists(env_path):
            with open(env_path) as ef:
                for line in ef:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        k, v = line.split("=", 1)
                        env[k.strip()] = v.strip().strip('"').strip("'")
        token = env.get("TELEGRAM_BOT_TOKEN", "")
        tg_chat = env.get("TELEGRAM_ALLOWED_USERS", "")
        if not token or not tg_chat:
            log("Telegram: missing token/chat_id")
            return

        # Strip date prefix from title (e.g., "2026-03-19_0653_夜間ジョブ" -> "夜間ジョブ")
        import re as _re
        clean_title = _re.sub(r"^\d{4}-\d{2}-\d{2}_\d{4}_", "", title).strip()
        if not clean_title:
            clean_title = title

        # Build message
        lines = [f"\U0001F99E <b>{clean_title}</b>"]
        if summary:
            short = summary.strip().split("\n")[0][:200]
            lines.append(short)
        if new_url:
            lines.append(f'<a href="{new_url}">\U00002728 新チャットを開く</a>')
        elif chat_id:
            lines.append(f'<a href="https://claude.ai/chat/{chat_id}">チャットを開く</a>')

        msg = "\n".join(lines)
        data = urllib.parse.urlencode({
            "chat_id": tg_chat,
            "text": msg,
            "parse_mode": "HTML",
            "disable_web_page_preview": "true",
            "reply_markup": json.dumps({"inline_keyboard": [[{"text": "🗑", "callback_data": "ib:del:sys"}]]}),
        }).encode()
        req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data)
        urllib.request.urlopen(req, timeout=10)
        log(f"Telegram notified: {clean_title}")
    except Exception as e:
        log(f"Reminder failed: {e}")


def find_domain_bootstrap(title):
    """Look up domain bootstrap from chat-routing.yaml based on title keywords."""
    try:
        import yaml
        routing_path = os.path.expanduser("~/claude-telegram-bot/autonomous/state/chat-routing.yaml")
        if not os.path.exists(routing_path):
            return ""
        with open(routing_path) as f:
            routing = yaml.safe_load(f)
        domains = routing.get("domains", {})
        title_lower = title.lower()
        for domain_name, domain_conf in domains.items():
            if not isinstance(domain_conf, dict):
                continue
            keywords = domain_conf.get("keywords", [])
            bootstrap = domain_conf.get("bootstrap", "")
            if not bootstrap:
                continue
            for kw in keywords:
                if kw.lower() in title_lower:
                    log(f"Domain match: {domain_name} (keyword: {kw})")
                    return bootstrap.strip()
        return ""
    except Exception as e:
        log(f"Domain bootstrap lookup failed: {e}")
        return ""


def _get_domain_title(title):
    """Get today's title from chat-router.py title_template if domain matches."""
    try:
        result = subprocess.run(
            ["python3", os.path.expanduser("~/claude-telegram-bot/scripts/chat-router.py"), "route", title],
            capture_output=True, text=True, timeout=5,
            env={**os.environ, "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}"}
        )
        import re as _re
        domain = _re.search(r"^DOMAIN: (.+)$", result.stdout, _re.MULTILINE)
        if domain and domain.group(1).strip() != "inbox":
            d = domain.group(1).strip()
            title_result = subprocess.run(
                ["python3", os.path.expanduser("~/claude-telegram-bot/scripts/chat-router.py"), "title", d],
                capture_output=True, text=True, timeout=5,
                env={**os.environ, "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}"}
            )
            t = title_result.stdout.strip()
            if t and "ERROR" not in t:
                return t
    except:
        pass
    return None


def _update_domain_url(title, new_url, old_chat_id):
    """Update chat-routing.yaml URL when a domain chat is handed off."""
    try:
        import yaml
        router_script = os.path.expanduser("~/claude-telegram-bot/scripts/chat-router.py")
        routing_path = os.path.expanduser("~/claude-telegram-bot/autonomous/state/chat-routing.yaml")
        if not os.path.exists(routing_path):
            return

        with open(routing_path) as f:
            routing = yaml.safe_load(f)

        # Find which domain this chat_id belongs to
        for domain_name, domain_conf in routing.get("domains", {}).items():
            if not isinstance(domain_conf, dict):
                continue
            url = domain_conf.get("url", "")
            if old_chat_id in url:
                # Archive old URL and set new one
                subprocess.run(
                    ["python3", router_script, "archive-url", domain_name],
                    capture_output=True, text=True, timeout=5,
                    env={**os.environ, "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}"}
                )
                subprocess.run(
                    ["python3", router_script, "set-url", domain_name, new_url],
                    capture_output=True, text=True, timeout=5,
                    env={**os.environ, "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}"}
                )
                log(f"Domain URL updated: {domain_name} → {new_url}")
                return
    except Exception as e:
        log(f"Domain URL update failed: {e}")


def create_new_chat(title, summary, chat_id):
    """Create a new chat via croppy-session-handoff.sh and inject summary as bootstrap."""
    import re as _re
    try:
        # Strip date prefix from title
        clean_title = _re.sub(r"^\d{4}-\d{2}-\d{2}_\d{4}_", "", title).strip() or title

        # --- Generate bootstrap via unified script ---
        _domain = _resolve_domain(title) or _resolve_domain_by_chatid(chat_id)
        BOOTSTRAP_SCRIPT = os.path.expanduser("~/scripts/generate-handoff-bootstrap.py")
        boot_file = f"/tmp/handoff-bootstrap-{_domain or 'default'}.txt"

        # Use title_template from domain matched by chat_id URL
        try:
            import yaml as _yaml
            routing_path = os.path.expanduser("~/claude-telegram-bot/autonomous/state/chat-routing.yaml")
            _routing = _yaml.safe_load(open(routing_path))
            for _dn, _dc in _routing.get("domains", {}).items():
                if not isinstance(_dc, dict):
                    continue
                _url = _dc.get("url", "")
                if chat_id in _url:
                    tmpl = _dc.get("title_template", "")
                    if tmpl:
                        from datetime import datetime as _dt
                        clean_title = tmpl.replace("{date}", _dt.now().strftime("%Y-%m-%d_%H%M"))
                        log(f"Title from domain {_dn}: {clean_title}")
                    break
        except:
            pass

        if _domain and _domain != "inbox":
            log(f"Generating bootstrap via unified script: {_domain}")
            try:
                subprocess.run(
                    ["python3", BOOTSTRAP_SCRIPT, _domain, chat_id],
                    capture_output=True, text=True, timeout=300,
                    env={**os.environ, "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}"}
                )
                if os.path.exists(boot_file):
                    bootstrap = Path(boot_file).read_text()
                    log(f"Bootstrap loaded: {len(bootstrap)} chars")
                else:
                    log("Bootstrap file not created, using summary-only fallback")
                    bootstrap = f"## 前チャットの要約\n{summary}\n\n## 前チャットURL\nhttps://claude.ai/chat/{chat_id}"
            except Exception as e:
                log(f"Bootstrap generation failed: {e}")
                bootstrap = f"## 前チャットの要約\n{summary}\n\n## 前チャットURL\nhttps://claude.ai/chat/{chat_id}"
        else:
            # No domain match — simple bootstrap with summary only
            domain_bootstrap = find_domain_bootstrap(title)
            domain_section = f"\n## 専門チャット指示\n{domain_bootstrap}\n" if domain_bootstrap else ""
            bootstrap = f"# セッション自動引き継ぎ\n{domain_section}\n## 前チャットの要約\n{summary}\n\n## 前チャットURL\nhttps://claude.ai/chat/{chat_id}"

        # Call handoff script
        result = subprocess.run(
            ["bash", HANDOFF_SCRIPT, "--auto", "--title",
             _get_domain_title(title) or clean_title, bootstrap],
            capture_output=True, text=True, timeout=180,
            env={**os.environ, "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}"}
        )
        output = result.stdout
        log(f"Handoff script output: {output[-200:]}")

        # Extract URL from output
        url_match = _re.search(r"URL: (https://claude\.ai/chat/[a-f0-9-]+)", output)
        new_url = url_match.group(1) if url_match else None

        if new_url:
            log(f"New chat created: {new_url}")
            # Update chat-routing.yaml if this chat belongs to a domain
            _update_domain_url(title, new_url, chat_id)
            # Save as latest handoff (backup in case Chrome inject fails)
            os.makedirs(HANDOFF_DIR, exist_ok=True)
            handoff_path = os.path.join(HANDOFF_DIR, "croppy-latest.md")
            with open(handoff_path, "w") as f:
                f.write(bootstrap)
        else:
            log("New chat creation: URL not found in output")

        return new_url
    except Exception as e:
        log(f"New chat creation failed: {e}")
        return None



# --- Domain → knowledge directory mapping ---
KNOWLEDGE_BASE = os.path.expanduser("~/machinelab-knowledge")
DOMAIN_DIR_MAP = {
    "forge-plc": "plc-ladder",
    "forge-vision": "inspection-vision",
    "icad": "icad",
    "access": "access-db",
    "vision": "inspection-vision",
    "fa": "fa",
    "pc": "pc",
    "forge-code": "forge-code",
    "forge-research": "forge-research",
    "m1317": "projects/m1317",
    "m1319": "projects/m1319",
    "m1311": "projects/m1311",
    "m1300": "projects/m1300",
    "debate": "debate",
    "secretary": "secretary",
    "research": "research",
    "inbox": "inbox",
}

COMPRESS_PROMPT = """Convert this claude.ai chat log into compressed notation for AI consumption.

RULES:
- NO Japanese. English keywords + symbols only.
- D:=decision Q:=unresolved F:=fixed E:=error W:=work-done
- Dates: MMDD format. File paths: shortest form.
- Compress to 5-20 lines. Preserve ALL information, change only format.
- Include: commits, file changes, decisions with reasons, blockers, next actions.

LEGEND (include at top if first entry):
D:=decided Q:=open F:=fixed E:=error W:=done
cam:=camera plc:=PLC insp:=inspection conv:=conveyor

CHAT LOG:
{chat_text}"""


def _resolve_domain(title):
    """Resolve domain name from chat title using chat-router.py."""
    try:
        result = subprocess.run(
            ["python3", os.path.expanduser("~/claude-telegram-bot/scripts/chat-router.py"), "route", title],
            capture_output=True, text=True, timeout=5,
            env={**os.environ, "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}"}
        )
        import re as _re
        m = _re.search(r"^DOMAIN: (.+)$", result.stdout, _re.MULTILINE)
        if m:
            return m.group(1).strip()
    except:
        pass
    return None


def _resolve_domain_by_chatid(chat_id):
    """Resolve domain name from chat_id by matching URL in chat-routing.yaml."""
    try:
        import yaml as _yaml
        routing_path = os.path.expanduser("~/claude-telegram-bot/autonomous/state/chat-routing.yaml")
        with open(routing_path) as f:
            routing = _yaml.safe_load(f)
        for domain_name, dc in routing.get("domains", {}).items():
            if not isinstance(dc, dict):
                continue
            url = dc.get("url", "")
            if chat_id in url:
                return domain_name
    except:
        pass
    return None


def _distill_history(history_path):
    """Time-decay distillation: keep latest detailed, compress older entries.
    
    Latest entry: keep as-is (5-20 lines)
    Previous entry: compress to 2 lines
    Older entries: compress to 1 line each
    Target: always 20-30 lines total
    """
    if not os.path.exists(history_path):
        return

    with open(history_path, "r") as f:
        raw = f.read()

    # Split by ## headers (each generation)
    import re as _re
    sections = _re.split(r"(?=^## )", raw, flags=_re.MULTILINE)
    sections = [s.strip() for s in sections if s.strip()]

    if len(sections) <= 2:
        return  # Nothing to distill yet

    # Keep header (legend) if present
    header = ""
    if sections and not sections[0].startswith("## "):
        header = sections[0] + chr(10) + chr(10)
        sections = sections[1:]

    if len(sections) <= 2:
        return

    # Latest = keep as-is, prev = 2 lines, older = 1 line each
    latest = sections[-1]
    prev = sections[-2]

    # Compress prev to 2 lines: keep header + first content line
    prev_lines = prev.strip().split(chr(10))
    prev_compressed = prev_lines[0]  # ## header
    # Find first substantive line
    for line in prev_lines[1:]:
        if line.strip() and not line.startswith("#"):
            prev_compressed += chr(10) + line.strip()
            break

    # Compress older to 1 line each: header only
    older_compressed = []
    for section in sections[:-2]:
        lines = section.strip().split(chr(10))
        older_compressed.append(lines[0])  # ## header only

    # Reassemble
    new_content = header
    for line in older_compressed:
        new_content += line + chr(10)
    new_content += chr(10) + prev_compressed + chr(10) + chr(10) + latest + chr(10)

    with open(history_path, "w") as f:
        f.write(new_content)

    log(f"Distilled history: {len(sections)} generations -> {len(older_compressed)}x1line + 1x2line + 1xfull")



def compress_and_append_history(title, chat_text, chat_id):
    """Generate compressed history and append to domain-specific file."""
    domain = _resolve_domain(title)
    if not domain or domain == "inbox":
        domain = _resolve_domain_by_chatid(chat_id)
    if not domain or domain == "inbox":
        return

    dir_name = DOMAIN_DIR_MAP.get(domain, domain)
    dir_path = os.path.join(KNOWLEDGE_BASE, dir_name)
    os.makedirs(dir_path, exist_ok=True)
    history_path = os.path.join(dir_path, "history.compressed.md")

    # Use last 8000 chars for compression (enough for context, fits CLI limits)
    signals = _extract_key_signals(chat_text)
    tail_text = f"=== Key signals ===\n{signals}\n\n=== Chat tail ===\n{chat_text[-6000:]}"

    prompt = COMPRESS_PROMPT.format(chat_text=tail_text)

    try:
        result = subprocess.run(
            [CLAUDE_BIN, "-p", prompt, "--output-format", "text"],
            capture_output=True, text=True, timeout=300,
            stdin=subprocess.DEVNULL,
            env={**os.environ, "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}"}
        )
        if result.returncode != 0 or not result.stdout.strip():
            log(f"Compress failed for {domain}: exit={result.returncode}")
            return

        compressed = result.stdout.strip()
        date = datetime.datetime.now().strftime("%Y-%m-%d")

        entry = f"\n## {date} gen:{chat_id[:8]} ({domain})\n{compressed}\n"

        # Append
        with open(history_path, "a") as f:
            f.write(entry)
        log(f"History appended: {history_path} (+{len(compressed)} chars)")

        # Distill older entries
        _distill_history(history_path)

    except subprocess.TimeoutExpired:
        log(f"Compress timeout for {domain}")
    except Exception as e:
        log(f"Compress error for {domain}: {e}")


def check_domain_token_usage():
    """Monitor domain chat token usage. At 70%+, notify DJ in-chat via completion API.
    No automatic URL switching. No warm standby. DJ decides when to handoff."""
    try:
        import urllib.request, urllib.parse

        chatlog_state = load_json(CHATLOG_STATE)
        chats = chatlog_state  # uuid -> {filepath, ...}

        routing_path = os.path.expanduser("~/claude-telegram-bot/autonomous/state/chat-routing.yaml")
        if not os.path.exists(routing_path):
            return
        import yaml
        with open(routing_path) as rf:
            routing = yaml.safe_load(rf) or {}

        domains = routing.get("domains", {})

        # Load claude.ai auth
        config_path = os.path.expanduser("~/.claude-chatlog-config.json")
        if not os.path.exists(config_path):
            return
        config = load_json(config_path)
        session_key = config.get("session_key", "")
        org_id = config.get("org_id", "")
        if not session_key or not org_id:
            return

        for domain_name, domain_conf in domains.items():
            if not isinstance(domain_conf, dict):
                continue
            url = domain_conf.get("url", "")
            if not url or "(未作成)" in url:
                continue

            chat_id = url.rstrip("/").split("/")[-1]
            if not chat_id or len(chat_id) < 10:
                continue

            info = chats.get(chat_id, {})
            filepath = info.get("filepath", "")
            if not filepath or not os.path.exists(filepath):
                continue

            file_size = os.path.getsize(filepath)
            est_tokens = int(file_size * 1.5) + 60000
            pct = int(est_tokens * 100 / 200000)

            # Only act at 70%+
            if pct < 70:
                continue

            # Check if already notified for THIS chat (one notification per chat)
            notified_file = f"/tmp/domain-handoff-notified-{chat_id[:12]}"
            if os.path.exists(notified_file):
                continue

            log(f"TOKEN_WARNING: {domain_name} at {pct}% → notifying DJ in-chat")
            Path(notified_file).write_text(chat_id)  # Write BEFORE API call to prevent retry spam

            # Post to current chat via completion API
            try:
                # Get current_leaf_message_uuid
                api_url = f"https://claude.ai/api/organizations/{org_id}/chat_conversations/{chat_id}"
                req = urllib.request.Request(api_url, headers={
                    "Cookie": f"sessionKey={session_key}",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Accept": "application/json",
                    "Referer": "https://claude.ai/",
                    "Origin": "https://claude.ai",
                })
                with urllib.request.urlopen(req, timeout=15) as resp:
                    chat_data = json.loads(resp.read())
                leaf_uuid = chat_data.get("current_leaf_message_uuid", "")

                # Post notification message
                comp_url = f"https://claude.ai/api/organizations/{org_id}/chat_conversations/{chat_id}/completion"
                notify_msg = f"[AUTO] このチャットのトークン使用量が{pct}%に達しました。会話品質が低下する前に  を実行してください。"
                body = json.dumps({
                    "prompt": notify_msg,
                    "parent_message_uuid": leaf_uuid or "",
                    "timezone": "Asia/Tokyo",
                    "model": "claude-sonnet-4-6",
                    "attachments": [],
                }).encode()
                req2 = urllib.request.Request(comp_url, data=body, headers={
                    "Cookie": f"sessionKey={session_key}",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Accept": "text/event-stream",
                    "Referer": "https://claude.ai/",
                    "Origin": "https://claude.ai",
                    "Content-Type": "application/json",
                })
                # Fire and don't wait for full response (just ensure it's accepted)
                with urllib.request.urlopen(req2, timeout=30) as resp2:
                    # Read first few lines to confirm acceptance
                    for _ in range(5):
                        line = resp2.readline().decode("utf-8", errors="replace")
                        if not line:
                            break

                log(f"In-chat notification sent for {domain_name} ({pct}%)")

            except Exception as e:
                log(f"In-chat notification failed for {domain_name}: {e}")

            # Also send Telegram notification
            try:
                env = {}
                env_path = os.path.expanduser("~/claude-telegram-bot/.env")
                if os.path.exists(env_path):
                    with open(env_path) as ef:
                        for line in ef:
                            line = line.strip()
                            if "=" in line and not line.startswith("#"):
                                k, v = line.split("=", 1)
                                env[k.strip()] = v.strip().strip('"').strip("'")
                tg_token = env.get("TELEGRAM_BOT_TOKEN", "")
                tg_chat = env.get("TELEGRAM_ALLOWED_USERS", "")
                if tg_token and tg_chat:
                    tg_msg = f"⚠️ {domain_name} トークン{pct}%超過" + chr(10) + "チャット内に通知済み。handoffはDJ判断。"
                    tg_data = urllib.parse.urlencode({
                        "chat_id": tg_chat, "text": tg_msg,
                        "reply_markup": json.dumps({"inline_keyboard": [[
                            {"text": "チャットを開く", "url": f"https://claude.ai/chat/{chat_id}"}
                        ]]}),
                    }).encode()
                    tg_req = urllib.request.Request(f"https://api.telegram.org/bot{tg_token}/sendMessage", data=tg_data)
                    urllib.request.urlopen(tg_req, timeout=10)
            except Exception as e:
                log(f"Telegram notification failed for {domain_name}: {e}")

    except Exception as e:
        log(f"check_domain_token_usage error: {e}")


def main():
    # Stop flag (set during backfill or manual stop)
    if os.path.exists("/tmp/auto-handoff-stop"):
        log("Stop flag found, skipping")
        return

    # Proactive token monitoring — check all domain chats
    check_domain_token_usage()

    chatlog_state = load_json(CHATLOG_STATE)
    handoff_state = load_json(STATE_FILE, {"active_chats": {}, "handoff_done": {}})

    active_chats = handoff_state.get("active_chats", {})
    handoff_done = handoff_state.get("handoff_done", {})

    # Find all JARVIS project chats from chatlog state
    # chatlog_state can be: {"known_chats": {}} or direct {chat_id: {...}}
    chats = chatlog_state if isinstance(chatlog_state, dict) else {}
    if "known_chats" in chats:
        chats = chats.get("known_chats", {})

    # Also check from the direct state format
    now = datetime.datetime.now()
    updated_chat_ids = set()

    for chat_id, info in chats.items():
        if not isinstance(info, dict):
            continue

        # Check if this is a JARVIS project chat
        filepath = info.get("filepath", "")
        last_updated = info.get("last_updated", "")
        msg_count = info.get("msg_count", 0)

        # Read frontmatter to check project
        project = ""
        if filepath and os.path.exists(filepath):
            try:
                with open(filepath) as f:
                    for line in f:
                        if line.startswith("project:"):
                            project = line.split(":", 1)[1].strip()
                            break
                        if line.strip() == "---" and project:
                            break
            except:
                pass

        if project != JARVIS_PROJECT:
            continue

        # Check if recently updated (within last 10 min)
        # Use remote_updated (actual claude.ai timestamp) to avoid backfill false positives
        remote_updated = info.get("remote_updated", last_updated)
        try:
            last_t = datetime.datetime.fromisoformat(remote_updated)
            age_min = (now - last_t).total_seconds() / 60
        except:
            age_min = 999

        if age_min < 10:
            # Active chat
            updated_chat_ids.add(chat_id)
            if chat_id not in active_chats:
                active_chats[chat_id] = {
                    "first_seen": now.isoformat(),
                    "filepath": filepath,
                    "title": info.get("title", ""),
                    "inactive_count": 0,
                    "msg_count": msg_count,
                    "last_sender": info.get("last_sender", ""),
                }
            else:
                active_chats[chat_id]["inactive_count"] = 0
                active_chats[chat_id]["msg_count"] = msg_count
                active_chats[chat_id]["last_sender"] = info.get("last_sender", "")
        elif chat_id in active_chats:
            # Was active, now inactive
            active_chats[chat_id]["inactive_count"] = active_chats[chat_id].get("inactive_count", 0) + 1

    # Check for chats that exceeded inactivity threshold
    to_handoff = []
    for chat_id, info in list(active_chats.items()):
        if info.get("inactive_count", 0) >= INACTIVITY_POLLS:
            # Check if already handed off
            if chat_id in handoff_done:
                prev_count = handoff_done[chat_id].get("msg_count", 0)
                if info.get("msg_count", 0) <= prev_count + 2:
                    # Skip if fewer than 3 new messages since last handoff
                    del active_chats[chat_id]
                    continue

            # Only handoff if last message was from DJ (human) — means Claude died mid-session
            # If last message was from assistant or unknown, session ended normally — no handoff needed
            last_sender = info.get("last_sender", "")
            if last_sender != "human":
                log(f"  Skip: {info.get('title', '')[:30]} — last_sender={last_sender!r} (not human)")
                del active_chats[chat_id]
                continue

            if info.get("msg_count", 0) >= MIN_MESSAGES:
                to_handoff.append((chat_id, info))
            del active_chats[chat_id]

    # Process handoffs
    for chat_id, info in to_handoff:
        filepath = info.get("filepath", "")
        title = info.get("title", "unknown")
        log(f"HANDOFF: {title} ({info.get('msg_count', 0)} msgs)")

        if not filepath or not os.path.exists(filepath):
            log(f"  Skip: file not found {filepath}")
            continue

        # Read chat content
        try:
            chat_text = Path(filepath).read_text()
        except Exception as e:
            log(f"  Skip: read error {e}")
            continue

        # Summarize
        summary = summarize_with_claude(chat_text, title)
        if not summary:
            log(f"  Skip: summary generation failed")
            continue

        # Write to croppy-notes + M1.md
        append_to_croppy_notes(title, summary, chat_id)
        update_m1_state(title, summary)

        # Compressed history generated by generate-handoff-bootstrap.py above

        # Create new chat with summary injected
        new_url = create_new_chat(title, summary, chat_id)

        # Mark as done
        handoff_done[chat_id] = {
            "msg_count": info.get("msg_count", 0),
            "handoff_at": now.isoformat(),
            "new_chat_url": new_url or "",
        }

        # Only notify if new chat was NOT created (croppy-session-handoff.sh already notifies)
        if not new_url:
            send_completion_reminder(title, summary, chat_id, new_url)
        log(f"  DONE: handoff complete (new_chat={new_url})")

    # Cleanup old handoff records (>7 days)
    cutoff = (now - datetime.timedelta(days=7)).isoformat()
    handoff_done = {k: v for k, v in handoff_done.items()
                    if v.get("handoff_at", "") > cutoff}

    # Save state
    save_json(STATE_FILE, {
        "active_chats": active_chats,
        "handoff_done": handoff_done,
        "last_run": now.isoformat(),
    })

if __name__ == "__main__":
    main()
