#!/bin/bash

# ============================================
# Bot Launcher for LaunchAgent
# ============================================
# LaunchAgentから呼ばれるラッパー。
# .envを読み込んでからbun を exec する。
# start-bot.sh と異なり、プロセス管理は行わない
# （それはwatchdogの仕事）。
# ============================================

cd "$HOME/claude-telegram-bot" || exit 1

# .env読み込み
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# PIDファイル書き込み
echo $$ > .bot.pid

# exec でbunに置き換え（LaunchAgentが直接bunプロセスを管理できる）
exec "$HOME/.bun/bin/bun" run src/index.ts
