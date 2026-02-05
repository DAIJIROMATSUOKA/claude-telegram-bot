# Autopilot Engine v1 - Integration Guide

This guide explains how to integrate Autopilot Engine v1 with the main Telegram bot.

---

## 📋 Prerequisites

1. **Memory Gateway v1.1** running and accessible
   - URL: Set `MEMORY_GATEWAY_URL` environment variable
   - Default: `http://localhost:8787` (local) or production URL

2. **Grammy bot instance** initialized in main bot
   - Access to `bot.api` for sending messages
   - Callback query handler registered

---

## 🔌 Integration Steps

### Step 1: Initialize Autopilot Engine

In your main bot file (e.g., `src/bot.ts` or `src/index.ts`):

```typescript
import { AutopilotEngine } from './autopilot/engine';
import { PredictiveTaskGenerator } from './autopilot/plugins/predictive-task-generator';
import { StalledTaskRecomposer } from './autopilot/plugins/stalled-task-recomposer';
import { ReverseScheduler } from './autopilot/plugins/reverse-scheduler';
import { ApprovalUX } from './autopilot/approval-ux';

// Initialize Autopilot Engine
const memoryGatewayUrl = process.env.MEMORY_GATEWAY_URL || 'http://localhost:8787';
const autopilotEngine = new AutopilotEngine(bot.api, chatId, memoryGatewayUrl);

// Initialize Approval UX
const approvalUX = new ApprovalUX(bot.api);

// Register plugins
autopilotEngine.registerPlugin(new PredictiveTaskGenerator(memoryGatewayUrl));
autopilotEngine.registerPlugin(new StalledTaskRecomposer(memoryGatewayUrl));
autopilotEngine.registerPlugin(new ReverseScheduler(memoryGatewayUrl));

console.log('✅ Autopilot Engine initialized with 3 plugins');
```

### Step 2: Register Callback Handlers

Add callback query handler for approval buttons:

```typescript
import { ApprovalUX } from './autopilot/approval-ux';

bot.on('callback_query', async (ctx) => {
  const callbackData = ctx.callbackQuery.data;

  // Check if this is an autopilot callback
  const parsed = ApprovalUX.parseCallbackData(callbackData);
  if (!parsed) {
    // Not an autopilot callback, pass to other handlers
    return;
  }

  const { action, proposalId } = parsed;

  // Handle approval/rejection
  if (action === 'approve') {
    await approvalUX.handleApproval(proposalId);
    await ctx.answerCallbackQuery({ text: '✅ Approved' });
  } else if (action === 'reject') {
    await approvalUX.handleRejection(proposalId);
    await ctx.answerCallbackQuery({ text: '❌ Rejected' });
  }
});
```

### Step 3: Update Autopilot Engine to Use ApprovalUX

Modify `engine.ts` to use the shared `ApprovalUX` instance:

```typescript
// In engine.ts constructor:
constructor(
  bot: Api,
  chatId: number,
  memoryGatewayUrl: string,
  approvalUX?: ApprovalUX // Add optional parameter
) {
  this.bot = bot;
  this.chatId = chatId;
  this.contextManager = new ContextManager(memoryGatewayUrl);
  this.actionLedger = new ActionLedger();
  this.approvalUX = approvalUX || new ApprovalUX(bot); // Use provided or create new
}

// In proposeToUser method:
private async proposeToUser(proposals: AutopilotProposal[]): Promise<AutopilotProposal[]> {
  const approved: AutopilotProposal[] = [];

  for (const proposal of proposals) {
    if (!proposal.approval_required) {
      proposal.task.status = 'approved';
      approved.push(proposal);
      continue;
    }

    // Request approval via ApprovalUX
    await this.approvalUX.requestApproval(this.chatId, proposal);

    // Wait for user response
    const result = await this.approvalUX.waitForApproval(proposal.task.id);

    if (result === 'approved') {
      proposal.task.status = 'approved';
      approved.push(proposal);
    } else {
      proposal.task.status = 'rejected';
    }
  }

  return approved;
}
```

### Step 4: Add Manual Trigger Command

Add a `/autopilot` command for manual testing:

```typescript
bot.command('autopilot', async (ctx) => {
  await ctx.reply('🤖 Running Autopilot Engine...');

  try {
    await autopilotEngine.run();
  } catch (error) {
    await ctx.reply(`❌ Autopilot failed: ${error}`);
  }
});
```

### Step 5: Add Cron Triggers (Optional - Phase 5)

For automated execution at specific times:

```typescript
import { schedule } from 'node-cron';

// Run at 03:00 JST daily
schedule('0 3 * * *', async () => {
  console.log('[Cron] Running Autopilot Engine at 03:00 JST');
  try {
    await autopilotEngine.run();
  } catch (error) {
    console.error('[Cron] Autopilot failed:', error);
  }
}, {
  timezone: 'Asia/Tokyo'
});

// Run at 20:00 JST daily
schedule('0 20 * * *', async () => {
  console.log('[Cron] Running Autopilot Engine at 20:00 JST');
  try {
    await autopilotEngine.run();
  } catch (error) {
    console.error('[Cron] Autopilot failed:', error);
  }
}, {
  timezone: 'Asia/Tokyo'
});
```

---

## 🧪 Testing

### Local Testing

1. **Start Memory Gateway locally:**
   ```bash
   cd ~/memory-gateway
   npm run dev
   ```

2. **Set environment variable:**
   ```bash
   export MEMORY_GATEWAY_URL=http://localhost:8787
   ```

3. **Run test suite:**
   ```bash
   cd ~/claude-telegram-bot
   npx ts-node src/autopilot/test-autopilot.ts
   ```

4. **Test with real bot:**
   ```bash
   npm run dev
   # In Telegram, send: /autopilot
   ```

### Production Testing

1. **Deploy Memory Gateway to Cloudflare:**
   ```bash
   cd ~/memory-gateway
   wrangler deploy
   ```

2. **Update environment variable:**
   ```bash
   export MEMORY_GATEWAY_URL=https://memory-gateway.your-worker.workers.dev
   ```

3. **Deploy bot and test:**
   ```bash
   cd ~/claude-telegram-bot
   npm run build
   npm start
   ```

---

## 🔍 Monitoring

### Check Autopilot Logs

Query Memory Gateway for execution logs:

```bash
curl "https://memory-gateway.your-worker.workers.dev/v1/memory/query?scope=shared/autopilot_log&type=execution_log&limit=10"
```

### Check Action Ledger

Add a debug command to view ledger state:

```typescript
bot.command('autopilot_debug', async (ctx) => {
  const entries = await autopilotEngine.actionLedger.getAll();
  const message = entries.map((e, i) =>
    `${i + 1}. ${e.dedupe_key}\n   Executed: ${e.executed_at}`
  ).join('\n\n');

  await ctx.reply(`📊 Action Ledger (${entries.length} entries):\n\n${message}`);
});
```

---

## 🚨 Troubleshooting

### Issue: No triggers detected

**Cause:** Running at wrong time of day
**Solution:** Predictive plugin only triggers at specific times:
- 7:00-9:00 for daily planning
- 19:00-21:00 for evening review
- Sunday for weekly review

### Issue: Approval buttons not working

**Cause:** Callback handler not registered
**Solution:** Ensure `bot.on('callback_query', ...)` is registered before `bot.start()`

### Issue: Memory Gateway connection failed

**Cause:** Gateway URL incorrect or Gateway not running
**Solution:**
1. Check `MEMORY_GATEWAY_URL` environment variable
2. Verify Gateway is accessible: `curl $MEMORY_GATEWAY_URL/health`

### Issue: Duplicate task executions

**Cause:** Action Ledger not working
**Solution:** Check ledger logs and TTL settings

---

## 📝 Example Integration (Complete)

```typescript
// src/bot.ts
import { Bot } from 'grammy';
import { AutopilotEngine } from './autopilot/engine';
import { PredictiveTaskGenerator } from './autopilot/plugins/predictive-task-generator';
import { ApprovalUX } from './autopilot/approval-ux';

const bot = new Bot(process.env.BOT_TOKEN!);
const chatId = parseInt(process.env.TELEGRAM_CHAT_ID!);
const memoryGatewayUrl = process.env.MEMORY_GATEWAY_URL || 'http://localhost:8787';

// Initialize Autopilot
const approvalUX = new ApprovalUX(bot.api);
const autopilotEngine = new AutopilotEngine(
  bot.api,
  chatId,
  memoryGatewayUrl,
  approvalUX
);

// Register plugins
autopilotEngine.registerPlugin(new PredictiveTaskGenerator(memoryGatewayUrl));

// Register callback handler
bot.on('callback_query', async (ctx) => {
  const parsed = ApprovalUX.parseCallbackData(ctx.callbackQuery.data);
  if (parsed) {
    if (parsed.action === 'approve') {
      await approvalUX.handleApproval(parsed.proposalId);
      await ctx.answerCallbackQuery({ text: '✅ Approved' });
    } else {
      await approvalUX.handleRejection(parsed.proposalId);
      await ctx.answerCallbackQuery({ text: '❌ Rejected' });
    }
  }
});

// Manual trigger
bot.command('autopilot', async (ctx) => {
  await ctx.reply('🤖 Running Autopilot...');
  await autopilotEngine.run();
});

bot.start();
console.log('✅ Bot started with Autopilot Engine');
```

---

## 🎯 Next Steps

1. **Phase 3.5:** Integrate with main bot following this guide
2. **Phase 4:** Add AI Council integration for low-confidence tasks
3. **Phase 5:** Add cron triggers for automated execution
4. **Phase 6:** Add more plugins based on usage patterns

---

**Status:** Ready for integration (Phase 3 complete)
**Last Updated:** 2026-02-03
