#!/bin/bash
# api-handoff.sh — Unified handoff script (Chrome-free)
#
# 全パターン共通:
#   1. Claude自身が要約を書く → summaryファイル
#   2. このスクリプトが実行を担当（チャット作成→URL切替→履歴追記→通知）
#
# Usage:
#   api-handoff.sh <domain> --summary-file /tmp/handoff-summary-pc.md
#   api-handoff.sh <domain> --summary-stdin    (stdin から読む)
#   api-handoff.sh <domain> --agent-sdk        (Agent SDKにchatlog読ませて生成 ※フォールバック)
#
# チャット名: MMDD{seq}_{title_template} (例: 04031_PC操作_Mac設定)
# 旧チャット: MMDD{seq}_{title_template}_archived

set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
CHAT_ROUTER="python3 $SCRIPTS_DIR/chat-router.py"
NOTIFY="$SCRIPTS_DIR/notify-dj.sh"
LOCK_DIR="/tmp"
KNOWLEDGE_BASE="$HOME/machinelab-knowledge"

source "$HOME/claude-telegram-bot/.env" 2>/dev/null || true

log() { echo "[$(date '+%H:%M:%S')] [api-handoff/$DOMAIN] $1"; }

# --- Parse args ---
MODE=""
SUMMARY_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --summary-file) MODE="file"; SUMMARY_FILE="$2"; shift 2 ;;
    --summary-stdin) MODE="stdin"; shift ;;
    --agent-sdk) MODE="sdk"; shift ;;
    *) break ;;
  esac
done

DOMAIN="${1:?Usage: api-handoff.sh [--summary-file FILE|--summary-stdin|--agent-sdk] <domain>}"

# Validate domain exists
DOMAIN_URL=$($CHAT_ROUTER url "$DOMAIN" 2>/dev/null)
if [ -z "$DOMAIN_URL" ] || [ "$DOMAIN_URL" = "(未作成)" ]; then
  echo "ERROR: domain '$DOMAIN' has no URL"
  exit 1
fi

# --- Lock (per-domain + global relay) ---
LOCK_FILE="$LOCK_DIR/domain-lock-${DOMAIN}.json"
BUFFER_FILE="$LOCK_DIR/domain-buffer-${DOMAIN}.jsonl"
GLOBAL_RELAY_LOCK="$LOCK_DIR/domain-relay-tab.lock"

echo "{\"type\":\"handoff\",\"pid\":$$,\"since\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"domain\":\"$DOMAIN\"}" > "$LOCK_FILE"
echo "{\"domain\":\"$DOMAIN\",\"pid\":$$,\"since\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"handoff\"}" > "$GLOBAL_RELAY_LOCK"
trap 'rm -f "$GLOBAL_RELAY_LOCK"' EXIT
bash "$NOTIFY" "📌 $DOMAIN HANDOFF中(api)" 2>/dev/null &
log "Lock acquired"

# --- Step 0: Get summary ---
case "$MODE" in
  file)
    if [ ! -f "$SUMMARY_FILE" ]; then
      log "ERROR: summary file not found: $SUMMARY_FILE"
      rm -f "$LOCK_FILE"
      exit 1
    fi
    SUMMARY=$(cat "$SUMMARY_FILE")
    ;;
  stdin)
    SUMMARY=$(cat)
    SUMMARY_FILE="/tmp/handoff-summary-${DOMAIN}.md"
    echo "$SUMMARY" > "$SUMMARY_FILE"
    ;;
  sdk)
    # Fallback: Agent SDK reads chatlog
    OLD_CHAT_ID=$(echo "$DOMAIN_URL" | grep -o '[0-9a-f-]\{36\}$')
    CHATLOG_FILE=""
    if [ -n "$OLD_CHAT_ID" ]; then
      CHATLOG_FILE=$(python3 -c "
import json, os
try:
    state = json.load(open(os.path.expanduser('~/.claude-chatlog-state.json')))
    entry = state.get('$OLD_CHAT_ID')
    if entry and os.path.exists(entry['filepath']):
        print(entry['filepath'])
except: pass
" 2>/dev/null)
    fi

    if [ -n "$CHATLOG_FILE" ]; then
      CHATLOG_TAIL="/tmp/chatlog-tail-$$.md"
      tail -400 "$CHATLOG_FILE" > "$CHATLOG_TAIL"
      SUMMARY_PROMPT="Read this chatlog and create a handoff summary. Include these sections:
## STATE (current phase, what's done/not done, what to do first next session)
## ARTIFACTS (full text of any messages/code/docs created - DO NOT summarize)
## DECISIONS (each with rationale)
## REMAINING (unfinished tasks)
## COMPRESSED
Legend: D:=decided Q:=open F:=fixed W:=done E:=error
One-line-per-item compressed context. This section is auto-extracted for history.
File: $CHATLOG_TAIL"
      PROMPT_B64=$(echo -n "$SUMMARY_PROMPT" | base64)
      RESULT=$(bash "$SCRIPTS_DIR/agent-bridge.sh" "$PROMPT_B64" "read" "120" 2>/dev/null)
      if echo "$RESULT" | head -1 | grep -q "\[OK\]"; then
        SUMMARY=$(echo "$RESULT" | tail -n +2)
        log "Agent SDK summary: ${#SUMMARY} chars"
      else
        log "Agent SDK failed: $(echo "$RESULT" | head -1)"
        SUMMARY="(Agent SDK要約失敗。conversation_searchで補完してください)"
      fi
      rm -f "$CHATLOG_TAIL"
    else
      log "No chatlog for $OLD_CHAT_ID"
      SUMMARY="(ChatLog未検出。conversation_searchで補完してください)"
    fi
    SUMMARY_FILE="/tmp/handoff-summary-${DOMAIN}.md"
    echo "$SUMMARY" > "$SUMMARY_FILE"
    ;;
  *)
    log "ERROR: specify --summary-file, --summary-stdin, or --agent-sdk"
    rm -f "$LOCK_FILE"
    exit 1
    ;;
esac

# --- Step 1: Calculate sequence number (MMDD{seq}) ---
TODAY=$(date '+%Y-%m-%d')
TODAY_MMDD=$(date '+%m%d')
# Count today's entries in chat_history
TODAY_COUNT=$(python3 -c "
import yaml, sys
cfg = yaml.safe_load(open('$HOME/claude-telegram-bot/autonomous/state/chat-routing.yaml'))
d = cfg.get('domains', {}).get('$DOMAIN', {})
history = d.get('chat_history', [])
count = sum(1 for h in history if h.get('created', '').startswith('$TODAY'))
# +1 for the current active chat (which is about to be archived)
print(count + 1)
" 2>/dev/null || echo "1")
TITLE_BASE=$($CHAT_ROUTER get-field "$DOMAIN" title_template 2>/dev/null || echo "$DOMAIN")
TITLE_BASE=$(echo "$TITLE_BASE" | sed "s/{date}_//; s/{date}//")
NEW_CHAT_NAME="${TODAY_MMDD}${TODAY_COUNT}_${TITLE_BASE}"
ARCHIVED_NAME="${NEW_CHAT_NAME}_archived"
log "Chat name: $NEW_CHAT_NAME (seq=$TODAY_COUNT)"

# --- Step 2: Create new chat via API ---
PROJ_UUID=$($CHAT_ROUTER get-field "$DOMAIN" project_uuid 2>/dev/null)
if [ -z "$PROJ_UUID" ]; then
  # Extract from project_url or use default
  PROJ_URL=$($CHAT_ROUTER get-field "$DOMAIN" project_url 2>/dev/null || echo "")
  PROJ_UUID=$(echo "$PROJ_URL" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$PROJ_UUID" ]; then
    PROJ_UUID="019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"  # default project
  fi
fi

NEW_UUID=$(python3 "$SCRIPTS_DIR/stateless-handoff.py" "$PROJ_UUID" --name "$NEW_CHAT_NAME" 2>/dev/null)
if [ -z "$NEW_UUID" ]; then
  log "ERROR: failed to create chat"
  bash "$NOTIFY" "❌ $DOMAIN handoff fail: API chat creation" 2>/dev/null
  rm -f "$LOCK_FILE"
  exit 1
fi
NEW_URL="https://claude.ai/chat/$NEW_UUID"
log "New chat: $NEW_UUID ($NEW_CHAT_NAME)"

# --- Step 3: Archive + switch URL ---
$CHAT_ROUTER archive-url "$DOMAIN" 2>/dev/null
$CHAT_ROUTER set-url "$DOMAIN" "$NEW_URL" 2>/dev/null
log "URL switched: $NEW_URL"

# --- Step 4: Rename old chat ---
OLD_CHAT_ID=$(echo "$DOMAIN_URL" | grep -o '[0-9a-f-]\{36\}$')
if [ -n "$OLD_CHAT_ID" ]; then
  python3 "$SCRIPTS_DIR/rename-conversation.py" "$OLD_CHAT_ID" "$ARCHIVED_NAME" 2>/dev/null || true
  log "Old chat renamed: $ARCHIVED_NAME"
fi

# --- Step 5: Build full handoff file (bootstrap + summary + history + buffer) ---
BOOTSTRAP=$($CHAT_ROUTER bootstrap "$DOMAIN" 2>/dev/null || echo "")
HISTORY_FILE="$KNOWLEDGE_BASE/${DOMAIN}/history.compressed.md"
HISTORY=""
if [ -f "$HISTORY_FILE" ]; then HISTORY=$(cat "$HISTORY_FILE"); fi

HANDOFF_OUT="/tmp/handoff-full-${DOMAIN}.md"
{
  if [ -n "$BOOTSTRAP" ]; then printf '%s\n\n' "$BOOTSTRAP"; fi
  printf '## 前チャットの要約\n%s\n\n' "$SUMMARY"
  if [ -n "$HISTORY" ]; then printf '## Compressed History\n%s\n\n' "$HISTORY"; fi
  printf '## 前チャットURL\n%s\n\n' "$DOMAIN_URL"
  printf '## 必須アクション\nconversation_searchで前チャットの最新内容を検索し、上記要約で欠落している詳細を補完せよ。\n'
  printf '以上の文脈を踏まえて、今後のメッセージに対応してください。\n'
} > "$HANDOFF_OUT"

# Append buffered messages if any
if [ -f "$BUFFER_FILE" ] && [ -s "$BUFFER_FILE" ]; then
  COUNT=$(wc -l < "$BUFFER_FILE" | tr -d ' ')
  FLUSH_MSG=$(python3 -c "
import json, sys
entries = []
for line in open('$BUFFER_FILE'):
    try: entries.append(json.loads(line.strip()))
    except: pass
if not entries: sys.exit(0)
lines = []
for i, e in enumerate(entries):
    ts = e.get('ts','')
    if 'T' in ts: ts = ts.split('T')[1][:5]
    lines.append(f'[{i+1}] {ts} — {e[\"text\"]}')
print(f'\n---\n📨 HANDOFF中にDJから届いたメッセージ ({len(entries)}件):\n' + '\n'.join(lines) + '\n\n以上を踏まえて対応してください。')
" 2>/dev/null)
  if [ -n "$FLUSH_MSG" ]; then
    echo "$FLUSH_MSG" >> "$HANDOFF_OUT"
  fi
  rm -f "$BUFFER_FILE"
  log "Buffer flushed ($COUNT msgs)"
fi

# --- Step 6: Save to handoffs directory ---
# --- Step 5.5: Validate handoff quality (仕組み化 — 3要素チェック: 現状・次アクション・完了条件) ---
VALIDATION=$(python3 "$SCRIPTS_DIR/validate-handoff.py" "$SUMMARY_FILE" 2>/dev/null || echo "VALIDATION_ERROR")

if [ "$VALIDATION" != "OK" ]; then
  log "WARNING: Handoff quality check failed"
  # Inject warning into handoff file
  {
    echo ""
    echo "## ⚠️ HANDOFF品質警告"
    echo "$VALIDATION"
  } >> "$HANDOFF_OUT"
fi
HANDOFF_DIR="$SCRIPTS_DIR/../autonomous/state/handoffs"
mkdir -p "$HANDOFF_DIR"
HANDOFF_SAVE="$HANDOFF_DIR/croppy-$(date '+%Y-%m-%d_%H%M').md"
cp "$HANDOFF_OUT" "$HANDOFF_SAVE"
ln -sf "$(basename "$HANDOFF_SAVE")" "$HANDOFF_DIR/croppy-latest.md"
log "Handoff saved: $HANDOFF_SAVE"

# --- Step 7: Append compressed history (仕組み化 — 従量課金4層防御と同レベル) ---
DOMAIN_KNOWLEDGE_DIR="$KNOWLEDGE_BASE/$DOMAIN"
mkdir -p "$DOMAIN_KNOWLEDGE_DIR"
HISTORY_FILE="$DOMAIN_KNOWLEDGE_DIR/history.compressed.md"

# Extract COMPRESSED section from summary
COMPRESSED=$(python3 -c "
import sys
text = open('$SUMMARY_FILE').read()
lines = text.split('\n')
in_section = False
result = []
for line in lines:
    if line.strip().startswith('## COMPRESSED'):
        in_section = True
        continue
    if in_section and line.strip().startswith('## '):
        break
    if in_section and line.strip():
        result.append(line)
if result:
    print('\n'.join(result))
else:
    # Fallback: no COMPRESSED section, create minimal entry
    print('W: handoff executed (no COMPRESSED section in summary)')
" 2>/dev/null)

# Dedup: skip if this exact section header already exists
SECTION_HEADER="## ${TODAY} seq:${TODAY_COUNT} (${DOMAIN})"
if grep -qF "$SECTION_HEADER" "$HISTORY_FILE" 2>/dev/null; then
  log "History dedup: '$SECTION_HEADER' already exists, skipping"
else
  # Content dedup: compare with last entry (different seq can have identical content)
  COMPRESSED_TMP="/tmp/handoff-compressed-$$.txt"
  printf '%s' "$COMPRESSED" > "$COMPRESSED_TMP"
  CONTENT_MATCH=$(python3 -c "
import re, os, sys
history_file = '$HISTORY_FILE'
compressed_file = '$COMPRESSED_TMP'
if not os.path.exists(history_file):
    print('NO')
    sys.exit(0)
compressed = open(compressed_file).read().strip()
content = open(history_file).read()
blocks = re.findall(r'\`\`\`\n(.*?)\`\`\`', content, re.DOTALL)
if not blocks:
    print('NO')
    sys.exit(0)
last_block = blocks[-1].strip()
print('YES' if last_block == compressed else 'NO')
" 2>/dev/null || echo "NO")
  rm -f "$COMPRESSED_TMP"
  if [ "$CONTENT_MATCH" = "YES" ]; then
    log "History content dedup: identical to last entry, skipping"
  else
    {
      echo ""
      echo "$SECTION_HEADER"
      echo '```'
      echo "$COMPRESSED"
      echo '```'
    } >> "$HISTORY_FILE"
    log "History appended: $HISTORY_FILE"
  fi
fi


# --- Step 7.5: Update M1.md state (仕組み化 — handoff時に必ず最新化) ---
M1_STATE="$SCRIPTS_DIR/../autonomous/state/M1.md"
if [ -f "$SUMMARY_FILE" ]; then
  python3 -c "
import datetime, os, sys

summary_file = '$SUMMARY_FILE'
m1_file = '$M1_STATE'
domain = '$DOMAIN'

with open(summary_file, 'r') as f:
    text = f.read()

# Extract W: lines from COMPRESSED section
lines = text.split('\n')
in_compressed = False
work_items = []
for line in lines:
    if line.strip().startswith('## COMPRESSED'):
        in_compressed = True
        continue
    if in_compressed and line.strip().startswith('## '):
        break
    if in_compressed and line.strip().startswith('W:'):
        work_items.append('- ' + line.strip()[2:].strip())

now = datetime.datetime.now().strftime('%Y-%m-%dT%H:%M+09:00')
today = datetime.datetime.now().strftime('%Y-%m-%d')

work_section = '\n'.join(work_items) if work_items else '- (handoff executed, no W: entries in COMPRESSED)'

m1_content = f'''# M1 State
STATUS: IDLE
UPDATED: {now}
OPERATOR: croppy (claude.ai)

## SESSION SUMMARY ({today})

### Session work
{work_section}

### Task State
# Task State (Updated {today})
## Active
- (none)
## Blocked
- (none)

## NEXT_ACTION
Ask DJ
'''

with open(m1_file, 'w') as f:
    f.write(m1_content)
print(f'M1.md updated: {now}')
" 2>/dev/null && log "M1.md state updated" || log "WARNING: M1.md update failed"
fi

# --- Step 8: Cleanup + notify ---
rm -f "$LOCK_FILE"
rm -f "/tmp/handoff-full-${DOMAIN}.md"
log "Handoff complete"
echo "HANDOFF_COMPLETE"
echo "NEW_CHAT: $NEW_CHAT_NAME"
echo "UUID: $NEW_UUID"
echo "URL: $NEW_URL"

bash "$NOTIFY" "✅ $DOMAIN handoff完了 → $NEW_CHAT_NAME" 2>/dev/null &
