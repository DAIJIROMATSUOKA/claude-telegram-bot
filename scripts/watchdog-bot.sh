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

    increment_restart_count

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
        # チェック1: プロセス生存
        if ! check_process_alive; then
            log "ALERT: Botプロセスが見つからない"
            do_restart "プロセス死亡を検出"
            sleep "$CHECK_INTERVAL"
            continue
        fi

        # チェック2: 409エラー
        if check_409_error; then
            log "ALERT: 409 Conflictエラーを検出"
            do_restart "409 Conflictエラー（多重起動）"
            sleep "$CHECK_INTERVAL"
            continue
        fi

        # チェック3: サイレント死亡
        if check_silent_death; then
            log "ALERT: ログが${SILENT_DEATH_THRESHOLD}秒以上更新されていない"
            do_restart "サイレント死亡の疑い（ログ無更新）"
            sleep "$CHECK_INTERVAL"
            continue
        fi

        sleep "$CHECK_INTERVAL"
    done
}

main "$@"
