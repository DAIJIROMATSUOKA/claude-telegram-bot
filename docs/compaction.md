# Compaction API

## What It Is

The Compaction API (Opus 4.6 beta) enables server-side context summarization for infinite conversations. When context approaches the limit, Claude automatically compacts prior messages into a dense summary, allowing conversations to continue indefinitely without losing essential context.

## How It Works

1. Conversation proceeds normally
2. When context window approaches capacity, compaction triggers
3. Server-side: older messages are summarized into a compact representation
4. New messages are appended after the compacted summary
5. Conversation continues seamlessly

## Relevance to JARVIS

### Replaces Manual Handoff?
Currently JARVIS uses a multi-layer handoff system:
- Auto-handoff on session end (`scripts/auto-handoff.py`)
- Token estimation + early handoff trigger
- `ai-context.md` as backup context preservation

Compaction could simplify this by handling context overflow automatically. However:
- **Keep handoff for session boundaries** — compaction handles within-session overflow, handoff handles between-session context transfer
- **Keep ai-context.md** — external backup independent of any API feature
- **Potential removal**: Token estimation + early handoff trigger could be replaced

### For Claude Code Sessions
Claude Code already handles compaction internally. The `--dangerously-skip-permissions` headless sessions benefit most since they can run longer.

## Testing

```bash
# Test script available at:
bash scripts/compaction-test.sh
```

Note: The test script demonstrates the concept but JARVIS uses CLI-only (no direct API calls per project rules).

## Limitations
- Beta feature — behavior may change
- Compacted summaries lose fine-grained detail
- No control over what gets compacted
- Not a replacement for persistent memory (Memory Gateway)
