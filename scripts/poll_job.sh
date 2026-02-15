#!/bin/bash
# poll_job.sh - Self-continuing job poller (v3.2 spec)
# Usage: ./poll_job.sh <task_id> [poll_interval] [max_seconds]

TASK_ID="$1"
POLL_INTERVAL="${2:-15}"
MAX_SECONDS="${3:-210}"

if [ -z "$TASK_ID" ]; then
  echo "EXIT:99"
  echo "STATUS:ERROR"
  echo "NEXT:NONE"
  echo "SUM:No task_id provided"
  exit 0
fi

START=$(date +%s)

while true; do
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -ge "$MAX_SECONDS" ]; then
    echo "EXIT:2"
    echo "STATUS:RUNNING"
    echo "NEXT:ACTION ./poll_job.sh $TASK_ID"
    echo "SUM:Still running (${ELAPSED}s elapsed)"
    exit 0
  fi

  RESULT=$(bash ~/exec.sh --check "$TASK_ID" 2>/dev/null)

  if echo "$RESULT" | grep -q "^EXIT:"; then
    # Job done (success or failure)
    EXIT_CODE=$(echo "$RESULT" | grep "^EXIT:" | head -1 | sed 's/EXIT: *//')
    STDOUT=$(echo "$RESULT" | sed -n '/^STDOUT:/,/^STDERR:/{ /^STDOUT:/d; /^STDERR:/d; p; }')
    STDERR=$(echo "$RESULT" | sed -n '/^STDERR:/{ s/^STDERR: *//; p; }')

    if [ "$EXIT_CODE" = "0" ]; then
      SUM=$(echo "$STDOUT" | tail -1 | head -c 200)
      echo "EXIT:0"
      echo "STATUS:DONE"
      echo "NEXT:NONE"
      echo "SUM:${SUM:-completed}"
    else
      LAST5=$(echo "$STDERR" | tail -5)
      [ -z "$LAST5" ] && LAST5=$(echo "$STDOUT" | tail -5)
      echo "EXIT:1"
      echo "STATUS:FAIL"
      echo "NEXT:PATCH"
      echo "SUM:Failed (exit=$EXIT_CODE)"
      echo "LAST5:"
      echo "$LAST5"
    fi
    exit 0
  fi

  if echo "$RESULT" | grep -q "STATUS: still running"; then
    sleep "$POLL_INTERVAL"
    continue
  fi

  if echo "$RESULT" | grep -q "STATUS: waiting"; then
    sleep "$POLL_INTERVAL"
    continue
  fi

  if echo "$RESULT" | grep -q "ERROR"; then
    echo "EXIT:99"
    echo "STATUS:NOT_FOUND"
    echo "NEXT:NONE"
    echo "SUM:$(echo "$RESULT" | head -1)"
    exit 0
  fi

  sleep "$POLL_INTERVAL"
done
