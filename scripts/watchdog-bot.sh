#!/bin/bash

# ============================================
# Croppy Watchdog - Bot自動復旧デーモン
# ============================================
# 30秒間隔でBotのヘルスチェックを行い、
# 異常検出時に自動で再起動する。
#
# 検出する異常:
#   1. プロセス死亡（クラッシュ、OOM等）
#   2. 409 Conflictエラー（多重起動）
#   3. サイレント死亡（プロセスは生きてるがログ更新なし）
#
# このスクリプト自体はLaunchAgentで常駐させる。
# ============================================

PROJECT_DIR="$HOME/claude-telegram-bot"
PID_FILE="$PROJECT_DIR/.bot.pid"
LOG_FILE="$PROJECT_DIR/logs/bot.log"
WATCHDOG_LOG="$PROJECT_DIR/logs/watchdog.log"
RESTART_SCRIPT="$PROJECT_DIR/scripts/start-bot.sh"
LOCKFILE="/tmp/croppy-watchdog.lock"

# --- 設定 ---
CHECK_INTERVAL=30          # ヘルスチェック間隔（秒）
SILENT_DEATH_THRESHOLD=900 # ログ無更新でサイレント死亡とみなす秒数（15分）※Bot側で5分間隔のheartbeatログあり
MAX_RESTARTS_PER_HOUR=5    # 1時間あたりの最大再起動回数（無限ループ防止）
RESTART_COUNT_FILE="/tmp/croppy-restart-count"
BACKOFF_STATE_FILE="/tmp/croppy-backoff-state"

# Exponential Backoff 設定
# リスタート間隔: 0s → 10s → 60s → 300s → 1800s
BACKOFF_DELAYS=(0 10 60 300 1800)

# --- ログ関数 ---
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [watchdog] $1"
    echo "$msg" >> "$WATCHDOG_LOG"
    echo "$msg" >&2
}

# --- 排他ロック ---
acquire_lock() {
    if [ -f "$LOCKFILE" ]; then
        local old_pid
        old_pid=$(cat "$LOCKFILE" 2>/dev/null)
        if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
            echo "Watchdog already running (PID $old_pid)" >&2
            exit 0
        fi
        rm -f "$LOCKFILE"
    fi
    echo $$ > "$LOCKFILE"
}

release_lock() {
    rm -f "$LOCKFILE"
}

trap release_lock EXIT INT TERM

# --- 再起動レート制限 ---
check_restart_rate() {
    local now
    now=$(date +%s)

    # カウントファイルが無い or 1時間以上前ならリセット
    if [ ! -f "$RESTART_COUNT_FILE" ]; then
        echo "$now 0" > "$RESTART_COUNT_FILE"
        return 0
    fi

    local first_ts count
    read -r first_ts count < "$RESTART_COUNT_FILE"

    local elapsed=$(( now - first_ts ))
    if [ "$elapsed" -ge 3600 ]; then
        # 1時間経過、リセット
        echo "$now 0" > "$RESTART_COUNT_FILE"
        return 0
    fi

    if [ "$count" -ge "$MAX_RESTARTS_PER_HOUR" ]; then
        log "RATE LIMIT: 1時間に${MAX_RESTARTS_PER_HOUR}回再起動済み。次のウィンドウまで待機"
        return 1
    fi

    return 0
}

increment_restart_count() {
    local now
    now=$(date +%s)

    if [ ! -f "$RESTART_COUNT_FILE" ]; then
        echo "$now 1" > "$RESTART_COUNT_FILE"
        return
    fi

    local first_ts count
    read -r first_ts count < "$RESTART_COUNT_FILE"
    local elapsed=$(( now - first_ts ))

    if [ "$elapsed" -ge 3600 ]; then
        echo "$now 1" > "$RESTART_COUNT_FILE"
    else
        echo "$first_ts $(( count + 1 ))" > "$RESTART_COUNT_FILE"
    fi
}

# --- Exponential Backoff ---
get_backoff_level() {
    if [ ! -f "$BACKOFF_STATE_FILE" ]; then
        echo 0
        return
    fi
    local level last_success
    read -r level last_success < "$BACKOFF_STATE_FILE"
    local now
    now=$(date +%s)
    local since_success=$(( now - last_success ))

    # 10分成功が続いたらレベルをリセット
    if [ "$since_success" -ge 600 ] && [ "$level" -gt 0 ]; then
        echo 0
        return
    fi
    echo "$level"
}

increment_backoff() {
    local current_level
    current_level=$(get_backoff_level)
    local max_idx=$(( ${#BACKOFF_DELAYS[@]} - 1 ))
    local new_level=$(( current_level + 1 ))
    if [ "$new_level" -gt "$max_idx" ]; then
        new_level=$max_idx
    fi
    echo "$new_level $(date +%s)" > "$BACKOFF_STATE_FILE"
    log "BACKOFF: level $current_level → $new_level (next wait: ${BACKOFF_DELAYS[$new_level]}s)"

    # 最大レベルに達したらTelegram通知
    if [ "$new_level" -ge "$max_idx" ]; then
        local token
        token=$(grep TELEGRAM_BOT_TOKEN "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
        local chat_id
        chat_id=$(grep TELEGRAM_ALLOWED_USERS "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" | cut -d, -f1)
        if [ -n "$token" ] && [ -n "$chat_id" ]; then
            curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" \
                -d "chat_id=${chat_id}" \
                -d "text=⚠️ Watchdog: 最大バックオフレベル到達。手動介入が必要な可能性あり。" > /dev/null 2>&1
        fi
    fi
}

reset_backoff() {
    if [ -f "$BACKOFF_STATE_FILE" ]; then
        rm -f "$BACKOFF_STATE_FILE"
        log "BACKOFF: Reset to level 0 (bot is healthy)"
    fi
}

get_backoff_delay() {
    local level
    level=$(get_backoff_level)
    echo "${BACKOFF_DELAYS[$level]}"
}

# --- ヘルスチェック関数 ---

# プロセス生存チェック
check_process_alive() {
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0  # 生きてる
        fi
    fi

    # PIDファイルが無くてもプロセスが居るかチェック
    if pgrep -f "bun.*index.ts" > /dev/null 2>&1; then
        return 0  # 生きてる
    fi

    return 1  # 死んでる
}

# 409 Conflict チェック（直近のログから）
check_409_error() {
    if [ ! -f "$LOG_FILE" ]; then
        return 1  # ログなし = 問題なし
    fi

    # 直近50行でGrammyErrorの409のみチェック（jarvis_context等の文字列は除外）
    if tail -50 "$LOG_FILE" 2>/dev/null | grep -q "GrammyError.*409\|terminated by other getUpdates"; then
        return 0  # 409検出
    fi

    return 1  # 問題なし
}

# サイレント死亡チェック（ログが長時間更新されていない）
check_silent_death() {
    if [ ! -f "$LOG_FILE" ]; then
        return 1  # ログなし = 判断不能、問題なしとする
    fi

    local now last_mod age
    now=$(date +%s)

    # macOS: stat -f %m, Linux: stat -c %Y
    if [[ "$(uname)" == "Darwin" ]]; then
        last_mod=$(stat -f %m "$LOG_FILE" 2>/dev/null || echo "$now")
    else
        last_mod=$(stat -c %Y "$LOG_FILE" 2>/dev/null || echo "$now")
    fi

    age=$(( now - last_mod ))

    if [ "$age" -ge "$SILENT_DEATH_THRESHOLD" ]; then
        return 0  # サイレント死亡の可能性
    fi

    return 1  # 問題なし
}

# --- 再起動実行 ---
do_restart() {
    local reason="$1"
    log "RESTART: $reason"

    if ! check_restart_rate; then
        return 1
    fi

    # Exponential Backoff: 待機
    local delay
    delay=$(get_backoff_delay)
    if [ "$delay" -gt 0 ]; then
        log "BACKOFF: ${delay}s 待機してからリスタート..."
        sleep "$delay"
    fi

    increment_restart_count
    increment_backoff

    log "start-bot.sh を実行中..."
    if WATCHDOG_RESTART=1 RESTART_REASON="$reason" RESTART_TASK="watchdog自動復旧" bash "$RESTART_SCRIPT" >> "$WATCHDOG_LOG" 2>&1; then
        log "RESTART SUCCESS"
        return 0
    else
        log "RESTART FAILED"
        return 1
    fi
}

# --- メインループ ---
main() {
    mkdir -p "$(dirname "$WATCHDOG_LOG")"
    acquire_lock
    log "Watchdog started (PID $$, interval=${CHECK_INTERVAL}s)"

    # 初回: Botが動いていなければ起動
    if ! check_process_alive; then
        log "INIT: Botが動いていない。初回起動する"
        do_restart "watchdog初回起動"
    fi

    while true; do
        local needs_restart=false
        local restart_reason=""

        # チェック1: プロセス生存
        if ! check_process_alive; then
            log "ALERT: Botプロセスが見つからない"
            needs_restart=true
            restart_reason="プロセス死亡を検出"
        fi

        # チェック2: 409エラー
        if [ "$needs_restart" = false ] && check_409_error; then
            log "ALERT: 409 Conflictエラーを検出"
            needs_restart=true
            restart_reason="409 Conflictエラー（多重起動）"
        fi

        # チェック3: サイレント死亡
        if [ "$needs_restart" = false ] && check_silent_death; then
            log "ALERT: ログが${SILENT_DEATH_THRESHOLD}秒以上更新されていない"
            needs_restart=true
            restart_reason="サイレント死亡の疑い（ログ無更新）"
        fi

        if [ "$needs_restart" = true ]; then
            do_restart "$restart_reason"
        else
            # 全チェックOK → backoffリセット
            reset_backoff
        fi

        sleep "$CHECK_INTERVAL"
    done
}

main "$@"
