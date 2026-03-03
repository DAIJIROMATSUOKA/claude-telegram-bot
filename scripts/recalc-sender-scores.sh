#!/bin/bash
# Recalculate sender_scores from inbox_actions (run nightly)
# Usage: bash recalc-sender-scores.sh

GATEWAY="https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev"
source ~/.jarvis-line-env 2>/dev/null || source ~/claude-telegram-bot/.env 2>/dev/null
API_KEY="${GATEWAY_API_KEY:-}"

query() {
  curl -s -X POST "$GATEWAY/v1/db/query" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "{\"sql\": \"$1\", \"params\": []}"
}

echo "[InboxLearning] Recalculating sender scores..."

# Clear and recalculate from scratch (simpler than UPSERT)
query "DELETE FROM sender_scores WHERE 1=1"

# Aggregate and insert
query "INSERT INTO sender_scores (domain, total_count, delete_count, archive_count, reply_count, read_count, snooze_count, avg_response_sec, priority, updated_at) SELECT sender_domain, COUNT(*) as total, SUM(CASE WHEN action='trash' THEN 1 ELSE 0 END), SUM(CASE WHEN action='archive' THEN 1 ELSE 0 END), SUM(CASE WHEN action='reply' THEN 1 ELSE 0 END), SUM(CASE WHEN action='read' THEN 1 ELSE 0 END), SUM(CASE WHEN action='snooze' THEN 1 ELSE 0 END), AVG(CASE WHEN response_seconds IS NOT NULL THEN response_seconds ELSE NULL END), CASE WHEN COUNT(*)>=3 AND (1.0*SUM(CASE WHEN action='reply' THEN 1 ELSE 0 END)/COUNT(*)>0.2 OR (COUNT(*)>=3 AND AVG(CASE WHEN response_seconds IS NOT NULL THEN response_seconds END)<300)) THEN 'vip' WHEN COUNT(*)>=5 AND 1.0*SUM(CASE WHEN action='trash' THEN 1 ELSE 0 END)/COUNT(*)>0.6 THEN 'auto_archive' WHEN COUNT(*)>=5 AND 1.0*SUM(CASE WHEN action='archive' THEN 1 ELSE 0 END)/COUNT(*)>0.7 AND AVG(CASE WHEN response_seconds IS NOT NULL THEN response_seconds END)>3600 THEN 'low' ELSE 'normal' END, datetime('now') FROM inbox_actions WHERE sender_domain IS NOT NULL AND sender_domain != '' GROUP BY sender_domain"

echo "[InboxLearning] Done. Checking results..."
query "SELECT domain, total_count, priority FROM sender_scores ORDER BY total_count DESC LIMIT 20"
