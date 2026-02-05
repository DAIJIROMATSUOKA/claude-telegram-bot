#!/bin/bash
# Apply Meta-Agent Migration 0010

set -e

DB_PATH="./jarvis.db"

echo "==================================="
echo "  Meta-Agent Migration - 0010"
echo "==================================="

if [[ ! -f "$DB_PATH" ]]; then
  echo "❌ Error: Database not found at $DB_PATH"
  exit 1
fi

echo "📦 Applying migration: 0010_meta_agent.sql"
sqlite3 "$DB_PATH" < migrations/0010_meta_agent.sql

echo ""
echo "✅ Migration applied successfully!"
echo ""
echo "📊 Verifying tables..."
sqlite3 "$DB_PATH" <<'EOF'
SELECT name FROM sqlite_master WHERE type='table' AND (
  name = 'self_audit_results' OR
  name = 'code_review_suggestions' OR
  name = 'refactor_proposals' OR
  name = 'capability_gaps' OR
  name = 'meta_agent_log' OR
  name = 'meta_agent_state'
);
EOF

echo ""
echo "✅ Meta-Agent tables created:"
echo "   - self_audit_results"
echo "   - code_review_suggestions"
echo "   - refactor_proposals"
echo "   - capability_gaps"
echo "   - meta_agent_log"
echo "   - meta_agent_state"
echo ""
echo "🚀 Meta-Agent ready to self-improve!"
