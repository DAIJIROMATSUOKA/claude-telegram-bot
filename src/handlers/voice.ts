/**
 * Voice message handler for Claude Telegram Bot.
 */

import type { Context } from "grammy";
import { unlinkSync } from "fs";
import { session } from "../session";
import { ALLOWED_USERS, TEMP_DIR, TRANSCRIPTION_AVAILABLE } from "../config";
import { isAuthorized, rateLimiter } from "../security";
import {
  auditLog,
  auditLogRateLimit,
  transcribeVoice,
  startTypingIndicator,
} from "../utils";
import { StreamingState, createStatusCallback } from "./streaming";
import { controlTowerDB } from "../utils/control-tower-db";
import { redactSensitiveData } from "../utils/redaction-filter";

/**
 * Handle incoming voice messages.
 */
export async function handleVoice(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "unknown";
  const chatId = ctx.chat?.id;
  const voice = ctx.message?.voice;

  if (!userId || !voice || !chatId) {
    return;
  }

  // 1. Authorization check
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized. Contact the bot owner for access.");
    return;
  }

  // 2. Check if transcription is available
  if (!TRANSCRIPTION_AVAILABLE) {
    await ctx.reply(
      "Voice transcription is not configured. Set OPENAI_API_KEY in .env"
    );
    return;
  }

  // 3. Rate limit check
  const [allowed, retryAfter] = rateLimiter.check(userId);
  if (!allowed) {
    await auditLogRateLimit(userId, username, retryAfter!);
    await ctx.reply(
      `⏳ Rate limited. Please wait ${retryAfter!.toFixed(1)} seconds.`
    );
    return;
  }

  // 4. Mark processing started (allows /stop to work during transcription/classification)
  const stopProcessing = session.startProcessing();

  // 5. Start typing indicator for transcription
  const typing = startTypingIndicator(ctx);

  let voicePath: string | null = null;

  try {
    // 6. Download voice file
    const file = await ctx.getFile();
    const timestamp = Date.now();
    voicePath = `${TEMP_DIR}/voice_${timestamp}.ogg`;

    // Download the file
    const downloadRes = await fetch(
      `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`
    );
    const buffer = await downloadRes.arrayBuffer();
    await Bun.write(voicePath, buffer);

    // 7. Transcribe
    const statusMsg = await ctx.reply("🎤 Transcribing...");

    const transcript = await transcribeVoice(voicePath);
    if (!transcript) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        "❌ Transcription failed."
      );
      stopProcessing();
      return;
    }

    // 8. Show transcript
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `🎤 "${transcript}"`
    );

    // 9. Set conversation title from transcript (if new session)
    if (!session.isActive) {
      const title =
        transcript.length > 50 ? transcript.slice(0, 47) + "..." : transcript;
      session.conversationTitle = title;
    }

    // 10. Create streaming state and callback
    const state = new StreamingState();
    const statusCallback = createStatusCallback(ctx, state);

    // 11. Start action trace
    const sessionId = `telegram_${chatId}_${Date.now()}`;
    const startedAt = Date.now();
    const actionName = transcript.slice(0, 50);
    const inputsRedacted = redactSensitiveData(transcript).sanitized;

    const traceId = controlTowerDB.startActionTrace({
      session_id: sessionId,
      action_type: 'voice_message',
      action_name: actionName,
      inputs_redacted: inputsRedacted,
      metadata: { username, userId: String(userId) },
    });

    // 12. Send to Claude
    const claudeResponse = await session.sendMessageStreaming(
      transcript,
      username,
      userId,
      statusCallback,
      chatId,
      ctx
    );

    // 13. Complete action trace (success)
    const completedAt = Math.floor(Date.now() / 1000);
    const durationMs = Date.now() - startedAt;
    const outputsSummary = claudeResponse.slice(0, 200);

    controlTowerDB.completeActionTrace({
      id: traceId,
      status: 'completed',
      completed_at: completedAt,
      duration_ms: durationMs,
      outputs_summary: outputsSummary,
    });

    // 14. Audit log
    await auditLog(userId, username, "VOICE", transcript, claudeResponse);
  } catch (error) {
    console.error("Error processing voice:", error);

    // Complete action trace (failed) - only if transcript was available
    if (voicePath) {
      const sessionId = `telegram_${chatId}_${Date.now()}`;
      const completedAt = Math.floor(Date.now() / 1000);
      const errorSummary = String(error).slice(0, 200);

      // Find the latest trace for this session and mark as failed
      const latestTrace = controlTowerDB.getLatestActionTrace(sessionId);
      if (latestTrace && latestTrace.status === 'started') {
        controlTowerDB.completeActionTrace({
          id: latestTrace.id,
          status: 'failed',
          completed_at: completedAt,
          duration_ms: Date.now() - (latestTrace.started_at * 1000),
          error_summary: errorSummary,
        });
      }
    }

    if (String(error).includes("abort") || String(error).includes("cancel")) {
      // Only show "Query stopped" if it was an explicit stop, not an interrupt from a new message
      const wasInterrupt = session.consumeInterruptFlag();
      if (!wasInterrupt) {
        await ctx.reply("🛑 Query stopped.");
      }
    } else {
      await ctx.reply(`❌ Error: ${String(error).slice(0, 200)}`);
    }
  } finally {
    stopProcessing();
    typing.stop();

    // Clean up voice file
    if (voicePath) {
      try {
        unlinkSync(voicePath);
      } catch (error) {
        console.debug("Failed to delete voice file:", error);
      }
    }
  }
}
