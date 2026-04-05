#!/bin/bash
# Run each test file in its own bun process to prevent mock.module() leaks.
# Bun's mock.module() is process-global — sharing a process causes cross-file contamination.

set -euo pipefail

PASS=0
FAIL=0
FAILED_FILES=()

# Find all test files (src/ and tests/)
FILES=$(find src tests -name '*.test.ts' 2>/dev/null | sort)

for f in $FILES; do
  if output=$(bun test "$f" 2>&1); then
    # Extract pass count
    count=$(echo "$output" | strings | grep -oE '[0-9]+ pass' | head -1 | grep -oE '[0-9]+' || echo 0)
    PASS=$((PASS + count))
  else
    count_pass=$(echo "$output" | strings | grep -oE '[0-9]+ pass' | head -1 | grep -oE '[0-9]+' || echo 0)
    count_fail=$(echo "$output" | strings | grep -oE '[0-9]+ fail' | head -1 | grep -oE '[0-9]+' || echo 0)
    PASS=$((PASS + count_pass))
    FAIL=$((FAIL + count_fail))
    FAILED_FILES+=("$f ($count_fail)")
  fi
done

echo ""
echo "=== Test Results ==="
echo "$PASS pass, $FAIL fail across $(echo "$FILES" | wc -l | tr -d ' ') files"

if [ ${#FAILED_FILES[@]} -gt 0 ]; then
  echo ""
  echo "Failed files:"
  for f in "${FAILED_FILES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

echo "All tests passed!"
exit 0
