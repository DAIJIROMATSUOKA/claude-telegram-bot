/**
 * media-commands.ts
 * =================
 * Telegram command handlers for AI image/video generation.
 *
 * Commands:
 *   /imagine <prompt>              → Text-to-image (Z-Image-Turbo)
 *   [reply to photo] /edit <指示>   → Image editing (FLUX Kontext)
 *   [reply to photo] /animate <指示> → Image-to-video (Wan2.2 TI2V-5B)
 *
 * All operations call scripts/ai-media.py via subprocess.
 * Results are sent back to Telegram as photos/videos.
 */

import { Context } from "grammy";
import { spawn } from "child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { InputFile } from "grammy";

// HTML escape for Telegram messages
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Config
const AI_MEDIA_SCRIPT = join(process.env.HOME || "~", "claude-telegram-bot", "scripts", "ai-media.py");
const MFLUX_VENV_PYTHON = join(process.env.HOME || "~", "ai-tools", "mflux-env", "bin", "python3");
const PYTHON = existsSync(MFLUX_VENV_PYTHON) ? MFLUX_VENV_PYTHON : "python3";
const WORKING_DIR = "/tmp/ai-media";
const TIMEOUT_IMAGE = 25 * 60 * 1000;  // 25 min for image
const TIMEOUT_VIDEO = 45 * 60 * 1000;  // 45 min for video

// Ensure working directory exists
if (!existsSync(WORKING_DIR)) {
  mkdirSync(WORKING_DIR, { recursive: true });
}

// ============================================================
// Core: run ai-media.py and return JSON result
// ============================================================
interface MediaResult {
  ok: boolean;
  path?: string;
  error?: string;
  elapsed?: number;
}

interface RunOptions {
  timeout: number;
  onStderr?: (line: string) => void;
}

async function runAiMedia(args: string[], opts: RunOptions): Promise<MediaResult> {
  const { timeout, onStderr } = opts;
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, [AI_MEDIA_SCRIPT, ...args], {
      env: {
        ...process.env,
        AI_MEDIA_WORKDIR: WORKING_DIR,
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      const line = data.toString().trim();
      if (line) {
        console.log(`[media] ${line}`);
        if (onStderr) onStderr(line);
      }
    });

    // 2-stage kill: SIGTERM first, SIGKILL 5s later (ML processes often ignore SIGTERM)
    let timedOut = false;
    const softTimer = setTimeout(() => {
      timedOut = true;
      console.log("[media] ⚠️ TIMEOUT – sending SIGTERM");
      try { proc.kill("SIGTERM"); } catch {}
    }, timeout);
    const hardTimer = setTimeout(() => {
      console.log("[media] ⚠️ SIGTERM ignored – sending SIGKILL");
      try { proc.kill("SIGKILL"); } catch {}
    }, timeout + 5_000);

    proc.on("close", (code: number | null, signal: string | null) => {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      console.log(`[media-debug] exit=${code} signal=${signal} timedOut=${timedOut} stdout=${stdout.length}B stderr=${stderr.length}B`);
      console.log(`[media-debug] stdout-tail: ${stdout.slice(-300)}`);
      console.log(`[media-debug] stderr-tail: ${stderr.slice(-300)}`);
      if (timedOut) {
        resolve({
          ok: false,
          error: `タイムアウト (${Math.round(timeout / 60000)}分)`,
        });
        return;
      }
      if (code !== 0 && !stdout.trim()) {
        resolve({
          ok: false,
          error: stderr.slice(-500) || `Process exited with code ${code}`,
        });
        return;
      }
      try {
        // stdout should be JSON on the last line
        const lines = stdout.trim().split("\n");
        const jsonLine = lines[lines.length - 1];
        resolve(JSON.parse(jsonLine));
      } catch (e) {
        resolve({
          ok: false,
          error: `Failed to parse output: ${stdout.slice(-200)}`,
        });
      }
    });

    proc.on("error", (err: Error) => {
      resolve({ ok: false, error: err.message });
    });
  });
}

// ============================================================
// Download photo from Telegram message
// ============================================================
async function downloadPhoto(ctx: Context): Promise<string | null> {
  try {
    // Check replied message for photo
    const msg = ctx.message?.reply_to_message;
    if (!msg) return null;

    let fileId: string | undefined;

    if (msg.photo && msg.photo.length > 0) {
      // Get highest resolution photo
      fileId = msg.photo[msg.photo.length - 1].file_id;
    } else if (msg.document && msg.document.mime_type?.startsWith("image/")) {
      fileId = msg.document.file_id;
    }

    if (!fileId) return null;

    const file = await ctx.api.getFile(fileId);
    const filePath = file.file_path;
    if (!filePath) return null;

    // Download via Bot API
    const url = `https://api.telegram.org/file/bot${ctx.api.token}/${filePath}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const ext = filePath.split(".").pop() || "jpg";
    const localPath = join(WORKING_DIR, `input_${Date.now()}.${ext}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(localPath, buffer);

    return localPath;
  } catch (e) {
    console.error("[media] Photo download error:", e);
    return null;
  }
}

// ============================================================
// /imagine handler
// ============================================================
export async function handleImagine(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const prompt = text.replace(/^\/imagine\s*/i, "").trim();

  if (!prompt) {
    await ctx.reply("使い方: /imagine <プロンプト>\n例: /imagine 猫がサーフィンしてる写真");
    return;
  }

  const statusMsg = await ctx.reply("🎨 画像生成中... (Z-Image-Turbo, ~2-3分)");

  try {
    const result = await runAiMedia(
      ["generate", "--prompt", prompt],
      { timeout: TIMEOUT_IMAGE }
    );

    if (!result.ok || !result.path) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ 生成失敗: ${result.error?.slice(-500) || "unknown error"}`
      );
      return;
    }

    // Send the image
    await ctx.replyWithPhoto(new InputFile(result.path), {
      caption: `🎨 ${prompt}\n⏱ ${result.elapsed}秒`,
    });

    // Delete status message
    await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});

    // Cleanup
    cleanupFile(result.path);
  } catch (e: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ エラー: ${e.message?.slice(0, 200) || "unknown"}`
    );
  }
}

// ============================================================
// /edit handler
// ============================================================
export async function handleEdit(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const prompt = text.replace(/^\/edit\s*/i, "").trim();

  if (!prompt) {
    await ctx.reply("使い方: 写真に返信して /edit <指示>\n例: /edit 髪を金髪にして");
    return;
  }

  // Check for replied photo
  if (!ctx.message?.reply_to_message) {
    await ctx.reply("⚠️ 編集する写真に返信してください");
    return;
  }

  const statusMsg = await ctx.reply("✏️ 画像編集中... (FLUX Kontext, ~5-10分)");
  const chatId = ctx.chat!.id;

  try {
    // Download the photo
    const imagePath = await downloadPhoto(ctx);
    if (!imagePath) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        "❌ 写真のダウンロードに失敗しました"
      );
      return;
    }

    // Debug: throttled stderr → Telegram status update
    let lastUpdate = 0;
    const UPDATE_INTERVAL = 4_000; // 4s min between edits (Telegram rate limit)
    const debugUpdate = (line: string) => {
      const now = Date.now();
      if (now - lastUpdate < UPDATE_INTERVAL) return;
      lastUpdate = now;
      const short = line.length > 120 ? line.slice(0, 120) + "…" : line;
      ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `✏️ 編集中...\n<code>${escapeHtml(short)}</code>`,
        { parse_mode: "HTML" }
      ).catch(() => {});
    };

    // Extract optional flags from prompt
    let cleanPrompt = prompt;
    const editArgs = ["edit", "--image", imagePath];

    // --denoise N
    const denoiseMatch = cleanPrompt.match(/--denoise\s+([\d.]+)/);
    if (denoiseMatch?.[1]) {
      editArgs.push("--denoise", denoiseMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--denoise\s+[\d.]+/, "").trim();
    }

    // --no-face-mask
    if (cleanPrompt.includes("--no-face-mask")) {
      editArgs.push("--no-face-mask");
      cleanPrompt = cleanPrompt.replace("--no-face-mask", "").trim();
    }

    // --face-protect N (0.0〜1.0, default 0.35)
    const faceProtectMatch = cleanPrompt.match(/--face-protect\s+([\d.]+)/);
    if (faceProtectMatch?.[1]) {
      editArgs.push("--face-protect", faceProtectMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--face-protect\s+[\d.]+/, "").trim();
    }

    // --neg "negative prompt"
    const negMatch = cleanPrompt.match(/--neg\s+"([^"]+)"/);
    if (negMatch?.[1]) {
      editArgs.push("--negative-prompt", negMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--neg\s+"[^"]+"/, "").trim();
    }

    // --pos "additional positive prompt" (appended to user prompt)
    const posMatch = cleanPrompt.match(/--pos\s+"([^"]+)"/);
    const posText = posMatch?.[1];
    if (posText) {
      cleanPrompt = cleanPrompt.replace(/--pos\s+"[^"]+"/, "").trim();
      cleanPrompt = cleanPrompt ? `${cleanPrompt}, ${posText}` : posText;
    }

    editArgs.push("--prompt", cleanPrompt);

    const result = await runAiMedia(
      editArgs,
      { timeout: TIMEOUT_IMAGE, onStderr: debugUpdate }
    );

    if (!result.ok || !result.path) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ 編集失敗: ${result.error?.slice(-500) || "unknown error"}`
      );
      cleanupFile(imagePath);
      return;
    }

    await ctx.replyWithPhoto(new InputFile(result.path), {
      caption: `✏️ ${prompt}\n⏱ ${result.elapsed}秒`,
    });

    await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});

    cleanupFile(imagePath);
    cleanupFile(result.path);
  } catch (e: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ エラー: ${e.message?.slice(0, 200) || "unknown"}`
    );
  }
}

// ============================================================
// /animate handler
// ============================================================
export async function handleAnimate(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const prompt = text.replace(/^\/animate\s*/i, "").trim();

  if (!prompt) {
    await ctx.reply(
      "使い方:\n" +
      "• 写真に返信: /animate <動きの指示>\n" +
      "• テキストのみ: /animate <シーンの説明>\n" +
      "例: /animate 楽しそうに笑う"
    );
    return;
  }

  const hasReply = !!ctx.message?.reply_to_message;
  const statusMsg = await ctx.reply(
    `🎬 動画生成中... (Wan2.2, ~15-30分)\n${hasReply ? "📸 Image-to-Video" : "📝 Text-to-Video"}`
  );

  try {
    const args = ["animate", "--prompt", prompt];

    // If replying to a photo, download it
    if (hasReply) {
      const imagePath = await downloadPhoto(ctx);
      if (imagePath) {
        args.push("--image", imagePath);
      } else {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          "⚠️ 写真のダウンロードに失敗。テキストから動画を生成します..."
        );
      }
    }

    const result = await runAiMedia(args, { timeout: TIMEOUT_VIDEO });

    if (!result.ok || !result.path) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ 動画生成失敗: ${result.error?.slice(-500) || "unknown error"}`
      );
      return;
    }

    // Send as video or animation
    if (result.path.endsWith(".gif")) {
      await ctx.replyWithAnimation(new InputFile(result.path), {
        caption: `🎬 ${prompt}\n⏱ ${result.elapsed}秒`,
      });
    } else {
      await ctx.replyWithVideo(new InputFile(result.path), {
        caption: `🎬 ${prompt}\n⏱ ${result.elapsed}秒`,
      });
    }

    await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
    cleanupFile(result.path);
  } catch (e: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ エラー: ${e.message?.slice(0, 200) || "unknown"}`
    );
  }
}

// ============================================================
// Utility
// ============================================================
function cleanupFile(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}

/**
 * Register media commands on the bot.
 * Call this from text.ts or index.ts:
 *
 *   import { registerMediaCommands } from "./handlers/media-commands";
 *   registerMediaCommands(bot);
 */
export function registerMediaCommands(bot: any): void {
  bot.command("imagine", handleImagine);
  bot.command("edit", handleEdit);
  bot.command("animate", handleAnimate);
}
