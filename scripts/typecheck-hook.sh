#!/bin/bash
# PostToolUse hook: type check .ts files after Edit/Write
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)

# Only check .ts files
case "$FILE_PATH" in
  *.ts) ;;
  *) exit 0 ;;
esac

cd /Users/daijiromatsuokam1/claude-telegram-bot
RESULT=$(bunx tsc --noEmit --pretty 2>&1)
EXIT_CODE=$(($?))

if [ $EXIT_CODE -ne 0 ]; then
  TRUNCATED=$(echo "$RESULT" | head -30)
  python3 -c "
import json,sys
msg=sys.stdin.read()
print(json.dumps({'decision':'block','reason':'Type errors:\n'+msg}))
" <<< "$TRUNCATED"
fi
exit 0
