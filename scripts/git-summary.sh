#!/bin/bash
# git-summary.sh — Human-readable summary of commits since last push
# Usage: git-summary.sh [remote/branch]
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

REF="${1:-@{push}}"

# Fallback to origin/main if @{push} is not set
RANGE="$REF..HEAD"
COMMIT_COUNT=$(git log "$RANGE" --oneline 2>/dev/null | wc -l | tr -d ' ')

if [ "$COMMIT_COUNT" -eq 0 ]; then
  # Try origin/main as fallback
  REF="origin/main"
  RANGE="$REF..HEAD"
  COMMIT_COUNT=$(git log "$RANGE" --oneline 2>/dev/null | wc -l | tr -d ' ')
fi

if [ "$COMMIT_COUNT" -eq 0 ]; then
  echo "No unpushed commits."
  exit 0
fi

echo "=== Git Summary: $COMMIT_COUNT commits since last push ==="
echo ""

# Authors
echo "Authors:"
git log "$RANGE" --format='  %an' | sort | uniq -c | sort -rn
echo ""

# Commit list
echo "Commits:"
git log "$RANGE" --oneline --no-decorate
echo ""

# File changes summary
echo "File Changes:"
git diff --stat "$REF" HEAD 2>/dev/null
echo ""

# Shortstat
git diff --shortstat "$REF" HEAD 2>/dev/null
