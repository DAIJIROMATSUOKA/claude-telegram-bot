#!/bin/bash

# Darwin Engine v1.3 - Self-Learning Workflow Optimizer テストスクリプト

echo "🧪 Darwin Engine v1.3 - 全5機能テスト開始"
echo "======================================"

DB_PATH="/Users/daijiromatsuokam1/claude-telegram-bot/jarvis.db"

# テスト用のSQLクエリを実行する関数
test_db() {
  sqlite3 "$DB_PATH" "$1"
}

echo ""
echo "1️⃣  Pattern Mining テスト"
echo "------------------------------------"
test_db "SELECT COUNT(*) as table_exists FROM sqlite_master WHERE type='table' AND name='workflow_patterns';"
test_db "SELECT pattern_key, frequency FROM workflow_patterns LIMIT 3;"

echo ""
echo "2️⃣  Context Cache テスト"
echo "------------------------------------"
test_db "SELECT COUNT(*) as table_exists FROM sqlite_master WHERE type='table' AND name='context_cache';"
test_db "SELECT cache_key, LENGTH(cache_data) as data_size FROM context_cache LIMIT 3;"

echo ""
echo "3️⃣  Time Block テスト"
echo "------------------------------------"
test_db "SELECT COUNT(*) as table_exists FROM sqlite_master WHERE type='table' AND name='time_blocks';"
test_db "SELECT task_name, status, duration_seconds FROM time_blocks ORDER BY started_at DESC LIMIT 3;"

echo ""
echo "4️⃣  Focus Session テスト"
echo "------------------------------------"
test_db "SELECT COUNT(*) as table_exists FROM sqlite_master WHERE type='table' AND name='focus_sessions';"
test_db "SELECT session_name, interruptions, quality_score FROM focus_sessions ORDER BY started_at DESC LIMIT 3;"

echo ""
echo "5️⃣  Performance Metrics テスト"
echo "------------------------------------"
test_db "SELECT COUNT(*) as table_exists FROM sqlite_master WHERE type='table' AND name='performance_metrics';"
test_db "SELECT metric_type, AVG(metric_value) as avg_value FROM performance_metrics GROUP BY metric_type LIMIT 5;"

echo ""
echo "======================================"
echo "✅ 全5機能のテーブル構造確認完了"
echo ""
echo "📊 統計情報:"
echo "------------------------------------"
test_db "SELECT
  (SELECT COUNT(*) FROM workflow_patterns) as patterns,
  (SELECT COUNT(*) FROM context_cache) as caches,
  (SELECT COUNT(*) FROM time_blocks) as blocks,
  (SELECT COUNT(*) FROM focus_sessions) as sessions,
  (SELECT COUNT(*) FROM performance_metrics) as metrics;"
