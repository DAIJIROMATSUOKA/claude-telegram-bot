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
MEMORY_DIR="$HOME/.claude/projects/-Users-daijiromatsuokam1-claude-telegram-bot/memory"
STOP_FLAG="/tmp/jarvis-nightly-stop"
NIGHTLY_MODE="/tmp/nightly-mode"
LOCK_FILE="/tmp/nightly-forge-chrome.lock"
MAX_STEPS=10
MAX_RUNTIME=14400  # 4 hours
WAIT_TIMEOUT=300   # 5 min per AI response
DATE=$(date +%Y-%m-%d)
TIME_START=$(date +%s)

mkdir -p "$LOG_DIR"
mkdir -p "$OBSIDIAN_BASE"

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

# G13: 5-line checkpoint
checkpoint() {
  local step="$1" task="$2" status="$3" result="$4" next="$5"
  local cp="STEP: ${step}/${MAX_STEPS}
TASK: ${task}
STATUS: ${status}
RESULT: ${result}
NEXT: ${next}"
  log "--- CHECKPOINT ---"
  log "$cp"
  obsidian_append "### Checkpoint ${step}
\`\`\`
${cp}
\`\`\`
"
}

# inject-file + 5s fixed wait + wait-response (double-READY mitigation)
inject_and_wait() {
  local text_file="$1"
  local timeout="${2:-$WAIT_TIMEOUT}"

  bash "$TAB_MANAGER" inject-file "$WORKER_WT" "$text_file" 2>/dev/null
  rm -f "$text_file"

  # 5-second fixed wait: Claude takes 3-5s to start processing (DESIGN-RULES lesson)
  sleep 5

  # Double READY check
  local s1 s2
  s1=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
  if [ "$s1" = "READY" ]; then
    sleep 1
    s2=$(bash "$TAB_MANAGER" check-status "$WORKER_WT" 2>/dev/null)
    if [ "$s2" = "READY" ]; then
      # Double READY = response already complete (fast) or stale
      # Read and check length to distinguish
      local resp
      resp=$(bash "$TAB_MANAGER" read-response "$WORKER_WT" 2>/dev/null)
      echo "$resp"
      return 0
    fi
  fi

  # Normal poll: BUSY -> READY
  bash "$TAB_MANAGER" wait-response "$WORKER_WT" "$timeout" 2>/dev/null
}

inject_text() {
  local tmp="/tmp/nightly-forge-msg-$$.txt"
  echo "$1" > "$tmp"
  inject_and_wait "$tmp" "${2:-$WAIT_TIMEOUT}"
}

# Safety check for commands
is_blocked() {
  local cmd="$1"
  echo "$cmd" | grep -qiE 'git push|git reset --hard|rm -rf /|rm -rf ~|\.env|API_KEY|TELEGRAM_BOT_TOKEN|sudo |launchctl|pkill|kill -9|npm publish|chmod 777|crontab' && return 0
  return 1
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
if [ "$STATUS" != "READY" ]; then
  log "ABORT: Worker Tab $WORKER_WT not READY after recovery (status: $STATUS)"
  notify "Nightly Forge ABORT: Worker Tab not READY ($STATUS)"
  exit 1
fi

# Read task-state.md
TASK_STATE=""
if [ -f "$MEMORY_DIR/task-state.md" ]; then
  TASK_STATE=$(cat "$MEMORY_DIR/task-state.md")
else
  log "ABORT: task-state.md not found"
  notify "Nightly Forge ABORT: task-state.md not found"
  exit 1
fi

ACTIVE_COUNT=$(echo "$TASK_STATE" | grep -c '^\- \[ \]' || true)
if [ "$ACTIVE_COUNT" -eq 0 ]; then
  log "No active tasks. Exiting."
  notify "Nightly Forge: no active tasks"
  exit 0
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

# --- G12: Inject DESIGN-RULES.md ---
log "G12: Injecting DESIGN-RULES.md..."
DESIGN_RULES="$PROJECT_DIR/docs/DESIGN-RULES.md"
if [ -f "$DESIGN_RULES" ]; then
  bash "$TAB_MANAGER" inject-file "$WORKER_WT" "$DESIGN_RULES" 2>/dev/null
  sleep 5
  # Drain the response (we don't need it)
  bash "$TAB_MANAGER" wait-response "$WORKER_WT" 120 >/dev/null 2>&1 || true
  log "DESIGN-RULES.md injected and drained"
else
  log "WARNING: DESIGN-RULES.md not found"
fi

# --- Build initial prompt ---
PROMPT_FILE="/tmp/nightly-forge-prompt-$$.txt"
cat > "$PROMPT_FILE" << 'NIGHTLY_PROMPT_EOF'
あなたはNightly Forge v2（Chrome自律夜間改善エージェント）として動作中。

## ルール
1. 以下のタスクリストから最優先の未完了タスク([ ])を1つ選んで作業
2. コマンドを実行したい場合は以下の形式で出力（1メッセージに複数ブロック可）:
```exec
コマンド内容
```
3. 実行結果は次のメッセージで返される
4. 1タスク完了したら task-state.md を更新するexecブロックを出力
5. テスト(bun test)をコード変更後に必ず実行
6. 禁止: git push / .env変更 / 本番プロセス再起動 / API key直接使用
7. 行き詰まったら「STUCK: 理由」と報告して次タスクへ
8. 全タスク完了 or 作業終了時は「NIGHTLY_DONE」と出力
9. 1回のメッセージでexecブロックは最大3個まで（結果を見てから次を判断）

## 現在のタスク
NIGHTLY_PROMPT_EOF

echo "$TASK_STATE" >> "$PROMPT_FILE"
echo "" >> "$PROMPT_FILE"
echo "最優先タスクから作業開始。まず関連ファイルを読むexecブロックを出力してください。" >> "$PROMPT_FILE"

# --- Inject initial prompt ---
log "Injecting initial prompt..."
RESPONSE=$(inject_and_wait "$PROMPT_FILE" "$WAIT_TIMEOUT")
log "Initial response: ${#RESPONSE} chars"

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

    # Check if task-state was updated (task completion signal)
    if echo "$CMD" | grep -q "task-state"; then
      COMPLETED_TASKS=$((COMPLETED_TASKS + 1))
    fi
  done <<< "$EXEC_CMDS"

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

obsidian_append "
---
## Summary
- Steps: ${STEP}/${MAX_STEPS}
- Completed tasks: ${COMPLETED_TASKS}
- Duration: ${TOTAL_ELAPSED}s
- Ended: $(date '+%H:%M:%S')
"

cd "$PROJECT_DIR"
CHANGES=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
notify "Nightly Forge v2 END: ${STEP} steps, ${COMPLETED_TASKS} done, ${CHANGES} changed, ${TOTAL_ELAPSED}s"
