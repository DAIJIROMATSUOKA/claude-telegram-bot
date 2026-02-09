/**
 * Autopilot Command Handler
 *
 * /autopilot - Manually trigger Autopilot Engine
 */

import type { CommandContext } from "grammy";
import type { MyContext } from "../types";
import { MEMORY_GATEWAY_URL, AUTOPILOT_ENABLED, TELEGRAM_TOKEN } from "../config";

const TELEGRAM_BOT_TOKEN = TELEGRAM_TOKEN;
import { AutopilotEngine } from "../autopilot/engine";
import type { AutopilotPlugin } from "../autopilot/types";
import { PredictiveTaskGenerator } from "../autopilot/plugins/predictive-task-generator";
import { StalledTaskRecomposer } from "../autopilot/plugins/stalled-task-recomposer";
import { ReverseScheduler } from "../autopilot/plugins/reverse-scheduler";
import { MorningBriefingPlugin } from "../autopilot/plugins/morning-briefing";
import { EveningReviewPlugin } from "../autopilot/plugins/evening-review";
import { WeeklyReviewPlugin } from "../autopilot/plugins/weekly-review";

export async function handleAutopilot(ctx: CommandContext<MyContext>) {
  if (!AUTOPILOT_ENABLED) {
    await ctx.reply("⚠️ Autopilot Engine is disabled. Set AUTOPILOT_ENABLED=true to enable.");
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.reply("❌ Cannot determine chat ID");
    return;
  }

  try {
    await ctx.reply("🤖 Starting Autopilot Engine v2.2 (Canary Mode)...");

    // Create engine instance (v2.2: Canary Mode enabled)
    const engine = new AutopilotEngine(ctx.api, chatId, MEMORY_GATEWAY_URL, 'canary');

    // Set canary scope to 'test' (test → canary → production)
    engine.getExecutionRouter().setScope('test');

    // Restore Action Ledger state from Memory Gateway (crash recovery)
    console.log("[Autopilot] Restoring Action Ledger from Memory Gateway...");
    // Note: restore() is called automatically in the engine constructor now
    // but we can add explicit restore here for transparency

    // Register plugins
    engine.registerPlugin(new PredictiveTaskGenerator(MEMORY_GATEWAY_URL));
    engine.registerPlugin(new StalledTaskRecomposer(MEMORY_GATEWAY_URL));
    engine.registerPlugin(new ReverseScheduler(MEMORY_GATEWAY_URL));
    engine.registerPlugin(new MorningBriefingPlugin(MEMORY_GATEWAY_URL, TELEGRAM_BOT_TOKEN) as AutopilotPlugin);
    engine.registerPlugin(new EveningReviewPlugin(MEMORY_GATEWAY_URL, TELEGRAM_BOT_TOKEN) as AutopilotPlugin);
    engine.registerPlugin(new WeeklyReviewPlugin(MEMORY_GATEWAY_URL, TELEGRAM_BOT_TOKEN));

    // Run pipeline
    await engine.run();

    await ctx.reply("✅ Autopilot Engine completed");
  } catch (error) {
    console.error("[Autopilot Handler] Error:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await ctx.reply(`❌ Autopilot Engine error:\n\n${errorMsg}`);
  }
}
