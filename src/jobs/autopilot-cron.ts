/**
 * Autopilot Cron Job
 *
 * Scheduled execution: 03:00 JST (morning) and 20:00 JST (evening)
 *
 * Usage:
 *   bun run src/jobs/autopilot-cron.ts
 */

import { Bot } from "grammy";
import { TELEGRAM_TOKEN, MEMORY_GATEWAY_URL, ALLOWED_USERS } from "../config";
import { AutopilotEngine } from "../autopilot/engine";
import { PredictiveTaskGenerator } from "../autopilot/plugins/predictive-task-generator";
import { StalledTaskRecomposer } from "../autopilot/plugins/stalled-task-recomposer";
import { ReverseScheduler } from "../autopilot/plugins/reverse-scheduler";
import { MorningBriefingPlugin } from "../autopilot/plugins/morning-briefing";
import { EveningReviewPlugin } from "../autopilot/plugins/evening-review";
import { WeeklyReviewPlugin } from "../autopilot/plugins/weekly-review";

async function runAutopilotCron() {
  console.log("=".repeat(50));
  console.log("Autopilot Cron Job");
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log("=".repeat(50));

  if (!TELEGRAM_TOKEN) {
    console.error("ERROR: TELEGRAM_BOT_TOKEN is not set");
    process.exit(1);
  }

  if (ALLOWED_USERS.length === 0) {
    console.error("ERROR: TELEGRAM_ALLOWED_USERS is not set");
    process.exit(1);
  }

  const chatId = ALLOWED_USERS[0]; // Primary user
  const bot = new Bot(TELEGRAM_TOKEN);

  try {
    console.log(`[Autopilot Cron] Starting Autopilot Engine for chat ID: ${chatId}`);

    // Create engine instance
    const engine = new AutopilotEngine(bot.api, chatId, MEMORY_GATEWAY_URL);

    // Register plugins
    engine.registerPlugin(new PredictiveTaskGenerator(MEMORY_GATEWAY_URL));
    engine.registerPlugin(new StalledTaskRecomposer(MEMORY_GATEWAY_URL));
    engine.registerPlugin(new ReverseScheduler(MEMORY_GATEWAY_URL));
    engine.registerPlugin(new MorningBriefingPlugin(MEMORY_GATEWAY_URL, TELEGRAM_TOKEN));
    engine.registerPlugin(new EveningReviewPlugin(MEMORY_GATEWAY_URL, TELEGRAM_TOKEN));
    engine.registerPlugin(new WeeklyReviewPlugin(MEMORY_GATEWAY_URL, TELEGRAM_TOKEN));

    // Run pipeline
    await engine.run();

    console.log("[Autopilot Cron] ✅ Autopilot Engine completed successfully");
  } catch (error) {
    console.error("[Autopilot Cron] ❌ Error:", error);

    // Notify user of error
    try {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await bot.api.sendMessage(
        chatId,
        `⚠️ Autopilot Cron Job failed:\n\n${errorMsg}`
      );
    } catch (notifyError) {
      console.error("[Autopilot Cron] Failed to send error notification:", notifyError);
    }

    process.exit(1);
  }

  console.log("=".repeat(50));
  console.log(`Completed at: ${new Date().toISOString()}`);
  console.log("=".repeat(50));
}

// Run the cron job
runAutopilotCron()
  .then(() => {
    console.log("[Autopilot Cron] Exiting successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[Autopilot Cron] Unhandled error:", error);
    process.exit(1);
  });
