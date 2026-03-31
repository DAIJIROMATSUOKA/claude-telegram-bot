#!/bin/zsh
# Nightly Agent wrapper - loads env and runs agent
cd ~/claude-telegram-bot || exit 1
export $(grep -E '^TELEGRAM_BOT_TOKEN=|^TELEGRAM_ALLOWED_USERS=' .env | xargs)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
~/.bun/bin/bun run src/bin/nightly-agent.ts 2>&1 | tee /tmp/nightly-agent.log
