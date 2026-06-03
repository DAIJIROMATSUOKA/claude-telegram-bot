#!/bin/bash
# notify.sh — Unified outbound notification transport (Phase 0 / TG縮退設計).
#
# 全 cron/script 通知をここ一本に集約する母体。Telegram がトランスポート(DECIDED 2026-06-03)。
# 設計上の要点(CC-ONLY-MIGRATION-DESIGN.md):
#   - H1 対策: 🗑ボタンは【既定オフ】。インタラクション不要のpushは bot-callback 依存を断つ
#     (= 押せないゴーストボタンを送らない / transport と bot を疎結合に)。
#   - M4 対策: 配信ログ + 失敗時リトライキュー。RC未接続/ネット断の取りこぼしをバッファ。
#   - トランスポート差替可: NOTIFY_TRANSPORT=telegram(既定)。将来の後継に差し替えやすく。
#
# 使い方:
#   notify.sh "メッセージ"                  # プレーン通知(ボタン無し)
#   notify.sh "メッセージ" --button          # 🗑削除ボタン付き(bot callback必要)
#   notify.sh "メッセージ" --parse HTML       # parse_mode
#   notify.sh "メッセージ" --tag inbox        # 配信ログ用タグ
#   echo "メッセージ" | notify.sh -           # stdin
#   notify.sh --flush-retry                  # リトライキューの再送のみ
#
# ⚠️ ライブ切替前提: 本ファイルは新規追加。既存 notify-dj.sh は無傷。
#    カットオーバー(各呼出元をこれに向ける)と実送信テストは別途(要 .env / 実機)。
set -uo pipefail

ENV_FILE="${ENV_FILE:-$HOME/claude-telegram-bot/.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && source "$ENV_FILE" 2>/dev/null

LOG_DIR="${NOTIFY_LOG_DIR:-$HOME/claude-telegram-bot/logs}"
mkdir -p "$LOG_DIR" 2>/dev/null
LOG="$LOG_DIR/notify.log"
RETRYQ="$LOG_DIR/notify-retry.ndjson"
TRANSPORT="${NOTIFY_TRANSPORT:-telegram}"

# --- parse args ---
MSG=""; PARSE=""; BUTTON=0; TAG="-"; FLUSH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --button) BUTTON=1; shift ;;
    --parse) PARSE="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --flush-retry) FLUSH=1; shift ;;
    -) MSG="$(cat)"; shift ;;
    *) MSG="$1"; shift ;;
  esac
done

now(){ python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).isoformat())" 2>/dev/null || echo "?"; }
logline(){ printf '%s\t%s\t%s\t%s\n' "$(now)" "$TAG" "$TRANSPORT" "$1" >> "$LOG"; }

# --- transport: telegram ---
send_telegram(){
  local msg="$1"
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_ALLOWED_USERS:-}" ]; then
    echo "ERR: TELEGRAM_BOT_TOKEN/TELEGRAM_ALLOWED_USERS unset (env: $ENV_FILE)" >&2
    return 1
  fi
  local args=(-s -o /dev/null -w '%{http_code}'
    -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"
    -d "chat_id=$TELEGRAM_ALLOWED_USERS"
    --data-urlencode "text=$msg")
  [ -n "$PARSE" ] && args+=(-d "parse_mode=$PARSE")
  if [ "$BUTTON" = "1" ]; then
    args+=(-d 'reply_markup={"inline_keyboard":[[{"text":"🗑","callback_data":"ib:del:sys"}]]}')
  fi
  local code; code=$(curl "${args[@]}" 2>/dev/null)
  [ "$code" = "200" ]
}

send(){ case "$TRANSPORT" in telegram) send_telegram "$1" ;; *) echo "ERR: unknown transport $TRANSPORT" >&2; return 1 ;; esac; }

enqueue_retry(){ printf '{"ts":"%s","tag":"%s","msg":%s,"parse":"%s","button":%d}\n' \
  "$(now)" "$TAG" "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1")" "$PARSE" "$BUTTON" >> "$RETRYQ"; }

# --- flush retry queue ---
if [ "$FLUSH" = "1" ]; then
  [ -f "$RETRYQ" ] || { echo "no retry queue"; exit 0; }
  TMP="$RETRYQ.work"; mv "$RETRYQ" "$TMP"
  ok=0; fail=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    m=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["msg"])' "$line" 2>/dev/null)
    if send "$m"; then ok=$((ok+1)); logline "retry-ok"; else fail=$((fail+1)); echo "$line" >> "$RETRYQ"; fi
  done < "$TMP"
  rm -f "$TMP"
  echo "retry flush: ok=$ok fail=$fail"
  exit 0
fi

# --- normal send ---
[ -z "$MSG" ] && { echo "usage: notify.sh \"message\" [--button] [--parse HTML] [--tag NAME]" >&2; exit 1; }
if send "$MSG"; then
  logline "ok"
else
  logline "fail->queued"
  enqueue_retry "$MSG"
  echo "WARN: send failed, queued for retry ($RETRYQ)" >&2
  exit 1
fi
