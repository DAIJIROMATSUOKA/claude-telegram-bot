#!/bin/bash
# morning-briefing.sh - 毎朝2:30自動実行
# 公式情報源 + web searchでDJスタック改善情報を収集
# Claude Code Max subscription (フラット課金) のみ使用
#
# CRITICAL: < /dev/null required for headless mode via launchd

# === Config ===
PROJECT_DIR="$HOME/claude-telegram-bot"
CLAUDE_BIN="/opt/homebrew/bin/claude"
ENV_FILE="$PROJECT_DIR/.env"
LOG_DIR="/tmp/jarvis-briefing"
STOP_FILE="/tmp/jarvis-briefing-stop"
TASK_TIMEOUT=300  # 5min max

# === Setup ===
mkdir -p "$LOG_DIR"
DATE=$(date +%Y-%m-%d)
LOGFILE="$LOG_DIR/briefing-${DATE}.log"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOGFILE"; }

notify() {
  source "$ENV_FILE" 2>/dev/null || true
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_ALLOWED_USERS}" \
    -d "parse_mode=Markdown" \
    -d "text=$1" > /dev/null 2>&1 || true
}

# === Stop file check ===
if [ -f "$STOP_FILE" ]; then
  log "Stop file exists, skipping"
  exit 0
fi

log "=== Morning Briefing Start ==="

# === Run Claude Code ===
PROMPT='You are DJs morning briefing AI. Check the following sources for updates in the LAST 24 HOURS that could dramatically improve DJs automation system.

DJ SYSTEM STACK:
- Claude Code (Anthropic Max subscription, CLI, MCP servers, hooks)
- Telegram Bot (Grammy framework, Bun runtime)
- ComfyUI + FLUX (image generation, LoRA, GGUF models)
- macOS launchd (process management, cron)
- Cloudflare Workers + D1 (API gateway, database)
- MCP protocol (tool integration)
- Python scripts for AI media processing

CHECK THESE OFFICIAL SOURCES (use web_fetch):
1. https://docs.anthropic.com/en/docs/changelog - Anthropic API/Claude changes
2. https://github.com/anthropics/claude-code/releases - Claude Code releases
3. https://github.com/comfyanonymous/ComfyUI/releases - ComfyUI releases
4. https://github.com/oven-sh/bun/releases - Bun runtime releases
5. https://core.telegram.org/bots/api-changelog - Telegram Bot API changes

ALSO WEB SEARCH these queries:
- "Claude Code new features" (last 7 days)
- "ComfyUI new workflow optimization" (last 7 days)
- "MCP server new release 2026" (last 7 days)
- "AI coding agent breakthrough" (last 7 days)

JUDGMENT CRITERIA:
"Dramatic improvement" = something that should make DJ change his architecture, workflow, or tooling NOW. Not minor bugfixes or incremental updates.

OUTPUT FORMAT:
If NOTHING dramatic found:
Morning Briefing [DATE]
特になし

If something found:
Morning Briefing [DATE]
[Source] What changed
-> Impact on DJ system
-> Recommended action

Be extremely selective. DJ only wants to hear about game-changers, not noise.'

RESULT=$(cd "$PROJECT_DIR" && timeout "$TASK_TIMEOUT" "$CLAUDE_BIN" -p --dangerously-skip-permissions "$PROMPT" --max-turns 15 < /dev/null 2>>"$LOGFILE")
EXIT_CODE=$?

log "Claude Code exit: $EXIT_CODE"

if [ $EXIT_CODE -ne 0 ]; then
  log "ERROR: Claude Code failed (exit=$EXIT_CODE)"
  notify "Morning Briefing failed (exit=$EXIT_CODE)"
  exit 1
fi

# === Send to Telegram ===
# Truncate if too long (Telegram max 4096 chars)
RESULT_TRUNCATED=$(echo "$RESULT" | head -c 3800)

if [ -n "$RESULT_TRUNCATED" ]; then
  notify "$RESULT_TRUNCATED"
  log "Sent to Telegram (${#RESULT_TRUNCATED} chars)"
else
  notify "Morning Briefing ${DATE} - empty response"
  log "Empty response, sent default"
fi

log "=== Morning Briefing Done ==="
