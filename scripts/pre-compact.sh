#!/bin/bash
INPUT=$(cat)
TP=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get(chr(116)+chr(114)+chr(97)+chr(110)+chr(115)+chr(99)+chr(114)+chr(105)+chr(112)+chr(116)+chr(95)+chr(112)+chr(97)+chr(116)+chr(104),chr(0)))" 2>/dev/null)
if [ -n "$TP" ] && [ -f "$TP" ]; then
  cp "$TP" "$HOME/.claude/last-compaction-backup.jsonl"
fi
