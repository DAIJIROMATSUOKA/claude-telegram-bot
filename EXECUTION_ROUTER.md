# Execution Router - Autopilot Engine v2.2

**Date:** 2026-02-03
**Status:** ✅ Complete
**Phase:** 2 (Execution Router)

## Overview

Execution Router provides safe, controlled rollout of Autopilot tasks with three execution modes and an emergency kill switch. This enables gradual deployment, testing, and emergency stops without code changes.

## Features

### 1. Shadow Mode (Default) 🔒
- **Behavior**: Proposals only, no execution
- **Use case**: Testing task generation without side effects
- **Safety**: Zero risk - nothing is executed

### 2. Canary Mode 🐤
- **Behavior**: Gradual rollout (test → canary → production)
- **Use case**: Progressive deployment with monitoring
- **Scopes**:
  - `test`: Execute in test environment
  - `canary`: Execute for 10% of users/tasks
  - `production`: Full 100% rollout

### 3. Production Mode 🚀
- **Behavior**: Full execution enabled
- **Use case**: Stable, production-ready Autopilot
- **Safety**: Full execution without restrictions

### 4. Kill Switch 🚨
- **Behavior**: Emergency stop via Memory Gateway
- **Use case**: Immediate disable during incidents
- **Persistence**: Stored in Memory Gateway (survives bot restarts)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Autopilot Engine                                    │
│                                                     │
│  ┌────────────┐        ┌──────────────────┐       │
│  │ Proposal   │───────>│ Execution Router │       │
│  │            │        │                  │       │
│  │ • Task     │        │ • Mode Check     │       │
│  │ • Plan     │        │ • Scope Check    │       │
│  │ • Risk     │        │ • Kill Switch    │       │
│  └────────────┘        └──────────────────┘       │
│                               │                     │
│                               ▼                     │
│                    ┌──────────────────┐            │
│                    │ Routing Decision │            │
│                    │                  │            │
│                    │ shouldExecute?   │            │
│                    │ reason           │            │
│                    │ mode/scope       │            │
│                    └──────────────────┘            │
│                               │                     │
│              ┌────────────────┴────────────────┐   │
│              │                                  │   │
│              ▼                                  ▼   │
│     ┌────────────────┐                ┌─────────────┐
│     │ Execute Task   │                │ Block Task  │
│     │                │                │             │
│     │ • Run plugin   │                │ • Log       │
│     │ • M3 notify    │                │ • Notify    │
│     │ • Learn log    │                │ • Skip      │
│     └────────────────┘                └─────────────┘
└─────────────────────────────────────────────────────┘

                         ▲
                         │
                  Memory Gateway
                  (Kill Switch)
```

## Usage

### Basic Usage

```typescript
import { ExecutionRouter } from '../utils/execution-router';

// Initialize (defaults to shadow mode)
const router = new ExecutionRouter(memoryGatewayUrl, 'shadow');

// Check if task should execute
const decision = await router.route(proposal);

if (decision.shouldExecute) {
  // Execute task
  await executeTask(proposal);
} else {
  // Log why execution was blocked
  console.log('Blocked:', decision.reason);
}
```

### Mode Management

```typescript
// Get current mode
const mode = router.getMode();  // 'shadow' | 'canary' | 'production'

// Change mode
router.setMode('canary');       // Enable canary mode
router.setMode('production');   // Enable production mode
router.setMode('shadow');       // Back to shadow mode
```

### Scope Management (Canary Mode)

```typescript
// Get current scope
const scope = router.getScope();  // 'test' | 'canary' | 'production'

// Set scope manually
router.setScope('test');
router.setScope('canary');
router.setScope('production');

// Promote to next scope
const result = router.promoteScope();
// test → canary → production

// Rollback to previous scope
const result = router.rollbackScope();
// production → canary → test
```

### Kill Switch

```typescript
// Enable kill switch (emergency stop)
await router.enableKillSwitch(
  'Database corruption detected',  // reason
  'admin@example.com'              // disabled_by
);

// Check kill switch status
const status = await router.checkKillSwitch();
console.log('Enabled:', status.enabled);
console.log('Reason:', status.reason);

// Disable kill switch (resume execution)
await router.disableKillSwitch('admin@example.com');
```

### Status Summary

```typescript
const status = await router.getStatus();

console.log('Mode:', status.mode);           // current execution mode
console.log('Scope:', status.scope);         // current scope (canary mode)
console.log('Kill Switch:', status.killSwitch);  // kill switch status
console.log('Can Execute:', status.canExecute);  // can tasks execute?
```

## Integration with Engine

### Constructor

```typescript
// engine.ts constructor
constructor(
  bot: Api,
  chatId: number,
  memoryGatewayUrl: string,
  executionMode: ExecutionMode = 'shadow'  // NEW: defaults to shadow
) {
  // ...
  this.executionRouter = new ExecutionRouter(memoryGatewayUrl, executionMode);
  // ...
}
```

### Execute Phase

```typescript
// Before execution, check router
const executionDecision = await this.executionRouter.route(proposal);

if (!executionDecision.shouldExecute) {
  // Log and notify user
  this.logger.info(`Execution blocked: ${proposal.task.title}`, {
    reason: executionDecision.reason,
    mode: executionDecision.mode,
    scope: executionDecision.scope,
  });

  await this.bot.sendMessage(
    this.chatId,
    `🔒 Autopilot execution blocked\n\n` +
    `Task: ${proposal.task.title}\n` +
    `Mode: ${executionDecision.mode}\n` +
    `Reason: ${executionDecision.reason}`
  );

  continue;  // Skip this task
}

// Task approved for execution
// ... execute plugin ...
```

## Execution Modes

### Shadow Mode (Default)

**When to use:**
- Initial testing of new plugins
- Verifying task generation logic
- Ensuring proposals are correct before executing

**Behavior:**
- All tasks generate proposals
- No tasks are executed
- Users see what would have happened

**Example:**
```typescript
router.setMode('shadow');

const decision = await router.route(proposal);
// decision.shouldExecute === false
// decision.reason === "Shadow Mode: proposal only, no execution"
```

### Canary Mode

**When to use:**
- Rolling out new features gradually
- Testing in production with limited blast radius
- Monitoring before full deployment

**Scopes:**
1. **Test**: Execute in test environment only
2. **Canary**: Execute for 10% of tasks/users
3. **Production**: Full 100% rollout

**Example:**
```typescript
router.setMode('canary');
router.setScope('test');

// Test scope - execute
let decision = await router.route(proposal);
// decision.shouldExecute === true
// decision.scope === 'test'

// Promote to canary
router.promoteScope();

// Canary scope - execute with monitoring
decision = await router.route(proposal);
// decision.shouldExecute === true
// decision.scope === 'canary'
// decision.canaryRollout.canaryScope === 'canary'

// Promote to production
router.promoteScope();

// Production scope - full rollout
decision = await router.route(proposal);
// decision.shouldExecute === true
// decision.scope === 'production'
```

### Production Mode

**When to use:**
- Stable, battle-tested Autopilot
- Full confidence in task generation and execution
- 24/7 automated operation

**Behavior:**
- All approved tasks execute immediately
- No scope restrictions
- Full automation

**Example:**
```typescript
router.setMode('production');

const decision = await router.route(proposal);
// decision.shouldExecute === true
// decision.mode === 'production'
```

## Kill Switch

### Use Cases

1. **Emergency Stop**: Critical bug detected, stop all automation immediately
2. **Maintenance**: Database upgrade, disable Autopilot temporarily
3. **Incident Response**: Unexpected behavior, stop and investigate

### How It Works

**Enable:**
```typescript
await router.enableKillSwitch(
  'Critical bug in evening-review plugin',
  'engineer@example.com'
);
```

**Memory Gateway Event:**
```json
{
  "scope": "shared/autopilot/kill_switch",
  "type": "kill_switch",
  "title": "🚨 Autopilot Kill Switch ENABLED",
  "content": {
    "enabled": true,
    "reason": "Critical bug in evening-review plugin",
    "disabled_by": "engineer@example.com",
    "timestamp": "2026-02-03T20:35:00Z"
  },
  "importance": 10
}
```

**Check:**
```typescript
const status = await router.checkKillSwitch();
if (status.enabled) {
  console.log('⚠️ Kill switch active!');
  console.log('Reason:', status.reason);
  console.log('Disabled by:', status.disabledBy);
  console.log('At:', status.disabledAt);
}
```

**Disable:**
```typescript
await router.disableKillSwitch('engineer@example.com');
```

**Memory Gateway Event:**
```json
{
  "scope": "shared/autopilot/kill_switch",
  "type": "kill_switch",
  "title": "✅ Autopilot Kill Switch DISABLED",
  "content": {
    "enabled": false,
    "enabled_by": "engineer@example.com",
    "timestamp": "2026-02-03T20:45:00Z"
  },
  "importance": 8
}
```

## Testing

### Run Tests

```bash
cd ~/claude-telegram-bot
bun run test-execution-router.ts
```

### Expected Output

```
🧪 Execution Router Test

============================================================
Test 1: Shadow Mode (default)
============================================================
✅ Should execute: false
   Reason: Shadow Mode: proposal only, no execution

============================================================
Test 2: Canary Mode - Test Scope
============================================================
✅ Should execute: true
   Reason: Canary Mode: executing in test scope

============================================================
Test 3: Scope Promotion (test → canary)
============================================================
✅ Promoted: test → canary

============================================================
Test 6: Production Mode
============================================================
✅ Should execute: true
   Mode: production
   Scope: production

============================================================
Test 7: Kill Switch - Enable
============================================================
✅ Kill switch enabled

============================================================
Test 9: Kill Switch - Block Execution
============================================================
✅ Should execute: false
   Reason: Kill Switch enabled: Test emergency stop

============================================================
🎉 All Tests Passed!
============================================================
```

## Troubleshooting

### Kill Switch Stuck Enabled

**Symptom**: All tasks blocked even after disabling kill switch

**Solution**:
```bash
# Check Memory Gateway
curl "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev/v1/memory/query?scope_prefix=shared/autopilot&type=kill_switch&limit=1"

# Manually disable via Memory Gateway
curl -X POST https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev/v1/memory/append \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "shared/autopilot/kill_switch",
    "type": "kill_switch",
    "title": "✅ Autopilot Kill Switch DISABLED",
    "content": "{\"enabled\":false,\"enabled_by\":\"manual\",\"timestamp\":\"2026-02-03T20:00:00Z\"}",
    "importance": 8
  }'
```

### Mode Not Changing

**Symptom**: `router.setMode('production')` doesn't work

**Solution**:
1. Check if kill switch is enabled (overrides mode)
2. Restart bot to reload ExecutionRouter instance
3. Verify mode with `router.getConfig()`

### Canary Scope Not Promoting

**Symptom**: `promoteScope()` returns `success: false`

**Solution**:
- Already at production scope (cannot promote further)
- Use `getScope()` to check current scope
- Use `rollbackScope()` to go back

## Best Practices

### 1. Start with Shadow Mode

```typescript
// Initial deployment
const router = new ExecutionRouter(memoryGatewayUrl, 'shadow');

// Verify proposals look correct
// ... test for 1 day ...

// Enable canary mode
router.setMode('canary');
router.setScope('test');
```

### 2. Gradual Canary Rollout

```typescript
// Day 1: Test scope
router.setMode('canary');
router.setScope('test');
// ... monitor for 1 day ...

// Day 2: Canary scope (10%)
router.promoteScope();  // test → canary
// ... monitor for 2-3 days ...

// Day 5: Production scope (100%)
router.promoteScope();  // canary → production
```

### 3. Monitor Mode Changes

```typescript
// Log all mode changes
router.setMode('canary');
this.logger.info('Execution mode changed', {
  mode: router.getMode(),
  scope: router.getScope(),
});

// Send notification to user
await bot.sendMessage(
  chatId,
  `⚙️ Autopilot mode changed to: ${router.getMode()}`
);
```

### 4. Emergency Rollback

```typescript
// If issues detected in production
router.rollbackScope();  // production → canary
router.rollbackScope();  // canary → test

// Or immediate emergency stop
await router.enableKillSwitch(
  'Critical bug detected',
  'oncall-engineer'
);
```

## Future Enhancements (v2.3+)

- [ ] **Percentage-based Canary**: Execute X% of tasks (not just scopes)
- [ ] **Time-based Rollout**: Auto-promote after N hours
- [ ] **Metrics Integration**: Auto-rollback on error rate spikes
- [ ] **Multi-region Support**: Different modes per region
- [ ] **A/B Testing**: Run two versions simultaneously
- [ ] **Circuit Breaker**: Auto-enable kill switch on repeated failures

## Related Files

- `src/utils/execution-router.ts` - Router implementation
- `src/autopilot/engine.ts` - Engine integration
- `test-execution-router.ts` - Test suite
- `M3_AGENT_INTEGRATION.md` - M3 Device Agent docs

## Next Steps

✅ **Phase 2 Complete** - Execution Router fully integrated

**Phase 3 (Next)**: Context Collector improvements
- Pinned memory support
- Query-based context gathering
- Token budget management
