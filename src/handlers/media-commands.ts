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

import { createLogger } from "../utils/logger";
const log = createLogger("media-commands");

import { Context } from "grammy";
import { spawn, exec } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { writeFile, unlink, stat } from "fs/promises";
import { join, basename } from "path";
import { InputFile } from "grammy";
import { escapeHtml } from "../formatting";
import { fetchWithTimeout } from "../utils/fetch-with-timeout";

// Media queue: serialize heavy AI tasks to prevent SIGTERM under memory pressure
let mediaQueueBusy = false;
const mediaQueueWaiting: Array<{ run: () => Promise<any>; resolve: (v: any) => void; reject: (e: any) => void }> = [];
async function withMediaQueue<T>(fn: () => Promise<T>): Promise<T> {
  if (mediaQueueBusy) {
    return new Promise<T>((resolve, reject) => { mediaQueueWaiting.push({ run: fn, resolve, reject }); });
  }
  mediaQueueBusy = true;
  try { return await fn(); }
  finally {
    const next = mediaQueueWaiting.shift();
    if (next) { (async () => { try { next.resolve(await next.run()); } catch (e) { next.reject(e); } finally { mediaQueueBusy = false; } })(); }
    else { mediaQueueBusy = false; }
  }
}

// Config
const execAsync = promisify(exec);
import { AI_MEDIA_SCRIPT, PYTHON, TIMEOUT_IMAGE, TIMEOUT_VIDEO, MEDIA_WORKING_DIR as WORKING_DIR } from "../constants";

// Ensure working directory exists
if (!existsSync(WORKING_DIR)) {
  mkdirSync(WORKING_DIR, { recursive: true });
}

// ============================================================
// PRIVACY MODE: Local file path support (added 2026-02-10)
// ROLLBACK: Remove this section + revert handler changes below
// ============================================================

/**
 * Parse a local file path from command text.
 * Detects paths starting with /Users/ or ~ and extracts them.
 * Returns { localPath, remainingText } or null if no path found.
 */
function parseLocalPath(commandText: string): { localPath: string; remainingText: string } | null {
  // Match path starting with /Users/ (may contain spaces if quoted, but typically no spaces in macOS paths)
  // Also support ~ as home dir shortcut
  const text = commandText.trim();

  // Try quoted path first: "/Users/foo/bar baz.heic"
  const quotedMatch = text.match(/^"(\/Users\/[^"]+|~\/[^"]+)"\s*(.*)/s);
  if (quotedMatch?.[1]) {
    const p = quotedMatch[1].replace(/^~/, process.env.HOME || "/Users");
    return { localPath: p, remainingText: (quotedMatch[2] || "").trim() };
  }

  // Unquoted path: /Users/foo/bar.heic (no spaces — stop at first whitespace)
  const unquotedMatch = text.match(/^(\/Users\/\S+|~\/\S+)\s*(.*)/s);
  if (unquotedMatch?.[1]) {
    const p = unquotedMatch[1].replace(/^~/, process.env.HOME || "/Users");
    return { localPath: p, remainingText: (unquotedMatch[2] || "").trim() };
  }

  return null;
}

/**
 * Resolve a local image path: verify existence, convert HEIC→JPEG if needed.
 * Returns the usable image path, or null if file doesn't exist.
 */
function resolveLocalImage(localPath: string): string | null {
  if (!existsSync(localPath)) return null;

  const ext = localPath.split(".").pop()?.toLowerCase() || "";
  if (ext === "heic" || ext === "heif") {
    const jpegPath = join(WORKING_DIR, `local_input_${Date.now()}.jpg`);
    try {
      const proc = Bun.spawnSync(["sips", "-s", "format", "jpeg", localPath, "--out", jpegPath]);
      if (proc.exitCode === 0 && existsSync(jpegPath)) {
        log.info(`[media] Local HEIC → JPEG: ${jpegPath}`);
        return jpegPath;
      }
    } catch (e) {
      log.error("[media] Local HEIC conversion failed:", e);
    }
  }

  return localPath;
}

/**
 * Format file size for display.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Send result in privacy mode: text notification only + auto-open in Mac Preview.
 * No image/video is sent to Telegram.
 */
async function sendResultPrivate(
  ctx: Context,
  statusMsgId: number,
  resultPath: string,
  elapsed: number | undefined,
  commandName: string
): Promise<void> {
  const chatId = ctx.chat!.id;

  // Get file info
  let sizeStr = "不明";
  try {
    const st = await stat(resultPath);
    sizeStr = formatFileSize(st.size);
  } catch {}

  const elapsedStr = elapsed ? `${elapsed}秒` : "不明";
  const fname = basename(resultPath);

  // Send text notification only — NO image sent to Telegram
  const notification =
    `完了 (${elapsedStr})\n` +
    `コマンド: ${commandName}\n` +
    `出力: ${resultPath}\n` +
    `ファイル: ${fname}\n` +
    `サイズ: ${sizeStr}`;

  await ctx.api.editMessageText(chatId, statusMsgId, notification);
}

// ============================================================
// Core: run ai-media.py and return JSON result
// ============================================================
interface MediaResult {
  ok: boolean;
  path?: string;
  error?: string;
  elapsed?: number;
  input_path?: string;   // GIF animation: original input image path
  mask_path?: string;     // GIF animation: SegFormer mask image path
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
        PYTHONUNBUFFERED: "1",
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
        log.info(`[media] ${line}`);
        if (onStderr) onStderr(line)
        resetTimeout();;
      }
    });

    // Activity-based timeout: resets on every stderr output (model loading keeps it alive)
    let timedOut = false;
    let softTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;
    const resetTimeout = () => {
      if (softTimer) if (softTimer) clearTimeout(softTimer);
      if (hardTimer) if (hardTimer) clearTimeout(hardTimer);
      softTimer = setTimeout(() => {
        timedOut = true;
        log.info(`[media]     TIMEOUT (no activity for ${Math.round(timeout / 60000)}min) -> sending SIGTERM`);
        try { proc.kill('SIGTERM'); } catch {}
      }, timeout);
      hardTimer = setTimeout(() => {
        log.info(`[media]     SIGTERM ignored -> sending SIGKILL`);
        try { proc.kill('SIGKILL'); } catch {}
      }, timeout + 5_000);
    };
    resetTimeout();

    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (softTimer) clearTimeout(softTimer);
      if (hardTimer) clearTimeout(hardTimer);
      log.info(`[media-debug] exit=${code} signal=${signal} timedOut=${timedOut} stdout=${stdout.length}B stderr=${stderr.length}B`);
      log.info(`[media-debug] stdout-tail: ${stdout.slice(-300)}`);
      log.info(`[media-debug] stderr-tail: ${stderr.slice(-300)}`);
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
        const jsonLine = lines[lines.length - 1] ?? "";
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
      fileId = msg.photo[msg.photo.length - 1]!.file_id;
    } else if (msg.document) {
      // Accept image documents by mime_type OR file extension (HEIC often has wrong mime)
      const mime = msg.document.mime_type || "";
      const fname = (msg.document.file_name || "").toLowerCase();
      const imageExts = [".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"];
      if (mime.startsWith("image/") || imageExts.some(ext => fname.endsWith(ext))) {
        fileId = msg.document.file_id;
      }
    }

    if (!fileId) return null;

    const file = await ctx.api.getFile(fileId);
    const filePath = file.file_path;
    if (!filePath) return null;

    // Download via Bot API
    const url = `https://api.telegram.org/file/bot${ctx.api.token}/${filePath}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;

    const ext = (filePath.split(".").pop() || "jpg").toLowerCase();
    const localPath = join(WORKING_DIR, `input_${Date.now()}.${ext}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(localPath, buffer);

    // Convert HEIC/HEIF to JPEG using macOS sips (more reliable than PIL)
    if (ext === "heic" || ext === "heif") {
      const jpegPath = localPath.replace(/\.[^.]+$/, ".jpg");
      try {
        const proc = Bun.spawnSync(["sips", "-s", "format", "jpeg", localPath, "--out", jpegPath]);
        if (proc.exitCode === 0 && existsSync(jpegPath)) {
          try { await unlink(localPath); } catch {}
          log.info(`[media] Converted HEIC → JPEG: ${jpegPath}`);
          return jpegPath;
        }
      } catch (e) {
        log.error("[media] HEIC conversion failed, using original:", e);
      }
    }

    return localPath;
  } catch (e) {
    log.error("[media] Photo download error:", e);
    return null;
  }
}

/** /imagine <prompt> -- Generate an image from text via AI. */
export async function handleImagine(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const prompt = text.replace(/^\/imagine\s*/i, "").trim();

  if (!prompt) {
    await ctx.reply("使い方: /imagine <プロンプト>\n例: /imagine 猫がサーフィンしてる写真");
    return;
  }

  const statusMsg = await ctx.reply("🎨 画像生成中... (Z-Image-Turbo, ~2-3分)");

  try {
    // Extract optional flags
    let cleanPrompt = prompt;
    const genArgs = ["generate"];

    // --steps N
    const stepsMatch = cleanPrompt.match(/--steps\s+(\d+)/);
    if (stepsMatch?.[1]) {
      genArgs.push("--steps", stepsMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--steps\s+\d+/, "").trim();
    }

    genArgs.push("--prompt", cleanPrompt);

    const result = await withMediaQueue(() => runAiMedia(
      genArgs,
      { timeout: TIMEOUT_IMAGE }
    ));

    if (!result.ok || !result.path) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ 生成失敗: ${result.error?.slice(-500) || "unknown error"}`
      );
      return;
    }

    // Send photo preview (inline, compressed) + document (original quality)
    const imagineFilename = `imagine_${Date.now()}.png`;
    const caption = `🎨 ${prompt}\n⏱ ${result.elapsed}秒`;
    await ctx.replyWithPhoto(new InputFile(result.path), { caption });
    await ctx.replyWithDocument(new InputFile(result.path, imagineFilename), {
      caption: `📎 原寸: ${imagineFilename}`,
      disable_content_type_detection: true,
    });

    // Delete status message
    await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});

    // Cleanup
    await cleanupFile(result.path);
  } catch (e: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ エラー: ${e.message?.slice(0, 200) || "unknown"}`
    );
  }
}

/** /edit <instruction> -- Edit a replied-to photo with AI. */
export async function handleEdit(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const rawArgs = text.replace(/^\/edit\s*/i, "").trim();

  // PRIVACY MODE: Check for local file path (added 2026-02-10)
  // ROLLBACK: Remove localPathInfo block, revert to old prompt/reply_to_message check
  const localPathInfo = parseLocalPath(rawArgs);
  const isPrivacyMode = !!localPathInfo;
  const prompt = isPrivacyMode ? localPathInfo!.remainingText : rawArgs;

  if (!prompt) {
    await ctx.reply(
      "使い方:\n" +
      "  写真に返信: /edit <指示>\n" +
      "  パス指定:   /edit /Users/.../image.heic <指示>\n\n" +
      "例: /edit 髪を金髪にして\n" +
      "例: /edit /Users/daijiromatsuokam1/Downloads/photo.heic 髪を金髪にして\n\n" +
      "オプション:\n--denoise 0.7 (変更の強さ 0.0〜1.0)\n--face-mask (顔保護を有効化)\n--face-protect 0.5 (顔保護レベル 0.0〜1.0)\n--expand bottom 512 (キャンバス拡張: 方向 ピクセル数)\n--neg \"避けたい内容\"\n--pos \"追加指示\"\n\n" +
      "※ パス指定時は画像をTelegramに送信しません (プライバシーモード)\n※顔保護はデフォルト無効"
    );
    return;
  }

  // Need either a replied photo OR a local file path
  if (!ctx.message?.reply_to_message && !isPrivacyMode) {
    await ctx.reply("⚠️ 編集する写真に返信するか、パスを指定してください\n例: /edit /Users/.../image.heic 髪を金髪にして");
    return;
  }

  const statusMsg = await ctx.reply("✏️ 画像編集中... (FLUX Dev img2img, ~5-10分)");
  const chatId = ctx.chat!.id;

  try {
    // PRIVACY MODE: Use local path OR download from Telegram
    let imagePath: string | null = null;
    let isLocalInput = false;

    if (isPrivacyMode) {
      imagePath = resolveLocalImage(localPathInfo!.localPath);
      isLocalInput = true;
      if (!imagePath) {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          `❌ ファイルが見つかりません: ${localPathInfo!.localPath}`
        );
        return;
      }
      log.info(`[media] Privacy mode: using local file ${imagePath}`);
    } else {
      imagePath = await downloadPhoto(ctx);
      if (!imagePath) {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          "❌ 写真のダウンロードに失敗しました"
        );
        return;
      }
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

    // --steps N (sampling steps, default 15)
    const stepsMatch = cleanPrompt.match(/--steps\s+(\d+)/);
    if (stepsMatch?.[1]) {
      editArgs.push("--steps", stepsMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--steps\s+\d+/, "").trim();
    }

    // --denoise N
    const denoiseMatch = cleanPrompt.match(/--denoise\s+([\d.]+)/);
    if (denoiseMatch?.[1]) {
      editArgs.push("--denoise", denoiseMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--denoise\s+[\d.]+/, "").trim();
    }

    // --face-mask to enable face protection (off by default)
    if (cleanPrompt.includes("--face-mask")) {
      editArgs.push("--face-mask");
      cleanPrompt = cleanPrompt.replace("--face-mask", "").trim();
    }

    // --face-protect N (0.0〜1.0, default 0.35)
    const faceProtectMatch = cleanPrompt.match(/--face-protect\s+([\d.]+)/);
    if (faceProtectMatch?.[1]) {
      editArgs.push("--face-protect", faceProtectMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--face-protect\s+[\d.]+/, "").trim();
    }

    // --expand [direction] N (canvas expansion before edit)
    const expandMatch = cleanPrompt.match(/--expand\s+(bottom|top|left|right)\s+(\d+)/);
    if (expandMatch?.[1] && expandMatch[2]) {
      editArgs.push("--direction", expandMatch[1], "--expand", expandMatch[2]);
      cleanPrompt = cleanPrompt.replace(/--expand\s+(bottom|top|left|right)\s+\d+/, "").trim();
    } else {
      // --expand N (direction defaults to bottom)
      const expandSimple = cleanPrompt.match(/--expand\s+(\d+)/);
      if (expandSimple?.[1]) {
        editArgs.push("--expand", expandSimple[1]);
        cleanPrompt = cleanPrompt.replace(/--expand\s+\d+/, "").trim();
      }
    }

    // --engine kontext|dev|fill (editing engine selection)
    const engineMatch = cleanPrompt.match(/--engine\s+(kontext|dev|fill)/);
    if (engineMatch?.[1]) {
      editArgs.push("--engine", engineMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--engine\s+\S+/, "").trim();
    }

    // --guidance N (FluxGuidance for Kontext/Fill engine)
    const guidanceMatch = cleanPrompt.match(/--guidance\s+([\d.]+)/);
    if (guidanceMatch?.[1]) {
      editArgs.push("--guidance", guidanceMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--guidance\s+[\d.]+/, "").trim();
    }

    // --nsfw (shortcut: automatically add NSFW LoRAs for undressing)
    if (cleanPrompt.includes("--nsfw")) {
      editArgs.push("--extra-loras", "flux-lora-uncensored.safetensors:0.9,undressing_flux_v3.safetensors:1.0");
      cleanPrompt = cleanPrompt.replace("--nsfw", "").trim();
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

    const result = await withMediaQueue(() => runAiMedia(
      editArgs,
      { timeout: TIMEOUT_IMAGE, onStderr: debugUpdate }
    ));

    if (!result.ok || !result.path) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ 編集失敗: ${result.error?.slice(-500) || "unknown error"}`
      );
      if (!isLocalInput) await cleanupFile(imagePath);
      return;
    }

    // PRIVACY MODE: Text notification only + open in Preview (no image sent to Telegram)
    // ROLLBACK: Remove isPrivacyMode branch, keep only else block
    if (isPrivacyMode) {
      await sendResultPrivate(ctx, statusMsg.message_id, result.path, result.elapsed, "/edit");
    } else {
      // ORIGINAL: Send photo preview (inline, compressed) + document (original quality)
      const filename = `edit_${Date.now()}.png`;
      const caption = `✏️ ${prompt}\n⏱ ${result.elapsed}秒`;
      const fileSize = (await stat(result.path)).size;
      log.info(`[media-upload] /edit starting upload: ${result.path} (${fileSize}B)`);
      const t0 = Date.now();
      await ctx.replyWithPhoto(new InputFile(result.path), { caption });
      log.info(`[media-upload] /edit photo sent in ${Date.now() - t0}ms`);
      const t1 = Date.now();
      await ctx.replyWithDocument(new InputFile(result.path, filename), {
        caption: `📎 原寸: ${filename}`,
        disable_content_type_detection: true,
      });
      log.info(`[media-upload] /edit document sent in ${Date.now() - t1}ms (total ${Date.now() - t0}ms)`);
      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
      await cleanupFile(imagePath);
      await cleanupFile(result.path);
    }
  } catch (e: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ エラー: ${e.message?.slice(0, 200) || "unknown"}`
    );
  }
}

/** /outpaint -- Extend image canvas with AI outpainting. */
export async function handleOutpaint(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const rawArgs = text.replace(/^\/outpaint\s*/i, "").trim();

  // PRIVACY MODE: Check for local file path (added 2026-02-10)
  // ROLLBACK: Remove localPathInfo block, revert to old prompt/reply_to_message check
  const localPathInfo = parseLocalPath(rawArgs);
  const isPrivacyMode = !!localPathInfo;
  const prompt = isPrivacyMode ? localPathInfo!.remainingText : rawArgs;

  if (!prompt) {
    await ctx.reply(
      "使い方:\n" +
      "  写真に返信: /outpaint <指示>\n" +
      "  パス指定:   /outpaint /Users/.../image.heic <指示>\n\n" +
      "例: /outpaint full body, standing, natural skin\n" +
      "例: /outpaint /Users/daijiromatsuokam1/Downloads/photo.heic full body\n\n" +
      "オプション:\n--direction bottom|top|left|right (拡張方向, デフォルト: bottom)\n--expand 512 (拡張ピクセル数, 0=自動)\n--denoise 0.85 (変更の強さ)\n--feathering 128 (境界ぼかし幅, デフォルト: 128)\n--neg \"避けたい内容\"\n\n" +
      "※ パス指定時は画像をTelegramに送信しません (プライバシーモード)"
    );
    return;
  }

  // Need either a replied photo OR a local file path
  if (!ctx.message?.reply_to_message && !isPrivacyMode) {
    await ctx.reply("⚠️ 拡張する写真に返信するか、パスを指定してください\n例: /outpaint /Users/.../image.heic full body");
    return;
  }

  const statusMsg = await ctx.reply("🖼️ 画像拡張中... (FLUX Dev outpaint, ~15-30分)");
  const chatId = ctx.chat!.id;

  try {
    // PRIVACY MODE: Use local path OR download from Telegram
    let imagePath: string | null = null;
    let isLocalInput = false;

    if (isPrivacyMode) {
      imagePath = resolveLocalImage(localPathInfo!.localPath);
      isLocalInput = true;
      if (!imagePath) {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          `❌ ファイルが見つかりません: ${localPathInfo!.localPath}`
        );
        return;
      }
      log.info(`[media] Privacy mode: using local file ${imagePath}`);
    } else {
      imagePath = await downloadPhoto(ctx);
      if (!imagePath) {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          "❌ 写真のダウンロードに失敗しました"
        );
        return;
      }
    }

    let lastUpdate = 0;
    const UPDATE_INTERVAL = 4_000;
    const debugUpdate = (line: string) => {
      const now = Date.now();
      if (now - lastUpdate < UPDATE_INTERVAL) return;
      lastUpdate = now;
      const short = line.length > 120 ? line.slice(0, 120) + "…" : line;
      ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `🖼️ 拡張中...\n<code>${escapeHtml(short)}</code>`,
        { parse_mode: "HTML" }
      ).catch(() => {});
    };

    let cleanPrompt = prompt;
    const outpaintArgs = ["outpaint", "--image", imagePath];

    // --steps N (sampling steps, default 25)
    const stepsMatch = cleanPrompt.match(/--steps\s+(\d+)/);
    if (stepsMatch?.[1]) {
      outpaintArgs.push("--steps", stepsMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--steps\s+\d+/, "").trim();
    }

    // --direction
    const dirMatch = cleanPrompt.match(/--direction\s+(bottom|top|left|right)/);
    if (dirMatch?.[1]) {
      outpaintArgs.push("--direction", dirMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--direction\s+\S+/, "").trim();
    }

    // --expand N
    const expandMatch = cleanPrompt.match(/--expand\s+(\d+)/);
    if (expandMatch?.[1]) {
      outpaintArgs.push("--expand", expandMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--expand\s+\d+/, "").trim();
    }

    // --denoise N
    const denoiseMatch = cleanPrompt.match(/--denoise\s+([\d.]+)/);
    if (denoiseMatch?.[1]) {
      outpaintArgs.push("--denoise", denoiseMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--denoise\s+[\d.]+/, "").trim();
    }

    // --feathering N
    const featherMatch = cleanPrompt.match(/--feathering\s+(\d+)/);
    if (featherMatch?.[1]) {
      outpaintArgs.push("--feathering", featherMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--feathering\s+\d+/, "").trim();
    }

    // --neg "negative prompt"
    const negMatch = cleanPrompt.match(/--neg\s+"([^"]+)"/);
    if (negMatch?.[1]) {
      outpaintArgs.push("--negative-prompt", negMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--neg\s+"[^"]+"/, "").trim();
    }

    outpaintArgs.push("--prompt", cleanPrompt);

    const result = await withMediaQueue(() => runAiMedia(
      outpaintArgs,
      { timeout: TIMEOUT_VIDEO, onStderr: debugUpdate }
    ));

    if (!result.ok || !result.path) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `❌ 拡張失敗: ${result.error?.slice(-500) || "unknown error"}`
      );
      if (!isLocalInput) await cleanupFile(imagePath);
      return;
    }

    // PRIVACY MODE: Text notification only + open in Preview (no image sent to Telegram)
    // ROLLBACK: Remove isPrivacyMode branch, keep only else block
    if (isPrivacyMode) {
      await sendResultPrivate(ctx, statusMsg.message_id, result.path, result.elapsed, "/outpaint");
    } else {
      // ORIGINAL: Send photo preview (inline, compressed) + document (original quality)
      const filename = `outpaint_${Date.now()}.png`;
      const caption = `🖼️ ${prompt}\n⏱ ${result.elapsed}秒`;
      await ctx.replyWithPhoto(new InputFile(result.path), { caption });
      await ctx.replyWithDocument(new InputFile(result.path, filename), {
        caption: `📎 原寸: ${filename}`,
        disable_content_type_detection: true,
      });
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
      await cleanupFile(imagePath);
      await cleanupFile(result.path);
    }
  } catch (e: any) {
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `❌ エラー: ${e.message?.slice(0, 200) || "unknown"}`
    );
  }
}

/** /animate -- Convert a photo to video with AI. */
export async function handleAnimate(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const rawArgs = text.replace(/^\/animate\s*/i, "").trim();

  // PRIVACY MODE: Check for local file path (added 2026-02-10)
  // ROLLBACK: Remove localPathInfo block, revert to old prompt/hasReply check
  const localPathInfo = parseLocalPath(rawArgs);
  const isPrivacyMode = !!localPathInfo;
  const prompt = isPrivacyMode ? localPathInfo!.remainingText : rawArgs;

  if (!prompt) {
    await ctx.reply(
      "使い方:\n" +
      "• 写真に返信: /animate <動きの指示>\n" +
      "• パス指定:   /animate /Users/.../image.heic <動きの指示>\n" +
      "• テキストのみ: /animate <シーンの説明>\n\n" +
      "例: /animate 楽しそうに笑う\n" +
      "例: /animate /Users/daijiromatsuokam1/Downloads/photo.png セクシーに微笑む\n\n" +
      "※ パス指定時は動画をTelegramに送信しません (プライバシーモード)"
    );
    return;
  }

  const hasReply = !!ctx.message?.reply_to_message;
  const isI2V = hasReply || isPrivacyMode;
  const statusMsg = await ctx.reply(
    `🎬 動画生成中... (Wan2.2, ~3秒/81f, 長時間かかります)\n${isI2V ? "📸 Image-to-Video" : "📝 Text-to-Video"}`
  );

  try {
    // ROLLBACK: was "81" frames, 24fps → 3.4s video
    // 121 frames @8fps → 15.1s GIF-animation style (5s of motion content)
    const args = ["animate", "--prompt", prompt, "--frames", "121"];

    // PRIVACY MODE: Use local path for I2V
    if (isPrivacyMode) {
      const imagePath = resolveLocalImage(localPathInfo!.localPath);
      if (imagePath) {
        args.push("--image", imagePath);
        log.info(`[media] Privacy mode: using local file ${imagePath}`);
      } else {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          `❌ ファイルが見つかりません: ${localPathInfo!.localPath}`
        );
        return;
      }
    } else if (hasReply) {
      // ORIGINAL: If replying to a photo, download it
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

    const result = await withMediaQueue(() => runAiMedia(args, { timeout: TIMEOUT_VIDEO }));

    if (!result.ok || !result.path) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `❌ 動画生成失敗: ${result.error?.slice(-500) || "unknown error"}`
      );
      return;
    }

    // PRIVACY MODE: Text notification only + open in Preview (no video sent to Telegram)
    // ROLLBACK: Remove isPrivacyMode branch, keep only else block
    if (isPrivacyMode) {
      await sendResultPrivate(ctx, statusMsg.message_id, result.path, result.elapsed, "/animate");
    } else {
      // ORIGINAL: Send as video or animation
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
      await cleanupFile(result.path);
    }
  } catch (e: any) {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ エラー: ${e.message?.slice(0, 200) || "unknown"}`
    );
  }
}

/** /undress -- Dedicated nude generation from a replied-to photo. */
export async function handleUndress(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const rawArgs = text.replace(/^\/undress\s*/i, "").trim();

  // PRIVACY MODE: Check for local file path (added 2026-02-10)
  // ROLLBACK: Remove localPathInfo block, revert to old prompt/reply_to_message check
  const localPathInfo = parseLocalPath(rawArgs);
  const isPrivacyMode = !!localPathInfo;
  const prompt = isPrivacyMode ? localPathInfo!.remainingText : rawArgs;

  // Need either a replied photo OR a local file path
  if (!ctx.message?.reply_to_message && !isPrivacyMode) {
    await ctx.reply(
      "使い方:\n" +
      "  写真に返信: /undress [指示]\n" +
      "  パス指定:   /undress /Users/.../image.heic [指示]\n\n" +
      "例:\n" +
      "  /undress\n" +
      "  /undress 全裸にして\n" +
      "  /undress /Users/daijiromatsuokam1/Downloads/IMG_2867.HEIC Japanese breasts\n" +
      "  /undress --strength heavy\n\n" +
      "オプション:\n" +
      "  --strength light|medium|heavy\n" +
      "    light  = 控えめ (denoise 0.60)\n" +
      "    medium = 標準 (denoise 0.80) [デフォルト]\n" +
      "    heavy  = 強め (denoise 0.92)\n" +
      "  --denoise 0.8 (直接指定)\n" +
      "  --face-protect 0.5 (顔保護レベル)\n" +
      "  --no-face-mask (顔保護を無効化)\n\n" +
      "※ パス指定時は画像をTelegramに送信しません (プライバシーモード)\n" +
      "※ FLUX Dev + dpmpp_2m+karras + LoRA x3\n" +
      "※ 顔保護はデフォルト有効\n" +
      "※ ~12-18分かかります"
    );
    return;
  }

  const statusMsg = await ctx.reply("🔥 Undress処理中... (SegFormer衣服検出 + FLUX Dev + LoRA, ~12-18分)");
  const chatId = ctx.chat!.id;

  try {
    // PRIVACY MODE: Use local path OR download from Telegram
    let imagePath: string | null = null;
    let isLocalInput = false;

    if (isPrivacyMode) {
      imagePath = resolveLocalImage(localPathInfo!.localPath);
      isLocalInput = true;
      if (!imagePath) {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          `❌ ファイルが見つかりません: ${localPathInfo!.localPath}`
        );
        return;
      }
      log.info(`[media] Privacy mode: using local file ${imagePath}`);
    } else {
      imagePath = await downloadPhoto(ctx);
      if (!imagePath) {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          "❌ 写真のダウンロードに失敗しました"
        );
        return;
      }
    }

    // Debug: throttled stderr → Telegram status update
    let lastUpdate = 0;
    const UPDATE_INTERVAL = 4_000;
    const debugUpdate = (line: string) => {
      const now = Date.now();
      if (now - lastUpdate < UPDATE_INTERVAL) return;
      lastUpdate = now;
      const short = line.length > 120 ? line.slice(0, 120) + "…" : line;
      ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `🔥 Undress処理中...\n<code>${escapeHtml(short)}</code>`,
        { parse_mode: "HTML" }
      ).catch(() => {});
    };

    // Parse flags from prompt
    let cleanPrompt = prompt;
    const undressArgs = ["undress", "--image", imagePath];

    // --strength light|medium|heavy
    const strengthMatch = cleanPrompt.match(/--strength\s+(light|medium|heavy)/);
    if (strengthMatch?.[1]) {
      undressArgs.push("--strength", strengthMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--strength\s+\S+/, "").trim();
    }

    // --denoise N
    const denoiseMatch = cleanPrompt.match(/--denoise\s+([\d.]+)/);
    if (denoiseMatch?.[1]) {
      undressArgs.push("--denoise", denoiseMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--denoise\s+[\d.]+/, "").trim();
    }

    // --face-protect N
    const faceProtectMatch = cleanPrompt.match(/--face-protect\s+([\d.]+)/);
    if (faceProtectMatch?.[1]) {
      undressArgs.push("--face-protect", faceProtectMatch[1]);
      cleanPrompt = cleanPrompt.replace(/--face-protect\s+[\d.]+/, "").trim();
    }

    // --no-face-mask
    if (cleanPrompt.includes("--no-face-mask")) {
      undressArgs.push("--no-face-mask");
      cleanPrompt = cleanPrompt.replace("--no-face-mask", "").trim();
    }

    // User prompt (optional)
    if (cleanPrompt) {
      undressArgs.push("--prompt", cleanPrompt);
    }

    const result = await withMediaQueue(() => runAiMedia(
      undressArgs,
      { timeout: TIMEOUT_IMAGE, onStderr: debugUpdate }
    ));

    if (!result.ok || !result.path) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `❌ Undress失敗: ${result.error?.slice(-500) || "unknown error"}`
      );
      if (!isLocalInput) await cleanupFile(imagePath);
      return;
    }

    // GIF ANIMATION MODE: Send process visualization as animated GIF
    // Shows: input → mask → result as looping animation
    // ROLLBACK: Replace this entire block with the original code below:
    //   if (isPrivacyMode) {
    //     await sendResultPrivate(ctx, statusMsg.message_id, result.path, result.elapsed, "/undress");
    //   } else {
    //     const filename = `undress_${Date.now()}.png`;
    //     const strengthInfo = strengthMatch?.[1] ? ` [${strengthMatch[1]}]` : "";
    //     const caption = `🔥 Undress${strengthInfo}\n⏱ ${result.elapsed}秒`;
    //     await ctx.replyWithPhoto(new InputFile(result.path), { caption });
    //     await ctx.replyWithDocument(new InputFile(result.path, filename), {
    //       caption: `📎 原寸: ${filename}`,
    //       disable_content_type_detection: true,
    //     });
    //     await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
    //     cleanupFile(imagePath);
    //     cleanupFile(result.path);
    //   }
    {
      const strengthInfo = strengthMatch?.[1] ? ` [${strengthMatch[1]}]` : "";
      const inputForGif = result.input_path || imagePath;

      // Try to create process GIF animation
      const gifPath = await createProcessGif(inputForGif, result.mask_path, result.path);

      if (gifPath) {
        // Send GIF animation (shows process: input → mask → result)
        const caption = `🔥 Undress${strengthInfo}\n⏱ ${result.elapsed}秒\n📁 ${result.path}`;
        await ctx.replyWithAnimation(new InputFile(gifPath), { caption });
        await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        await cleanupFile(gifPath);
      } else {
        // Fallback: text notification only if GIF generation fails
        await sendResultPrivate(ctx, statusMsg.message_id, result.path, result.elapsed, "/undress");
      }

      // Cleanup mask file if it exists
      if (result.mask_path) await cleanupFile(result.mask_path);

      // In privacy mode: keep result file. In normal mode: cleanup.
      if (!isPrivacyMode) {
        await cleanupFile(imagePath);
        await cleanupFile(result.path);
      }
    }
  } catch (e: any) {
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `❌ エラー: ${e.message?.slice(0, 200) || "unknown"}`
    );
  }
}

// ============================================================
// Utility
// ============================================================
async function cleanupFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // ignore (file may not exist)
  }
}

/**
 * Create a GIF animation from undress process images: input → mask → result
 * Uses ffmpeg to combine images into an animated GIF.
 * ROLLBACK: Remove this function and revert /undress handler to use sendResultPrivate/replyWithPhoto
 *
 * Frame timing:
 *   Frame 1 (input):  1.5s
 *   Frame 2 (mask):   1.5s
 *   Frame 3 (result): 3.0s
 */
async function createProcessGif(
  inputPath: string,
  maskPath: string | undefined,
  resultPath: string
): Promise<string | null> {
  const gifPath = join(WORKING_DIR, `undress_process_${Date.now()}.gif`);

  try {
    // Build frame list: use mask if available, otherwise just input→result
    const frames = maskPath && existsSync(maskPath)
      ? [inputPath, maskPath, resultPath]
      : [inputPath, resultPath];

    // Frame durations in seconds (ffmpeg concat demuxer format)
    const durations = frames.length === 3
      ? [1.5, 1.5, 3.0]
      : [1.5, 3.0];

    // Create concat file for ffmpeg
    const concatPath = join(WORKING_DIR, `concat_${Date.now()}.txt`);
    let concatContent = "";
    for (let i = 0; i < frames.length; i++) {
      concatContent += `file '${frames[i]}'\n`;
      concatContent += `duration ${durations[i]}\n`;
    }
    // ffmpeg concat requires last file repeated without duration
    concatContent += `file '${frames[frames.length - 1]}'\n`;
    await writeFile(concatPath, concatContent);

    // Generate GIF with ffmpeg: resize to max 480px wide, good quality palette
    const cmd = [
      "ffmpeg", "-y",
      "-f", "concat", "-safe", "0", "-i", concatPath,
      "-vf", "scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
      "-loop", "0",
      gifPath
    ].join(" ");

    await execAsync(cmd, { timeout: 30000 });
    await cleanupFile(concatPath);

    if (existsSync(gifPath)) {
      return gifPath;
    }
    return null;
  } catch (e: any) {
    log.error(`[media] GIF generation failed: ${e.message}`);
    return null;
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
  bot.command("outpaint", handleOutpaint);
  bot.command("animate", handleAnimate);
  bot.command("undress", handleUndress);
}
