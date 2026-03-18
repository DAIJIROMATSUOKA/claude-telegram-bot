/**
 * Voice Chat Handler - STT (whisper.cpp) → Claude → TTS (macOS say)
 * Fully local on M1. No API costs. Self-contained.
 * 
 * Rollback: remove import+registration from index.ts, delete this file
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import type { Context } from 'grammy';
import { InputFile } from 'grammy';
import { startTypingIndicator } from '../utils';

const execAsync = promisify(exec);

const WHISPER_CLI = '/opt/homebrew/bin/whisper-cli';
const WHISPER_MODEL = `${process.env.HOME}/whisper-models/ggml-base.bin`;
const TTS_VOICE = 'Kyoko';
const MAX_TTS_CHARS = 800; // say -v Kyoko limit for reasonable audio length
const CLAUDE_TIMEOUT = 120_000; // 2 minutes

const ENV = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
};

/**
 * Handle incoming voice messages
 */
export async function handleVoice(ctx: Context): Promise<void> {
  const voice = ctx.message?.voice;
  if (!voice) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const ts = Date.now();
  const tmpOgg = `/tmp/voice-in-${ts}.ogg`;
  const tmpWav = `/tmp/voice-in-${ts}.wav`;
  const tmpAiff = `/tmp/voice-out-${ts}.aiff`;
  const tmpOggOut = `/tmp/voice-out-${ts}.ogg`;
  const tmpPrompt = `/tmp/voice-prompt-${ts}.txt`;
  const cleanup = () => {
    for (const f of [tmpOgg, tmpWav, tmpAiff, tmpOggOut, tmpPrompt]) {
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
    const resp = await fetch(url);
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

    // 5. Send to Claude CLI (local, Max plan, single-turn)
    writeFileSync(tmpPrompt, text, 'utf-8');
    const { stdout: response, stderr } = await execAsync(
      `cat ${tmpPrompt} | claude -p --model sonnet 2>/dev/null`,
      { timeout: CLAUDE_TIMEOUT, env: ENV, maxBuffer: 5 * 1024 * 1024 }
    );
    const responseText = response.trim();

    if (!responseText) {
      await ctx.reply('❌ Claude応答なし');
      return;
    }

    // 6. TTS → voice message (truncate for reasonable length)
    const ttsText = responseText.substring(0, MAX_TTS_CHARS);
    // Write to file to avoid shell escaping issues
    const tmpTtsInput = `/tmp/voice-tts-input-${ts}.txt`;
    writeFileSync(tmpTtsInput, ttsText, 'utf-8');

    await execAsync(
      `say -v ${TTS_VOICE} -o ${tmpAiff} < ${tmpTtsInput}`,
      { timeout: 30_000, env: ENV }
    );
    await execAsync(
      `ffmpeg -y -i ${tmpAiff} -c:a libopus ${tmpOggOut}`,
      { timeout: 15_000, env: ENV }
    );

    // Send voice response
    const audioData = readFileSync(tmpOggOut);
    await ctx.replyWithVoice(new InputFile(audioData, 'response.ogg'));

    // Also send text if longer than TTS limit
    if (responseText.length > MAX_TTS_CHARS) {
      await ctx.reply(responseText);
    }

    // Cleanup TTS input
    try { unlinkSync(tmpTtsInput); } catch {}

  } catch (error: any) {
    const msg = error.message || String(error);
    console.error('[VoiceChat] Error:', msg);
    await ctx.reply(`❌ Voice chat error: ${msg.substring(0, 200)}`);
  } finally {
    typing.stop();
    cleanup();
  }
}
