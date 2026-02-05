#!/bin/bash
# Restart Jarvis Telegram Bot on mothership

echo "🔄 Restarting Jarvis Telegram Bot..."

# Find and kill existing bot process
echo "Stopping existing bot process..."
pkill -f "claude-telegram-bot" || echo "No existing process found"

# Wait a moment
sleep 2

# Start bot
cd /Users/daijiromatsuokam1/claude-telegram-bot
echo "Starting bot..."
bun run src/index.ts &

echo "✅ Bot restarted with updated AI_MEMORY_DOC_ID"
echo "Process ID: $!"
