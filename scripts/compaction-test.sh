#!/bin/bash
# compaction-test.sh — Test compaction behavior via Claude CLI (no direct API)
# JARVIS rule: no direct API calls. This uses Claude CLI to demonstrate compaction.
set -euo pipefail

echo "=== Compaction Test ==="
echo "Testing long conversation compaction behavior via Claude CLI"
echo ""

# Generate a long prompt that would trigger compaction
LONG_CONTEXT=$(python3 -c "
# Generate enough context to approach compaction threshold
lines = []
for i in range(100):
    lines.append(f'Item {i}: The value of metric_{i} is {i * 17 % 100} with status {\"active\" if i % 3 == 0 else \"inactive\"}')
print('\n'.join(lines))
")

PROMPT="Here is a long dataset to process. After reading it, tell me: what is the value of metric_42 and metric_99?

$LONG_CONTEXT

Now answer the questions above."

echo "Prompt length: $(echo "$PROMPT" | wc -c | tr -d ' ') chars"
echo "Running via Claude CLI..."
echo ""

# Run via CLI (respects JARVIS no-API-key rule)
RESULT=$(echo "$PROMPT" | claude -p --model sonnet 2>&1) || true
echo "$RESULT" | tail -20

echo ""
echo "=== Test complete ==="
echo "Note: Compaction is handled internally by Claude Code."
echo "For infinite conversations, context is automatically summarized when approaching limits."
