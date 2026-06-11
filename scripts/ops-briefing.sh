#!/bin/bash
# ops-briefing.sh - 毎朝2:15自動実行
# DJの運用を世界トップ1%にするための情報配信
# X(Twitter)重点 + 英語記事は日本語翻訳
# Claude Code Max subscription (フラット課金) のみ使用
#
# CRITICAL: < /dev/null required for headless mode via launchd

# === Config ===
PROJECT_DIR="$HOME/claude-telegram-bot"
CLAUDE_BIN="/opt/homebrew/bin/claude"
ENV_FILE="$PROJECT_DIR/.env"
LOG_DIR="/tmp/jarvis-briefing"
STOP_FILE="/tmp/jarvis-briefing-stop"
TASK_TIMEOUT=600  # 10min max

# === Setup ===
mkdir -p "$LOG_DIR"
DATE=$(date +%Y-%m-%d)
LOGFILE="$LOG_DIR/ops-briefing-${DATE}.log"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOGFILE"; }

# notify via Python (shell eval breaks on special chars in BOT_TOKEN)
notify() {
  local MSG_FILE="$LOG_DIR/.tg-msg-$$.txt"
  echo "$1" > "$MSG_FILE"
  python3 "$PROJECT_DIR/scripts/line-notify.py" --file "$MSG_FILE" 2>&1 | tee -a "$LOGFILE"
  rm -f "$MSG_FILE"
}

# === Stop file check ===
if [ -f "$STOP_FILE" ]; then
  log "Stop file exists, skipping"
  exit 0
fi

log "=== Ops Excellence Briefing Start ==="

# === Run Claude Code ===
PROMPT='You are DJs operations excellence briefing AI. DJ is CEO of a Factory Automation design engineering company (Kikai Lab). Your mission: find information from the LAST 7 DAYS that can push DJs operations into the global top 1%.

FOCUS AREAS:
1. AI-powered automation for business operations
2. Claude Code / AI coding agent workflows and tips
3. Solo CEO / small team productivity systems
4. FA industry competitive intelligence
5. Cutting-edge engineering tools and methods

=== STEP 1: X (TWITTER) - PRIMARY SOURCE ===
Search X/Twitter heavily using web_search with site:x.com:
1. site:x.com "Claude Code" tips OR workflow OR hack
2. site:x.com AI automation business operations 2026
3. site:x.com factory automation engineering AI
4. site:x.com solopreneur CEO AI productivity
5. site:x.com MCP server new release
6. site:x.com Anthropic Claude new feature

=== STEP 2: WEB - SUPPLEMENTARY ===
Web search for deeper articles:
7. "AI workflow automation for small business" 2026
8. "Claude Code productivity tips" OR "AI coding agent best practices"
9. "factory automation design engineering competitive advantage"
10. "one person company AI tools" 2026

=== STEP 3: TRANSLATE & CURATE ===
- ALL English content must be translated to Japanese
- Include original X post author handle when citing X
- Rate each item: how actionable is this for DJ? (即実行可能 / 検討価値あり / 参考情報)

=== OUTPUT FORMAT (plain text, NO markdown) ===

🚀 Ops Excellence [DATE]

🐦 X Highlights
- (@handle) 内容の日本語要約 [即実行可能/検討価値あり/参考情報]
- (3-5 items from X)

🔧 AI Ops & Tools
- ツールや手法の紹介（日本語） [即実行可能/検討価値あり/参考情報]
- (2-3 items)

🏭 FA Competitive Edge
- FA業界の競争優位に繋がる情報 [即実行可能/検討価値あり/参考情報]
- (1-2 items)

⚡ Today Action
- 今日DJが最初にやるべき1つのアクション（具体的に）

=== RULES ===
- X/Twitterの投稿を最重視（生の実践知が最も価値が高い）
- 英語は全て日本語に翻訳して配信
- 各項目にアクション可能度を明記
- 1件あたり1-2行で簡潔に
- 理論より実践、概念より具体的手順を優先
- 古い情報や一般論は含めない
- IMPORTANT: Do NOT use any markdown formatting (no *, no _, no ` ). Plain text only.'

RESULT=$(cd "$PROJECT_DIR" && timeout "$TASK_TIMEOUT" "$CLAUDE_BIN" -p --dangerously-skip-permissions "$PROMPT" --max-turns 25 < /dev/null 2>>"$LOGFILE")
EXIT_CODE=$?

log "Claude Code exit: $EXIT_CODE"

if [ $EXIT_CODE -ne 0 ]; then
  log "ERROR: Claude Code failed (exit=$EXIT_CODE)"
  notify "🚀 Ops Briefing failed (exit=$EXIT_CODE)"
  exit 1
fi

# === Send to Telegram ===
RESULT_TRUNCATED=$(echo "$RESULT" | head -c 3800)

if [ -n "$RESULT_TRUNCATED" ]; then
  notify "$RESULT_TRUNCATED"
  log "Sent to Telegram (${#RESULT_TRUNCATED} chars)"
else
  notify "🚀 Ops Excellence Briefing ${DATE} - empty response"
  log "Empty response, sent default"
fi

log "=== Ops Excellence Briefing Done ==="
