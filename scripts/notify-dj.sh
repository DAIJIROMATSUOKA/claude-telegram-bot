#!/bin/bash
# notify-dj.sh — backward-compat shim → 統一通知transport (scripts/notify.sh)。
# 後方互換: 🗑削除ボタン + 任意parse_mode を維持。獲得: 配信ログ + 失敗時リトライキュー + transport差替可。
# ※新規/無ボタンで良い通知は notify.sh を直接使う(H1: ghost button削減)。
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
args=("${1:-🦞 作業完了}" --button --tag notify-dj)
[ -n "${2:-}" ] && args+=(--parse "$2")
exec "$DIR/notify.sh" "${args[@]}"
