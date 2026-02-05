# Phase 2 Part 1 — source_agent Field Integration

**Date:** 2026-02-03 18:30 JST  
**Task:** Add source_agent field for 4-AI shared memory system  
**Status:** ✅ COMPLETED

---

## Summary

Successfully integrated `source_agent` field across Memory Gateway and bot codebase to support the 4-AI shared memory system (Jarvis, GPT, Claude, Gemini, OpenClaw).

---

## Changes Made

### 1. D1 Schema Migration

**File:** `~/memory-gateway/migrations/0002_add_source_agent.sql`

```sql
ALTER TABLE memory_events
ADD COLUMN source_agent TEXT DEFAULT 'jarvis'
  CHECK(source_agent IN ('jarvis', 'gpt', 'claude', 'gemini', 'openclaw'));

CREATE INDEX IF NOT EXISTS idx_memory_source_agent
  ON memory_events(source_agent, updated_at DESC)
  WHERE status = 'active';
```

- Default: `'jarvis'` (backward compatibility)
- CHECK constraint: validates agent names
- Index: optimizes source_agent queries

---

### 2. Memory Gateway API Updates

**File:** `~/memory-gateway/src/memory-handlers.ts`

✅ Updated interfaces:
- `MemoryEvent` interface - added `source_agent?: string`
- `AppendRequest` interface - added `source_agent?: 'jarvis' | 'gpt' | 'claude' | 'gemini' | 'openclaw'`

✅ Updated validation:
- Added source_agent validation in `handleMemoryAppend()`
- Valid agents: `['jarvis', 'gpt', 'claude', 'gemini', 'openclaw']`
- Default: `'jarvis'` if not provided

✅ Updated SQL queries:
- `handleMemoryQuery()` - SELECT includes source_agent
- `handleMemorySnapshot()` - SELECT includes source_agent
- `handleMemoryAppend()` - INSERT includes source_agent

---

### 3. Bot Integration Updates

**Files Updated:**

1. **`~/claude-telegram-bot/src/autopilot/types.ts`**
   - Added `source_agent` to `MemoryAppendRequest` interface

2. **`~/claude-telegram-bot/src/utils/action-ledger.ts`**
   - Action Ledger persistence now includes `source_agent: 'jarvis'`

3. **`~/claude-telegram-bot/src/autopilot/engine.ts`** (2 locations)
   - Permanent failure logs: added `source_agent: 'jarvis'`
   - Execution logs: added `source_agent: 'jarvis'`

4. **`~/claude-telegram-bot/src/autopilot/plugins/stalled-task-recomposer.ts`**
   - Task recomposition logs: added `source_agent: 'jarvis'`

5. **`~/claude-telegram-bot/src/autopilot/plugins/reverse-scheduler.ts`**
   - Reverse schedule logs: added `source_agent: 'jarvis'`

---

## Testing Checklist

Before deploying, run these tests:

### D1 Migration
```bash
cd ~/memory-gateway
wrangler d1 migrations apply DB --local   # Test migration
wrangler d1 execute DB --local --command "SELECT source_agent FROM memory_events LIMIT 1"
```

### API Testing
```bash
# Test append with source_agent
curl -X POST https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev/v1/memory/append \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "test/source_agent",
    "content": "Test from Claude",
    "source_agent": "claude"
  }'

# Test query with source_agent
curl "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev/v1/memory/query?scope=test/source_agent"
```

### Bot Integration
```bash
cd ~/claude-telegram-bot
bun run src/utils/action-ledger.ts  # Test Action Ledger persistence
```

---

## Migration Steps (Production)

1. **Deploy D1 Migration:**
   ```bash
   cd ~/memory-gateway
   wrangler d1 migrations apply DB --remote
   ```

2. **Deploy Memory Gateway:**
   ```bash
   bun run deploy
   ```

3. **Restart Telegram Bot:**
   ```bash
   cd ~/claude-telegram-bot
   bun pm2 restart jarvis-bot
   ```

4. **Verify:**
   ```bash
   # Check logs
   tail -f ~/claude-telegram-bot/logs/bot.log
   
   # Test source_agent query
   curl "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev/v1/memory/query?scope=private/jarvis/action_ledger&limit=1"
   ```

---

## Next Steps (Phase 2 Part 2)

Now that source_agent integration is complete, continue with:

1. **generatePinned() Template Improvement**
   - Extend template to include:
     * Pinned Facts
     * Active Projects
     * Known Clients
     * System Paths
     * Known Issues
     * Next Actions
   - Target: ≤1200 characters

2. **Pinned Trigger Improvement**
   - Add delta_events counter (N new events since last snapshot)
   - Trigger when: `delta_events >= N` OR `importance >= 9`
   - Configurable N (default: 50)

---

## Technical Notes

- **Backward Compatibility:** Existing entries will have `source_agent = 'jarvis'` (default)
- **Performance:** New index supports fast filtering by source_agent
- **Validation:** CHECK constraint prevents invalid agent names
- **Type Safety:** TypeScript interfaces enforce valid agent names

---

**Status:** ✅ source_agent Integration Complete — Ready for Deployment
**Duration:** 45 minutes
**Next:** generatePinned() Template Extension
