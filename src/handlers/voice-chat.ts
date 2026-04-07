/**
 * Voice Chat Handler - STT (whisper.cpp) → Claude → TTS (macOS say)
 * Fully local on M1. No API costs. Self-contained.
 * 
 * Rollback: remove import+registration from index.ts, delete this file
 */

import { createLogger } from "../utils/logger";
const log = createLogger("voice-chat");

import { writeFileSync, unlinkSync } from 'fs';
import type { Context } from 'grammy';
import { startTypingIndicator } from '../utils';
import { fetchWithTimeout } from '../utils/fetch-with-timeout';
import { execAsync } from '../utils/exec-async';

const WHISPER_CLI = '/opt/homebrew/bin/whisper-cli';
const WHISPER_MODEL = `${process.env.HOME}/whisper-models/ggml-base.bin`;

const ENV = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
};

/**
 * Handle incoming voice messages
 */
export async function handleVoice(ctx: Context): Promise<void> {
  log.info("[VoiceChat] Handler called!", JSON.stringify({voice: !!ctx.message?.voice, from: ctx.from?.id}));
  const voice = ctx.message?.voice;
  if (!voice) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const ts = Date.now();
  const tmpOgg = `/tmp/voice-in-${ts}.ogg`;
  const tmpWav = `/tmp/voice-in-${ts}.wav`;
  const cleanup = () => {
    for (const f of [tmpOgg, tmpWav]) {
      try { unlinkSync(f); } catch {}
    }
  };

  const typing = startTypingIndicator(ctx);

  try {
    // 1. Download voice file from Telegram
    const file = await ctx.api.getFile(voice.file_id);
    if (!file.file_path) {
      await ctx.reply('❌ Voice file inaccessible');
      return;
    }
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const resp = await fetchWithTimeout(url);
    writeFileSync(tmpOgg, Buffer.from(await resp.arrayBuffer()));

    // 2. Convert ogg → wav (16kHz mono for whisper)
    await execAsync(`ffmpeg -y -i ${tmpOgg} -ar 16000 -ac 1 ${tmpWav}`, {
      timeout: 15_000,
      env: ENV,
    });

    // 3. Whisper STT (Japanese)
    const { stdout: raw } = await execAsync(
      `${WHISPER_CLI} -m ${WHISPER_MODEL} -l ja -f ${tmpWav} --no-timestamps 2>/dev/null`,
      { timeout: 30_000, env: ENV }
    );
    const text = raw.trim();

    if (!text) {
      await ctx.reply('🎤 音声を認識できませんでした');
      return;
    }

    // 4. Show transcription
    await ctx.reply(`🎤 ${text}`);

    // 5. Send transcribed text through Bridge (claude.ai Worker Tab)
    // This gives full capabilities: web search, MCP, artifacts, etc.
    const { dispatchToWorker } = await import('./croppy-bridge');
    typing.stop(); // Bridge handles its own typing indicator
    await dispatchToWorker(ctx, text, { raw: true });

  } catch (error: any) {
    const msg = error.message || String(error);
    log.error('[VoiceChat] Error:', msg);
    await ctx.reply(`❌ Voice chat error: ${msg.substring(0, 200)}`);
  } finally {
    typing.stop();
    cleanup();
  }
}
