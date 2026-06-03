#!/bin/bash
# Backward-compatible wrapper. KEYENCE manual sync is now handled by the generic
# sync-manuals.sh (maker-aware). This forwards all args to `sync-manuals.sh keyence`.
#   sync-keyence-manuals.sh [--status] [folder]
exec "$(dirname "$0")/sync-manuals.sh" keyence "$@"
