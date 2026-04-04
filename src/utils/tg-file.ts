/**
 * Telegram file download utility
 * Downloads files from Telegram CDN and extracts file metadata from context
 */

import { fetchWithTimeout } from './fetch-with-timeout';

const MAX_FILE_BYTES = 7 * 1024 * 1024; // 7MB (GAS JSON payload limit)
const TG_API = "https://api.telegram.org";

export interface TgFileInfo {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface TgFileData extends TgFileInfo {
  buffer: Buffer;
  publicUrl: string; // Telegram CDN URL (valid ~1h)
}

/** Get Telegram CDN path for a file_id */
export async function getTgFilePath(
  fileId: string,
  botToken: string
): Promise<{ filePath: string; fileSize: number }> {
  const res = await fetch(
    `${TG_API}/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data: any = await res.json();
  if (!data.ok) throw new Error(`getFile failed: ${data.description || JSON.stringify(data)}`);
  return {
    filePath: data.result.file_path,
    fileSize: data.result.file_size || 0,
  };
}

/** Download file from Telegram CDN into memory */
export async function downloadTgFile(
  info: TgFileInfo,
  botToken: string
): Promise<TgFileData> {
  if (info.size > MAX_FILE_BYTES) {
    const mb = (info.size / 1024 / 1024).toFixed(1);
    throw new Error(`ファイルサイズ上限(7MB)超過: ${mb}MB`);
  }

  const { filePath } = await getTgFilePath(info.fileId, botToken);
  const publicUrl = `${TG_API}/file/bot${botToken}/${filePath}`;

  const res = await fetchWithTimeout(publicUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return { ...info, buffer, publicUrl };
}

/** Extract file metadata from Grammy context (photo or document) */
export function extractFileInfo(ctx: any): TgFileInfo | null {
  const msg = ctx.message;
  if (!msg) return null;

  if (msg.document) {
    const doc = msg.document;
    return {
      fileId: doc.file_id,
      filename: doc.file_name || `file_${Date.now()}`,
      mimeType: doc.mime_type || "application/octet-stream",
      size: doc.file_size || 0,
    };
  }

  if (msg.photo && msg.photo.length > 0) {
    const photo = msg.photo[msg.photo.length - 1]; // largest size
    return {
      fileId: photo.file_id,
      filename: `photo_${Date.now()}.jpg`,
      mimeType: "image/jpeg",
      size: photo.file_size || 0,
    };
  }

  return null;
}

/** Human-readable file size */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
