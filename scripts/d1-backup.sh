#!/bin/bash
# d1-backup.sh — Backup all D1 tables to iCloud/Obsidian
# Usage: bash scripts/d1-backup.sh
set -uo pipefail

GATEWAY="https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev"
DATE=$(date '+%Y-%m-%d')
BACKUP_DIR="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian/90_System/D1Backup/$DATE"
mkdir -p "$BACKUP_DIR"

TABLES=(
  message_mappings
  telegram_archive
  snooze_queue
  tasks
  triage_corrections
  jarvis_chat_history
  jarvis_ai_memory
  line_scheduled
)

REPORT=""
TOTAL=0
FAILED=0

for table in "${TABLES[@]}"; do
  RESPONSE=$(curl -s -X POST "$GATEWAY/v1/db/query" \
    -H "Content-Type: application/json" \
    -d "{\"sql\": \"SELECT * FROM $table\"}" 2>&1)

  # Check if curl succeeded and response is valid JSON
  if echo "$RESPONSE" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
    echo "$RESPONSE" > "$BACKUP_DIR/${table}.json"
    ROW_COUNT=$(echo "$RESPONSE" | python3 -c "
import json,sys
d = json.load(sys.stdin)
results = d.get('results', d.get('result', []))
if isinstance(results, list):
    print(len(results))
else:
    print(0)
" 2>/dev/null || echo "?")
    REPORT="${REPORT}✅ ${table}: ${ROW_COUNT} rows\n"
    TOTAL=$((TOTAL + 1))
  else
    REPORT="${REPORT}❌ ${table}: FAILED\n"
    FAILED=$((FAILED + 1))
  fi
done

echo -e "📦 D1 Backup ($DATE)\n$REPORT\n📊 $TOTAL/$((TOTAL+FAILED)) tables backed up to $BACKUP_DIR"
