#!/bin/bash
# morning-briefing.sh - 毎朝2:00自動実行
# FA業界ニュース（世界+日本）+ KEYENCE重点監視
# Claude Code Max subscription (フラット課金) のみ使用
#
# CRITICAL: < /dev/null required for headless mode via launchd

# === Config ===
PROJECT_DIR="$HOME/claude-telegram-bot"
CLAUDE_BIN="/opt/homebrew/bin/claude"
ENV_FILE="$PROJECT_DIR/.env"
LOG_DIR="/tmp/jarvis-briefing"
STOP_FILE="/tmp/jarvis-briefing-stop"
TASK_TIMEOUT=600  # 10min max (multiple web searches)

# === Setup ===
mkdir -p "$LOG_DIR"
DATE=$(date +%Y-%m-%d)
LOGFILE="$LOG_DIR/briefing-${DATE}.log"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOGFILE"; }

notify() {
  source "$ENV_FILE" 2>/dev/null || true
  echo -n "$1" > /tmp/jarvis-briefing/msg.txt
  RESP=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_ALLOWED_USERS}" \
    --data-urlencode "text@/tmp/jarvis-briefing/msg.txt")
  echo "$RESP" >> "$LOGFILE"
}

# === Stop file check ===
if [ -f "$STOP_FILE" ]; then
  log "Stop file exists, skipping"
  exit 0
fi

log "=== FA News Briefing Start ==="

# === Run Claude Code ===
PROMPT='You are DJs Factory Automation industry news briefing AI. Gather FA news from the LAST 24 HOURS covering both global and Japanese markets. KEYENCE news must NEVER be missed.

=== STEP 1: KEYENCE DEDICATED CHECK (MANDATORY) ===
Use web_fetch on these pages to check for ANY new content:
1. https://www.keyence.co.jp/company/news/ — プレスリリース・ニュース
2. https://www.keyence.co.jp/company/ir/ — IR情報

Then web_search:
3. "KEYENCE OR キーエンス" (last 7 days)
4. "keyence new product OR partnership OR acquisition 2026"

=== STEP 2: GLOBAL FA NEWS ===
Web search these queries:
5. "factory automation industry news" (last 7 days)
6. "industrial robot market 2026"
7. "Fanuc OR ABB OR Siemens OR Rockwell automation news"
8. "smart factory AI manufacturing"

=== STEP 3: JAPAN FA NEWS ===
Web search these queries:
9. "ファクトリーオートメーション ニュース 2026"
10. "ファナック OR 三菱電機 OR オムロン OR 安川電機 OR SMC 最新"
11. "製造業 DX 自動化 AI"
12. "FA 設計 省人化"

=== OUTPUT FORMAT ===
Use this exact format:

🏭 FA News [DATE]

📌 *KEYENCE*
- (KEYENCEの最新ニュースを箇条書き。なければ「特になし」)

🌍 *Global FA*
- (海外FA業界の重要ニュース3-5件)

🇯🇵 *Japan FA*
- (国内FA業界の重要ニュース3-5件)

💡 *注目トレンド*
- (今週のFA業界で注目すべき動向1-2件)

=== RULES ===
- KEYENCEセクションは必ず出力（ニュースがなくても「特になし」と明記）
- 各ニュースには情報源名を括弧で付記
- 日本語で出力
- 1件あたり1-2行で簡潔に
- IRや決算情報も含める
- 重複ニュースは統合
- 推測や古いニュースは含めない'

RESULT=$(cd "$PROJECT_DIR" && timeout "$TASK_TIMEOUT" "$CLAUDE_BIN" -p --dangerously-skip-permissions "$PROMPT" --max-turns 25 < /dev/null 2>>"$LOGFILE")
EXIT_CODE=$?

log "Claude Code exit: $EXIT_CODE"

if [ $EXIT_CODE -ne 0 ]; then
  log "ERROR: Claude Code failed (exit=$EXIT_CODE)"
  notify "🏭 FA News Briefing failed (exit=$EXIT_CODE)"
  exit 1
fi

# === Send to Telegram ===
# Truncate if too long (Telegram max 4096 chars)
RESULT_TRUNCATED=$(echo "$RESULT" | head -c 3800)

if [ -n "$RESULT_TRUNCATED" ]; then
  notify "$RESULT_TRUNCATED"
  log "Sent to Telegram (${#RESULT_TRUNCATED} chars)"
else
  notify "🏭 FA News Briefing ${DATE} - empty response"
  log "Empty response, sent default"
fi

log "=== FA News Briefing Done ==="
