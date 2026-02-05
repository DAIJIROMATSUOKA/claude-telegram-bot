#!/bin/bash
# Meta-Agent Runner Script
# Runs self-audit, code review, refactor proposals, and capability gap analysis

set -e

PROJECT_DIR="/Users/daijiromatsuokam1/claude-telegram-bot"
cd "$PROJECT_DIR"

ACTION="${1:-all}"  # all, self-audit, code-review, refactor, gap-analysis

echo "====================================="
echo "  Meta-Agent Self-Improvement Engine"
echo "====================================="
echo "Action: $ACTION"
echo "Time: $(date)"
echo ""

# Load environment
if [[ -f .env ]]; then
  export $(grep -v '^#' .env | xargs)
fi

# Check if meta-agent is enabled
ENABLED=$(sqlite3 jarvis.db "SELECT enabled FROM meta_agent_state WHERE id = 1;" 2>/dev/null || echo "1")

if [[ "$ENABLED" == "0" ]]; then
  echo "🛑 Meta-Agent is disabled (Kill Switch active)"
  exit 0
fi

# Run meta-agent using Bun
case "$ACTION" in
  all)
    echo "🤖 Running full Meta-Agent cycle..."
    bun run scripts/run-meta-agent.ts --all
    ;;
  self-audit)
    echo "📊 Running Self-Audit..."
    bun run scripts/run-meta-agent.ts --self-audit
    ;;
  code-review)
    echo "🔍 Running Code Review..."
    bun run scripts/run-meta-agent.ts --code-review
    ;;
  refactor)
    echo "🔨 Generating Refactor Proposals..."
    bun run scripts/run-meta-agent.ts --refactor
    ;;
  gap-analysis)
    echo "🔍 Running Capability Gap Analysis..."
    bun run scripts/run-meta-agent.ts --gap-analysis
    ;;
  dashboard)
    echo "📊 Meta-Agent Dashboard..."
    bun run scripts/run-meta-agent.ts --dashboard
    ;;
  *)
    echo "❌ Unknown action: $ACTION"
    echo "Usage: $0 [all|self-audit|code-review|refactor|gap-analysis|dashboard]"
    exit 1
    ;;
esac

echo ""
echo "✅ Meta-Agent complete!"
echo "====================================="
