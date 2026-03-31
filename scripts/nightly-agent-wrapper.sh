#!/bin/zsh
# Nightly Agent - calls Jarvis Agent SDK endpoint (localhost:3847)
cd ~/claude-telegram-bot || exit 1

PROMPT='あなたはNightly Agent。DJは朝3時に起きてTelegramでこのレポートを読む。技術者ではない経営者にも分かる言葉で書け。ファイルは絶対に変更するな。以下を順番に実行: 1. bun test 実行 2. git status --short と git log --oneline -3 3. src/handlers/ 内のTODO/FIXME検索 4. コードベースを読んで改善提案を1つ考える（diffフォーマットで、適用はしない） 報告フォーマット（この通り出力）: 🌙 おはよう DJ 【健康状態】テスト結果とシステム状態を1行で。 【DJアクション】すべきことがあれば。なければ なし。 【改善アイデア】2-3行で。diffはその下に。 日本語で短く。'

JSON_BODY=$(python3 -c "import json,sys; print(json.dumps({'prompt': sys.argv[1]}))" "$PROMPT")

curl -s -X POST http://localhost:3847/agent-task \
  -H 'Content-Type: application/json' \
  -d "$JSON_BODY" \
  --max-time 300 > /tmp/nightly-agent-result.json 2>&1

echo "$(date): done (exit=$?)" >> /tmp/nightly-agent.log
