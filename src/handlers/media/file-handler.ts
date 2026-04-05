/**
 * file-handler.ts
 * ===============
 * File download/upload utilities for media commands.
 *
 * - downloadPhoto: Download a photo from a Telegram message to a local temp file.
 * - cleanupFile: Delete a temp file after use.
 * - formatFileSize: Human-readable file size string.
 */

import { Context } from "grammy";
import { existsSync, mkdirSync } from "fs";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { MEDIA_WORKING_DIR as WORKING_DIR } from "../../constants";
import { fetchWithTimeout } from "../../utils/fetch-with-timeout";

// Ensure working directory exists
if (!existsSync(WORKING_DIR)) {
  mkdirSync(WORKING_DIR, { recursive: true });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function downloadPhoto(ctx: Context): Promise<string | null> {
  try {
    const msg = ctx.message?.reply_to_message;
    if (!msg) return null;

    let fileId: string | undefined;

    if (msg.photo && msg.photo.length > 0) {
      fileId = msg.photo[msg.photo.length - 1]!.file_id;
    } else if (msg.document) {
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

    const url = `https://api.telegram.org/file/bot${ctx.api.token}/${filePath}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;

    const ext = (filePath.split(".").pop() || "jpg").toLowerCase();
    const localPath = join(WORKING_DIR, `input_${Date.now()}.${ext}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(localPath, buffer);

    // Convert HEIC/HEIF to JPEG using macOS sips
    if (ext === "heic" || ext === "heif") {
      const jpegPath = localPath.replace(/\.[^.]+$/, ".jpg");
      try {
        const proc = Bun.spawnSync(["sips", "-s", "format", "jpeg", localPath, "--out", jpegPath]);
        if (proc.exitCode === 0 && existsSync(jpegPath)) {
          try { await unlink(localPath); } catch {}
          console.log(`[media] Converted HEIC → JPEG: ${jpegPath}`);
          return jpegPath;
        }
      } catch (e) {
        console.error("[media] HEIC conversion failed, using original:", e);
      }
    }

    return localPath;
  } catch (e) {
    console.error("[media] Photo download error:", e);
    return null;
  }
}

export async function cleanupFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // ignore (file may not exist)
  }
}
