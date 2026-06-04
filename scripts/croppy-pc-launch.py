#!/usr/bin/env python3
"""
croppy-pc-launch.py - PTY-backed launcher for interactive Remote Control with session resume.

Mode: `claude --resume <id> --remote-control <name> --permission-mode bypassPermissions`
(interactive + RC flag, NOT the server-mode `remote-control` subcommand).
Server mode cannot resume (GitHub anthropics/claude-code #29748); this flag form can,
so context survives restarts.

Session continuity (method A): first launch (no recorded id) starts fresh, detects the
newly-created session jsonl, and records its id to LAST_SESSION_FILE. On restart we
--resume that id (same jsonl, no --fork-session). Recording is immune to spawn-pipeline /
manual sessions that also live in the same project dir.

PTY: interactive RC needs a TTY; parent holds master open so claude's stdin never EOFs.
On claude exit, master EOFs, this process exits, launchd (KeepAlive) restarts it -> resume
keeps the same conversation.

Permission: --permission-mode bypassPermissions (decision 2026-06-04, DJ): zero prompts for
iPhone-only operation. The bash sandbox (Seatbelt filesystem/network isolation) is an INDEPENDENT
layer per Claude Code docs (code.claude.com/docs/en/sandboxing) and stays active regardless of
permission mode — .env/.ssh stay unreadable, non-allowlisted hosts blocked, writes confined to
allowed paths. Accepted trade-off: exec-bridge M1 commands (non-sandboxed) also auto-run with no
prompt, so the M1-privileged-op checkpoint is gone. (Earlier note kept acceptEdits over the false
belief that skipping prompts disabled the sandbox; modern model decouples them.)
"""
import os, sys, pty, select, re, subprocess, glob, time

HOME = os.path.expanduser("~")
NAME = os.environ.get("RC_NAME", "croppy-pc-main")
LOG = os.environ.get("RC_LOG", "/tmp/rc-croppy.log")
CLAUDE = "/opt/homebrew/bin/claude"
NOTIFY = f"{HOME}/claude-telegram-bot/scripts/notify-dj.sh"
PROJ = f"{HOME}/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot"
LAST_SESSION_FILE = "/tmp/croppy-pc-last-session"
URL_RE = re.compile(rb"https://claude\.ai/code(?:/session_[A-Za-z0-9]+|\?environment=env_[A-Za-z0-9_]+)")
RECORD_DELAY = 8  # wait for session jsonl to appear before recording

def log_line(msg):
    try:
        with open(LOG, "ab", buffering=0) as f:
            f.write(("[launcher] " + msg + "\n").encode())
    except Exception:
        pass

def list_session_ids():
    ids = set()
    for f in glob.glob(PROJ + "/*.jsonl"):
        b = os.path.basename(f)
        if "agent" in b:
            continue
        ids.add(b[:-6])
    return ids

def read_prev_session():
    try:
        with open(LAST_SESSION_FILE) as f:
            sid = f.read().strip()
        if sid and os.path.exists(f"{PROJ}/{sid}.jsonl"):
            return sid
        if sid:
            log_line(f"recorded id {sid} has no jsonl; ignoring")
    except Exception:
        pass
    return None

def write_session(sid):
    try:
        with open(LAST_SESSION_FILE, "w") as f:
            f.write(sid)
        log_line(f"recorded sessionId: {sid}")
    except Exception as e:
        log_line(f"write session error: {e}")

prev_id = read_prev_session()
if prev_id:
    ARGS = [CLAUDE, "--resume", prev_id, "--remote-control", NAME, "--permission-mode", "bypassPermissions"]
else:
    ARGS = [CLAUDE, "--remote-control", NAME, "--permission-mode", "bypassPermissions"]

before_ids = list_session_ids()

# Take sole ownership: kill any pre-existing RC session (server or flag mode).
# Safe: we have not forked our own child yet.
try:
    out = subprocess.run(["pgrep", "-f", "remote-control"],
                         capture_output=True, text=True).stdout.split()
    killed = []
    for p in out:
        if p and int(p) != os.getpid():
            subprocess.run(["kill", p])
            killed.append(p)
    if killed:
        log_line(f"killed pre-existing RC: {killed}")
except Exception as e:
    log_line(f"ownership check error: {e}")

try:
    open(LOG, "wb").close()
except Exception:
    pass
log_line(f"starting {NAME} (pid {os.getpid()}) resume={prev_id or 'none'}")

master, slave = pty.openpty()
pid = os.fork()
if pid == 0:
    os.setsid()
    try:
        os.login_tty(slave)
    except Exception:
        os.dup2(slave, 0); os.dup2(slave, 1); os.dup2(slave, 2)
    os.close(master)
    os.execv(CLAUDE, ARGS)
    os._exit(127)

os.close(slave)
notified = False
recorded = False
buf = b""
t0 = time.time()
with open(LOG, "ab", buffering=0) as logf:
    while True:
        wpid, _ = os.waitpid(pid, os.WNOHANG)
        if wpid == pid:
            break
        r, _, _ = select.select([master], [], [], 1.0)
        if master in r:
            try:
                data = os.read(master, 4096)
            except OSError:
                break
            if not data:
                break
            logf.write(data)
            if not notified:
                buf = (buf + data)[-4000:]
                m = URL_RE.search(buf)
                if m:
                    url = m.group(0).decode()
                    notified = True
                    try:
                        subprocess.Popen([NOTIFY, f"\U0001f99e croppy-pc (re)started\n{url}"])
                    except Exception as e:
                        log_line(f"notify error: {e}")
        if not recorded and (time.time() - t0) > RECORD_DELAY:
            if prev_id:
                write_session(prev_id)
                recorded = True
            else:
                new_ids = list_session_ids() - before_ids
                if new_ids:
                    newest = max(new_ids, key=lambda s: os.path.getmtime(f"{PROJ}/{s}.jsonl"))
                    write_session(newest)
                    recorded = True
log_line(f"{NAME} exited; launcher exiting (launchd will restart)")
sys.exit(0)
