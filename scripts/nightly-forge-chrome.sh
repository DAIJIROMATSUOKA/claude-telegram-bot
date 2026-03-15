#!/bin/bash
# nightly-forge-chrome.sh — Nightly Forge v2: Chrome Worker Tab execution loop
#
# G11: Chrome Tab + local exec loop (think in claude.ai -> execute on M1 -> post results)
# G12: DESIGN-RULES.md inject at start
# G13: 5-line checkpoint per step + Obsidian full log
#
# Flow: inject prompt -> 5s wait -> wait-response -> parse exec blocks -> execute -> inject results -> repeat
# Safety: max steps, max runtime, stop flag, command blocklist

set -uo pipefail

# --- Config ---
WORKER_WT="1:6"
TAB_MANAGER="$HOME/claude-telegram-bot/scripts/croppy-tab-manager.sh"
PROJECT_DIR="$HOME/claude-telegram-bot"
LOG_DIR="$PROJECT_DIR/logs/nightly"
OBSIDIAN_BASE="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian/90_System/NightlyForge"
NIGHTLY_TASK_FILE="$HOME/claude-telegram-bot/autonomous/state/nightly-tasks.md"
STOP_FLAG="/tmp/jarvis-nightly-stop"
NIGHTLY_MODE="/tmp/nightly-mode"
LOCK_FILE="/tmp/nightly-forge-chrome.lock"
MAX_STEPS=10
MAX_RUNTIME=14400  # 4 hours
WAIT_TIMEOUT=300   # 5 min per AI response
DATE=$(date +%Y-%m-%d)
TIME_START=$(date +%s)

BACKUP_DIR="/tmp/nightly-forge"

WORKER_PROJECT_URL="https://claude.ai/project/019c15f4-3d2d-7263-a308-e7f6ccd6b3f8"
mkdir -p "$LOG_DIR"
mkdir -p "$OBSIDIAN_BASE"
mkdir -p "$BACKUP_DIR"

LOG_FILE="$LOG_DIR/${DATE}-forge-chrome.log"
OBSIDIAN_FILE="$OBSIDIAN_BASE/${DATE}-forge.md"

# --- Helpers ---
log() {
  echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

notify() {
  bash ~/scripts/notify-line.sh "$1" 2>/dev/null || true
}

obsidian_append() {
  echo "$1" >> "$OBSIDIAN_FILE"
}

elapsed_seconds() {
  echo $(( $(date +%s) - TIME_START ))
}

cleanup() {
  rm -f "$LOCK_FILE" "$NIGHTLY_MODE"
  log "Cleanup done"
}

# G13: 5-line checkpoint + test metrics
checkpoint() {
  local step="$1" task="$2" status="$3" result="$4" next="$5"
  # Collect bun test metrics
  local test_line=""
  local test_output
  test_output=$(cd "$PROJECT_DIR" && timeout 60 bun test 2>&1 || true)
  local test_pass test_fail
  test_pass=$(echo "$test_output" | grep -oE '[0-9]+ pass' | grep -oE '[0-9]+' || echo "0")
  test_fail=$(echo "$test_output" | grep -oE '[0-9]+ fail' | grep -oE '[0-9]+' || echo "0")
  test_line="METRIC: test_pass=${test_pass:-0} test_fail=${test_fail:-0}"

  local cp="STEP: ${step}/${MAX_STEPS}
TASK: ${task}
STATUS: ${status}
RESULT: ${result}
NEXT: ${next}
${test_line}"
  log "--- CHECKPOINT ---"
  log "$cp"
  obsidian_append "### Checkpoint ${step}
\`\`\`
${cp}
\`\`\`
"
}

# inject-file + 5s fixed wait + wait-response (CONV_LIMIT aware)
inject_and_wait() {
  local text_file="$1"
  local timeout="${2:-$WAIT_TIMEOUT}"

  # Pre-inject: wait for stable READY (3 consecutive checks over 6s)
  # Handles BUSY from web searches, tool calls, or previous response still streaming
  local _ready_count=0
  for _wait_i in $(seq 1 60); do
    local _pre_status
    _pre_status=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
    if [ "$_pre_status" = "CONV_LIMIT" ] || [ "$_pre_status" = "RATE_LIMIT" ]; then
      echo "ERROR:$_pre_status"
      rm -f "$text_file"
      return 0
    elif [ "$_pre_status" = "READY" ]; then
      _ready_count=$((_ready_count + 1))
      if [ "$_ready_count" -ge 3 ]; then
        break
      fi
    else
      _ready_count=0  # Reset on any non-READY
      if [ "$_wait_i" = "1" ]; then
        log "inject_and_wait: waiting for stable READY (status=$_pre_status)..."
      fi
    fi
    sleep 2
  done
  if [ "$_ready_count" -lt 3 ]; then
    log "inject_and_wait: never reached stable READY after 120s"
    rm -f "$text_file"
    echo "INJECT_TIMEOUT"
    return 1
  fi

  # Inject with retry
  local inject_ok=0
  for _attempt in 1 2 3; do
    local _inject_out
    _inject_out=$(bash "$TAB_MANAGER" inject-file "$WORKER_WT" "$text_file" 2>/dev/null)
    if echo "$_inject_out" | grep -q "INSERTED"; then
      inject_ok=1
      break
    fi
    log "inject_and_wait: attempt $_attempt failed ($_inject_out), retrying in 5s..."
    sleep 5
  done
  rm -f "$text_file"

  if [ "$inject_ok" != "1" ]; then
    log "inject_and_wait: all inject attempts failed"
    echo "INJECT_FAILED"
    return 1
  fi

  # 5-second fixed wait: Claude takes 3-5s to start processing
  sleep 5

  # Check status before waiting
  local s1
  s1=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)

  # CONV_LIMIT / RATE_LIMIT: return special signal for caller to handle
  if [ "$s1" = "CONV_LIMIT" ] || [ "$s1" = "RATE_LIMIT" ]; then
    echo "ERROR:$s1"
    return 0
  fi

  # Double READY check
  if [ "$s1" = "READY" ]; then
    sleep 1
    local s2
    s2=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
    if [ "$s2" = "CONV_LIMIT" ] || [ "$s2" = "RATE_LIMIT" ]; then
      echo "ERROR:$s2"
      return 0
    fi
    if [ "$s2" = "READY" ]; then
      local resp
      resp=$(bash "$TAB_MANAGER" read-response "$WORKER_WT" 2>/dev/null)
      echo "$resp"
      return 0
    fi
  fi

  # Normal poll: BUSY -> READY
  local wait_result
  wait_result=$(bash "$TAB_MANAGER" wait-response "$WORKER_WT" "$timeout" 2>/dev/null)

  # Post-wait status check (might have hit CONV_LIMIT during generation)
  local post_status
  post_status=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
  if [ "$post_status" = "CONV_LIMIT" ] || [ "$post_status" = "RATE_LIMIT" ]; then
    echo "ERROR:$post_status"
    return 0
  fi

  echo "$wait_result"
}

inject_text() {
  local tmp="/tmp/nightly-forge-msg-$$.txt"
  echo "$1" > "$tmp"
  inject_and_wait "$tmp" "${2:-$WAIT_TIMEOUT}"
}

# Safety check for commands
is_blocked() {
  local cmd="$1"
  echo "$cmd" | grep -qiE 'git push|git reset --hard|rm -rf /|rm -rf ~|\.env|API_KEY|TELEGRAM_BOT_TOKEN|sudo |launchctl unload|launchctl load|launchctl remove|pkill|kill -9|npm publish|chmod 777|crontab' && return 0
  return 1
}

# Backup nightly-tasks.md before any modifications
backup_nightly_tasks() {
  if [ -f "$NIGHTLY_TASK_FILE" ]; then
    cp "$NIGHTLY_TASK_FILE" "$BACKUP_DIR/nightly-tasks-${DATE}.md.bak"
    log "Backed up nightly-tasks.md to $BACKUP_DIR/"
  fi
}

# Validate nightly-tasks.md structure; restore from backup if corrupted
validate_nightly_tasks() {
  if [ ! -f "$NIGHTLY_TASK_FILE" ]; then
    log "WARN: nightly-tasks.md missing, restoring from backup"
    cp "$BACKUP_DIR/nightly-tasks-${DATE}.md.bak" "$NIGHTLY_TASK_FILE" 2>/dev/null && return 0
    log "ERROR: no backup available to restore"
    return 1
  fi
  # Check required headers exist
  local has_active has_blocked has_rules
  has_active=$(grep -c '^## Active' "$NIGHTLY_TASK_FILE" || true)
  has_blocked=$(grep -c '^## Blocked' "$NIGHTLY_TASK_FILE" || true)
  has_rules=$(grep -c '^## Rules' "$NIGHTLY_TASK_FILE" || true)
  if [ "$has_active" -eq 0 ] || [ "$has_blocked" -eq 0 ] || [ "$has_rules" -eq 0 ]; then
    log "WARN: nightly-tasks.md structure corrupted (Active=$has_active Blocked=$has_blocked Rules=$has_rules), restoring"
    cp "$BACKUP_DIR/nightly-tasks-${DATE}.md.bak" "$NIGHTLY_TASK_FILE" 2>/dev/null && return 0
    log "ERROR: restore failed"
    return 1
  fi
  return 0
}

# --- Pre-flight ---
if [ -f "$STOP_FLAG" ]; then
  echo "Stop flag exists. Exiting."
  exit 0
fi

if [ -f "$LOCK_FILE" ]; then
  OLD_PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Already running (PID $OLD_PID)"
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap cleanup EXIT
touch "$NIGHTLY_MODE"

# Check Worker Tab health (with auto-recovery for TOOL_LIMIT)
STATUS=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
if [ "$STATUS" = "TOOL_LIMIT" ]; then
  log "Worker Tab has TOOL_LIMIT, auto-clicking Continue..."
  bash "$TAB_MANAGER" auto-continue "$WORKER_WT" 2>/dev/null || true
  sleep 5
  STATUS=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
fi
if [ "$STATUS" = "BUSY" ]; then
  log "Worker Tab BUSY, waiting up to 120s..."
  DRAIN=$(bash "$TAB_MANAGER" wait-response "$WORKER_WT" 120 2>/dev/null)
  STATUS=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
fi
# CONV_LIMIT: auto-navigate to fresh chat
if [ "$STATUS" = "CONV_LIMIT" ]; then
  log "Worker Tab CONV_LIMIT, opening fresh chat..."
  WIDX=$(echo "$WORKER_WT" | cut -d: -f1)
  TIDX=$(echo "$WORKER_WT" | cut -d: -f2)
  osascript -e "tell application \"Google Chrome\" to set URL of tab $TIDX of window $WIDX to \"$WORKER_PROJECT_URL\"" 2>/dev/null || true
  log "Navigated to project URL, waiting for load..."
  sleep 10
  STATUS=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
  if [ "$STATUS" != "READY" ]; then
    sleep 10
    STATUS=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
  fi
  log "Post-navigate status: $STATUS"
fi
if [ "$STATUS" != "READY" ]; then
  log "ABORT: Worker Tab $WORKER_WT not READY after recovery (status: $STATUS)"
  notify "Nightly Forge ABORT: Worker Tab not READY ($STATUS)"
  exit 1
fi

# Read nightly-tasks.md
TASK_STATE=""
if [ -f "$NIGHTLY_TASK_FILE" ]; then
  TASK_STATE=$(cat "$NIGHTLY_TASK_FILE")
  backup_nightly_tasks
else
  log "ABORT: nightly-tasks.md not found"
  notify "Nightly Forge ABORT: nightly-tasks.md not found"
  exit 1
fi

ACTIVE_COUNT=$(echo "$TASK_STATE" | grep -c '^\- \[ \]' || true)
if [ "$ACTIVE_COUNT" -eq 0 ]; then
  log "No active tasks. Entering RESEARCH MODE."
  notify "Nightly Forge: RESEARCH MODE (no tasks)"

  RESEARCH_PROMPT_FILE="/tmp/nightly-forge-research-$$.txt"
RESEARCH_TOPICS_FILE="$HOME/claude-telegram-bot/autonomous/state/research-topics.md"
CROPPY_NOTES="$HOME/Machinelab Dropbox/Matsuoka Daijiro/JARVIS-Journal/croppy-notes.md"

  if [ ! -f "$RESEARCH_TOPICS_FILE" ]; then
    log "ABORT: research-topics.md not found"
    exit 0
  fi

  TOPICS=$(cat "$RESEARCH_TOPICS_FILE")
  DATE_DOW=$(date +%u)  # 1=Mon..7=Sun
  EXISTING_NOTES=$(tail -50 "$CROPPY_NOTES" 2>/dev/null || echo "")

  cat > "$RESEARCH_PROMPT_FILE" << RESEARCH_EOF
あなたはNightly Forge v2 リサーチモードとして動作中。
タスクがないため、DJ運用を改善するアイデアをWeb検索で収集する。

## リサーチトピック
$TOPICS

## 既存のcroppy-notes末尾（重複回避用）
$EXISTING_NOTES

## ルール
1. 固定テーマ3つ + 回転テーマ1つ(今日は曜日${DATE_DOW}番目)を検索
2. 各テーマ1-2回のWeb検索で効率よく情報収集
3. DJ運用(FA設計/JARVIS/Nightly Forge/Claude Code)に直接適用可能なものだけ抽出
4. 既にcroppy-notesにある内容は重複追記しない
5. 発見があったら以下の形式でexecブロック出力:

\`\`\`exec
cat >> "$CROPPY_NOTES" << 'APPEND'

## $(date +%Y-%m-%d) Nightly Research
- [発見タイトル]: 概要（URL）
APPEND
\`\`\`

6. 検索結果が既知の情報ばかりなら「NIGHTLY_DONE: 新規発見なし」と報告
7. 最大3テーマ検索したら NIGHTLY_DONE と出力
RESEARCH_EOF

  RESPONSE=$(inject_and_wait "$RESEARCH_PROMPT_FILE" "$WAIT_TIMEOUT")
  log "Research initial response: ${#RESPONSE} chars"

  obsidian_append "## Research Mode
$(date '+%H:%M:%S') - No active tasks, entering research mode
"

  # Research uses same main loop (exec block extraction + execution)
  # Fall through to main loop with STEP=0, but skip initial task prompt
  RESEARCH_ACTIVE=1
fi

log "=== Nightly Forge v2 Chrome START ==="
log "Worker: $WORKER_WT | Tasks: $ACTIVE_COUNT | Max: ${MAX_STEPS} steps / ${MAX_RUNTIME}s"
notify "Nightly Forge v2 START ($ACTIVE_COUNT tasks)"

# Init Obsidian log
obsidian_append "# Nightly Forge v2 (Chrome) - ${DATE}
Started: $(date '+%H:%M:%S')
Tasks: ${ACTIVE_COUNT}
Worker: ${WORKER_WT}
"

# --- G12: DESIGN-RULES embedded in initial prompt (no separate inject) ---
# 14KB separate inject caused CONV_LIMIT after 1-2 steps. Minimal rules now in prompt.
log "G12: DESIGN-RULES embedded in prompt (no separate inject)"

# --- Build initial prompt (skip if research mode already injected) ---
if [ "${RESEARCH_ACTIVE:-0}" = "1" ]; then
  log "Skipping initial prompt (research mode active)"
else
PROMPT_FILE="/tmp/nightly-forge-prompt-$$.txt"
cat > "$PROMPT_FILE" << 'NIGHTLY_PROMPT_EOF'
あなたはNightly Forge v2（Chrome自律夜間改善エージェント）として動作中。

## 設計ルール（DESIGN-RULES抜粋）
- コードを書く前に深く考える。急がない。冪等性チェック必須
- パッチはPythonスクリプト+文字列マッチ方式が安全（行ズレなし）
- bun test + bash -n 構文チェック必須。git push禁止
- 蓄積教訓: Bunのspawn timeoutはNode.jsと異なる。crontabはTCC権限でexec bridge不可→LaunchAgent
- Phase分割禁止。一気に実装+フォールバック設計。外部依存だけ後回し

## ルール
1. 以下のタスクリストから最優先の未完了タスク([ ])を1つ選んで作業
2. コマンドを実行したい場合は以下の形式で出力（1メッセージに複数ブロック可）:
```exec
コマンド内容
```
3. 実行結果は次のメッセージで返される
4. 1タスク完了したら nightly-tasks.md を更新するexecブロックを出力
5. テスト(bun test)をコード変更後に必ず実行
6. 禁止: git push / .env変更 / 本番プロセス再起動 / API key直接使用
7. 行き詰まったら「STUCK: 理由」と報告して次タスクへ
8. 全タスク完了 or 作業終了時は「NIGHTLY_DONE」と出力
9. 1回のメッセージでexecブロックは最大3個まで（結果を見てから次を判断）
10. レスポンスは簡潔に。分析・計画は短く、execブロック出力を優先

## 現在のタスク
NIGHTLY_PROMPT_EOF

echo "$TASK_STATE" >> "$PROMPT_FILE"
echo "" >> "$PROMPT_FILE"
echo "最優先タスクから作業開始。まず関連ファイルを読むexecブロックを出力してください。" >> "$PROMPT_FILE"

# --- Inject initial prompt ---
log "Injecting initial prompt..."
RESPONSE=$(inject_and_wait "$PROMPT_FILE" "$WAIT_TIMEOUT")
log "Initial response: ${#RESPONSE} chars"
fi  # end of non-research initial prompt

obsidian_append "## Initial Response
\`\`\`
$(echo "$RESPONSE" | head -80)
\`\`\`
"

# --- Main Loop ---
STEP=0
CURRENT_TASK="initializing"
COMPLETED_TASKS=0
CONSECUTIVE_EMPTY=0
CONV_LIMIT_RESTARTS=0
MAX_CONV_LIMIT_RESTARTS=2

while [ "$STEP" -lt "$MAX_STEPS" ]; do
  STEP=$((STEP + 1))

  # Stop flag check
  if [ -f "$STOP_FLAG" ]; then
    log "STOP FLAG at step $STEP"
    checkpoint "$STEP" "$CURRENT_TASK" "STOPPED" "Kill switch" "none"
    notify "Nightly Forge STOPPED at step $STEP"
    break
  fi

  # Runtime check
  ELAPSED=$(elapsed_seconds)
  if [ "$ELAPSED" -gt "$MAX_RUNTIME" ]; then
    log "MAX RUNTIME at step $STEP (${ELAPSED}s)"
    checkpoint "$STEP" "$CURRENT_TASK" "TIMEOUT" "Max runtime exceeded" "none"
    notify "Nightly Forge TIMEOUT at step $STEP"
    break
  fi

  # Check for DONE
  if echo "$RESPONSE" | grep -q "NIGHTLY_DONE"; then
    log "NIGHTLY_DONE at step $STEP"
    checkpoint "$STEP" "$CURRENT_TASK" "DONE" "All tasks completed ($COMPLETED_TASKS)" "none"
    break
  fi

  # Check for CONV_LIMIT in response (from inject_and_wait)
  if echo "$RESPONSE" | grep -qE "^ERROR:(CONV_LIMIT|RATE_LIMIT)$"; then
    CONV_LIMIT_RESTARTS=$((CONV_LIMIT_RESTARTS + 1))
    log "CONV_LIMIT in loop (restart $CONV_LIMIT_RESTARTS/$MAX_CONV_LIMIT_RESTARTS)"
    if [ "$CONV_LIMIT_RESTARTS" -gt "$MAX_CONV_LIMIT_RESTARTS" ]; then
      log "ABORT: Max CONV_LIMIT restarts exceeded"
      checkpoint "$STEP" "$CURRENT_TASK" "FAILED" "CONV_LIMIT x$CONV_LIMIT_RESTARTS" "none"
      notify "Nightly Forge ABORT: CONV_LIMIT x$CONV_LIMIT_RESTARTS"
      break
    fi
    # Recovery: navigate to fresh chat
    log "Recovering: opening fresh chat..."
    WIDX=$(echo "$WORKER_WT" | cut -d: -f1)
    TIDX=$(echo "$WORKER_WT" | cut -d: -f2)
    osascript -e "tell application \"Google Chrome\" to set URL of tab $TIDX of window $WIDX to \"$WORKER_PROJECT_URL\"" 2>/dev/null || true
    sleep 12
    STATUS=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
    if [ "$STATUS" != "READY" ]; then
      sleep 10
      STATUS=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
    fi
    if [ "$STATUS" != "READY" ]; then
      log "ABORT: Fresh chat not READY after CONV_LIMIT recovery ($STATUS)"
      notify "Nightly Forge ABORT: recovery failed ($STATUS)"
      break
    fi
    # Re-inject prompt (no DESIGN-RULES, just task list)
    RETRY_PROMPT="/tmp/nightly-forge-retry-$$.txt"
    cat > "$RETRY_PROMPT" << RETRY_EOF
[Nightly Forge再開 — 前のチャットがCONV_LIMITに到達]

前回の進捗: Step $STEP, $COMPLETED_TASKS tasks done, current: $CURRENT_TASK

## ルール
execブロックでコマンド出力。完了ならNIGHTLY_DONE。禁止: git push/.env変更/API key。

## 残タスク
$(cat "$NIGHTLY_TASK_FILE" 2>/dev/null)

続きから作業開始。
RETRY_EOF
    RESPONSE=$(inject_and_wait "$RETRY_PROMPT" "$WAIT_TIMEOUT")
    log "Recovery response: ${#RESPONSE} chars"
    continue
  fi

  # Check for STUCK
  if echo "$RESPONSE" | grep -q "STUCK:"; then
    STUCK_REASON=$(echo "$RESPONSE" | grep "STUCK:" | head -1 | cut -c1-120)
    log "STUCK: $STUCK_REASON"
    checkpoint "$STEP" "$CURRENT_TASK" "STUCK" "$STUCK_REASON" "next task"
    RESPONSE=$(inject_text "了解。次のタスクに移ってください。")
    continue
  fi

  # Extract ```exec blocks
  EXEC_CMDS=$(echo "$RESPONSE" | sed -n '/^```exec$/,/^```$/p' | sed '/^```/d' | sed '/^$/d')

  if [ -z "$EXEC_CMDS" ]; then
    CONSECUTIVE_EMPTY=$((CONSECUTIVE_EMPTY + 1))
    if [ "$CONSECUTIVE_EMPTY" -ge 3 ]; then
      log "3 consecutive empty exec blocks. Nudging."
      RESPONSE=$(inject_text "コマンド実行が必要なら \`\`\`exec ブロックで出力してください。完了なら NIGHTLY_DONE と出力。")
      CONSECUTIVE_EMPTY=0
      continue
    fi
    # Might be analysis - extract task name
    CURRENT_TASK=$(echo "$RESPONSE" | grep -oE 'M[0-9]{4}' | head -1)
    [ -z "$CURRENT_TASK" ] && CURRENT_TASK="analysis"
    checkpoint "$STEP" "$CURRENT_TASK" "OK" "Planning/analysis" "exec expected next"
    # Send continuation prompt
    RESPONSE=$(inject_text "続けてください。実行するコマンドがあれば \`\`\`exec ブロックで出力。")
    continue
  fi

  CONSECUTIVE_EMPTY=0

  # Execute each command
  RESULT_PARTS=""
  CMD_COUNT=0
  while IFS= read -r CMD; do
    [ -z "$CMD" ] && continue
    CMD_COUNT=$((CMD_COUNT + 1))

    log "Exec [$CMD_COUNT]: ${CMD:0:100}"

    if is_blocked "$CMD"; then
      log "BLOCKED: $CMD"
      RESULT_PARTS="${RESULT_PARTS}
[BLOCKED] ${CMD:0:80}: Security policy violation
---"
      continue
    fi

    # Execute locally on M1
    CMD_OUTPUT=$(cd "$PROJECT_DIR" && timeout 120 bash -c "$CMD" 2>&1) || true
    CMD_EXIT=$?
    CMD_OUTPUT_TRUNC="${CMD_OUTPUT:0:3000}"

    RESULT_PARTS="${RESULT_PARTS}
\$ ${CMD:0:200}
Exit: ${CMD_EXIT}
${CMD_OUTPUT_TRUNC}
---"

    log "  -> exit=$CMD_EXIT, ${#CMD_OUTPUT} chars"

    # Obsidian detail
    obsidian_append "### Step ${STEP} Exec: \`${CMD:0:80}\`
Exit: ${CMD_EXIT}
\`\`\`
${CMD_OUTPUT:0:2000}
\`\`\`
"

    # Check if nightly-tasks was updated (task completion signal)
    if echo "$CMD" | grep -q "nightly-tasks"; then
      COMPLETED_TASKS=$((COMPLETED_TASKS + 1))
    fi
  done <<< "$EXEC_CMDS"

  # Validate nightly-tasks.md structure after exec blocks
  if ! validate_nightly_tasks; then
    log "ERROR: nightly-tasks.md validation failed and restore unavailable"
    checkpoint "$STEP" "$CURRENT_TASK" "ERROR" "nightly-tasks.md corrupted" "abort"
    break
  fi

  # Detect current task from commands
  TASK_FROM_CMD=$(echo "$EXEC_CMDS" | grep -oE 'M[0-9]{4}' | head -1)
  [ -n "$TASK_FROM_CMD" ] && CURRENT_TASK="$TASK_FROM_CMD"

  checkpoint "$STEP" "$CURRENT_TASK" "OK" "${CMD_COUNT} commands executed" "AI decides next"

  # Inject results back
  RESULT_FILE="/tmp/nightly-forge-result-$$.txt"
  cat > "$RESULT_FILE" << RESULT_EOF
[実行結果]
${RESULT_PARTS}

次のアクションを決定してください。完了なら NIGHTLY_DONE。
RESULT_EOF

  RESPONSE=$(inject_and_wait "$RESULT_FILE" "$WAIT_TIMEOUT")

  if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "TIMEOUT" ] || [ "$RESPONSE" = "NO_RESPONSE" ]; then
    log "Step $STEP: no response after exec results"
    checkpoint "$STEP" "$CURRENT_TASK" "WARN" "No AI response" "retry"
    RESPONSE=$(inject_text "応答がタイムアウトしました。現在の状況を報告してください。")
  fi

  log "Step $STEP response: ${#RESPONSE} chars"
  obsidian_append "## Step ${STEP} AI Response
\`\`\`
$(echo "$RESPONSE" | head -80)
\`\`\`
"
done

# --- Finalize ---
TOTAL_ELAPSED=$(elapsed_seconds)
log "=== Nightly Forge v2 Chrome END (${TOTAL_ELAPSED}s, ${STEP} steps, ${COMPLETED_TASKS} completed) ==="

cd "$PROJECT_DIR"
CHANGES=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
GIT_DIFF_STAT=$(git diff --stat 2>/dev/null || echo "no changes")

# Parse final task state for completed/uncompleted summary
TASKS_COMPLETED_LIST=""
TASKS_UNCOMPLETED_LIST=""
if [ -f "$NIGHTLY_TASK_FILE" ]; then
  TASKS_COMPLETED_LIST=$(grep '^\- \[x\]' "$NIGHTLY_TASK_FILE" 2>/dev/null | sed 's/^- \[x\] /  - /' || echo "  (none)")
  TASKS_UNCOMPLETED_LIST=$(grep '^\- \[ \]' "$NIGHTLY_TASK_FILE" 2>/dev/null | sed 's/^- \[ \] /  - /' || echo "  (none)")
fi
[ -z "$TASKS_COMPLETED_LIST" ] && TASKS_COMPLETED_LIST="  (none)"
[ -z "$TASKS_UNCOMPLETED_LIST" ] && TASKS_UNCOMPLETED_LIST="  (none)"

# Final checkpoint
checkpoint "$STEP" "finalize" "END" "${COMPLETED_TASKS} tasks done, ${TOTAL_ELAPSED}s" "session complete"

obsidian_append "
---
## Summary
- Steps: ${STEP}/${MAX_STEPS}
- Completed tasks: ${COMPLETED_TASKS}
- Duration: ${TOTAL_ELAPSED}s
- Changed files: ${CHANGES}
- Ended: $(date '+%H:%M:%S')

## Handoff
### Completed Tasks
${TASKS_COMPLETED_LIST}

### Remaining Tasks
${TASKS_UNCOMPLETED_LIST}

### Git Diff Stat
\`\`\`
${GIT_DIFF_STAT}
\`\`\`
"

notify "Nightly Forge v2 END: ${STEP} steps, ${COMPLETED_TASKS} done, ${CHANGES} changed, ${TOTAL_ELAPSED}s"
