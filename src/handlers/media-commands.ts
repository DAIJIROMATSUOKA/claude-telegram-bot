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

// Config
const AI_MEDIA_SCRIPT = join(process.env.HOME || "~", "claude-telegram-bot", "scripts", "ai-media.py");
const MFLUX_VENV_PYTHON = join(process.env.HOME || "~", "ai-tools", "mflux-env", "bin", "python3");
const PYTHON = existsSync(MFLUX_VENV_PYTHON) ? MFLUX_VENV_PYTHON : "python3";
const WORKING_DIR = "/tmp/ai-media";
const TIMEOUT_IMAGE = 15 * 60 * 1000;  // 15 min for image
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

async function runAiMedia(args: string[], timeout: number): Promise<MediaResult> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, [AI_MEDIA_SCRIPT, ...args], {
      timeout,
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
      // Log progress to console
      const line = data.toString().trim();
      if (line) console.log(`[media] ${line}`);
    });

    proc.on("close", (code: number | null) => {
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
      TIMEOUT_IMAGE
    );

    if (!result.ok || !result.path) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ 生成失敗: ${result.error?.slice(0, 200) || "unknown error"}`
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

  try {
    // Download the photo
    const imagePath = await downloadPhoto(ctx);
    if (!imagePath) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "❌ 写真のダウンロードに失敗しました"
      );
      return;
    }

    const result = await runAiMedia(
      ["edit", "--image", imagePath, "--prompt", prompt],
      TIMEOUT_IMAGE
    );

    if (!result.ok || !result.path) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ 編集失敗: ${result.error?.slice(0, 200) || "unknown error"}`
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

    const result = await runAiMedia(args, TIMEOUT_VIDEO);

    if (!result.ok || !result.path) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ 動画生成失敗: ${result.error?.slice(0, 200) || "unknown error"}`
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
