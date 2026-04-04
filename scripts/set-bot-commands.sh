#!/bin/bash
# scripts/set-bot-commands.sh
# Register all bot commands with BotFather via setMyCommands API
# Usage: bash scripts/set-bot-commands.sh

set -e

# Load TELEGRAM_BOT_TOKEN from .env
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [[ -f "$ENV_FILE" ]]; then
  export $(grep -v '^#' "$ENV_FILE" | grep TELEGRAM_BOT_TOKEN | xargs)
fi

TOKEN="${TELEGRAM_BOT_TOKEN}"
if [[ -z "$TOKEN" ]]; then
  echo "❌ TELEGRAM_BOT_TOKEN not found in .env"
  exit 1
fi

API="https://api.telegram.org/bot${TOKEN}/setMyCommands"

echo "🤖 Registering commands with BotFather..."

# Full command list (flat, max 100 commands, max 32 chars each description)
COMMANDS=$(cat <<'ENDJSON'
{
  "commands": [
    {"command": "status",    "description": "📊 Bot status & session info"},
    {"command": "dashboard", "description": "📈 Dashboard: uptime/tasks/git/disk"},
    {"command": "quick",     "description": "⚡ Quick shortcuts panel"},
    {"command": "health",    "description": "💚 System health check"},
    {"command": "start",     "description": "🚀 Start / welcome message"},
    {"command": "new",       "description": "🆕 New Claude session"},
    {"command": "stop",      "description": "⏹ Stop current query"},
    {"command": "resume",    "description": "▶️ Resume last session"},
    {"command": "restart",   "description": "🔄 Restart bot process"},
    {"command": "retry",     "description": "🔁 Retry last message"},
    {"command": "debate",    "description": "🏛️ 3AI council debate"},
    {"command": "gpt",       "description": "🧠 Ask ChatGPT directly"},
    {"command": "gem",       "description": "💎 Ask Gemini directly"},
    {"command": "croppy",    "description": "🦞 Croppy auto-approval mode"},
    {"command": "ai",        "description": "🤖 AI session bridge"},
    {"command": "code",      "description": "💻 Code task via Claude Code"},
    {"command": "search",    "description": "🔍 Web search"},
    {"command": "cal",       "description": "📅 Google Calendar"},
    {"command": "mail",      "description": "📧 Send email"},
    {"command": "line",      "description": "💬 Send LINE message"},
    {"command": "todo",      "description": "✅ Add todo task"},
    {"command": "todos",     "description": "📋 List todo tasks"},
    {"command": "todoist",   "description": "📝 Todoist integration"},
    {"command": "task",      "description": "🎯 Task orchestrator"},
    {"command": "memory",    "description": "🧠 View memory"},
    {"command": "remember",  "description": "💾 Save memory"},
    {"command": "forget",    "description": "🗑 Delete memory"},
    {"command": "focus",     "description": "🎯 Focus mode toggle"},
    {"command": "alarm",     "description": "⏰ Set alarm"},
    {"command": "reminder",  "description": "🔔 Set reminder"},
    {"command": "morning",   "description": "☀️ Morning briefing"},
    {"command": "scout",     "description": "🔭 Scout task runner"},
    {"command": "spec",      "description": "📋 DJ spec management"},
    {"command": "decide",    "description": "✅ Record decision"},
    {"command": "decisions", "description": "📜 List decisions"},
    {"command": "audit",     "description": "📋 Audit log"},
    {"command": "stats",     "description": "📊 Usage statistics"},
    {"command": "recall",    "description": "🔍 Search chat history"},
    {"command": "why",       "description": "❓ Explain last action"},
    {"command": "help",      "description": "❓ Show command help"}
  ]
}
ENDJSON
)

RESULT=$(curl -s -X POST "$API" \
  -H "Content-Type: application/json" \
  -d "$COMMANDS")

if echo "$RESULT" | grep -q '"ok":true'; then
  echo "✅ Commands registered successfully"
else
  echo "❌ Failed to register commands:"
  echo "$RESULT"
  exit 1
fi
