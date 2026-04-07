/**
 * Dropbox File Upload + Share Link Generator
 */

import { createLogger } from "../utils/logger";
const log = createLogger("dropbox-share");

import { fetchWithTimeout } from '../utils/fetch-with-timeout';

const DROPBOX_TOKEN = process.env.DROPBOX_ACCESS_TOKEN || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const DROPBOX_FOLDER = '/JARVIS-Share';

export async function uploadAndShare(
  telegramFileId: string,
  filename: string
): Promise<{ url: string; path: string } | null> {
  if (!DROPBOX_TOKEN) {
    log.error('[Dropbox] No DROPBOX_ACCESS_TOKEN');
    return null;
  }
  try {
    const tgRes = await fetchWithTimeout(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${telegramFileId}`
    );
    const tgData: any = await tgRes.json();
    if (!tgData.ok) throw new Error('Telegram getFile failed');

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tgData.result.file_path}`;
    const fileRes = await fetchWithTimeout(fileUrl);
    if (!fileRes.ok) throw new Error(`Download failed: ${fileRes.status}`);
    const fileBuffer = await fileRes.arrayBuffer();

    const dbxPath = `${DROPBOX_FOLDER}/${Date.now()}_${filename}`;
    const uploadRes = await fetchWithTimeout('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DROPBOX_TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path: dbxPath, mode: 'add', autorename: true }),
      },
      body: fileBuffer,
    });
    if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`);

    const shareRes = await fetchWithTimeout(
      'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${DROPBOX_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: dbxPath,
          settings: { requested_visibility: 'public', audience: 'public' },
        }),
      }
    );

    let shareUrl: string;
    if (shareRes.ok) {
      shareUrl = ((await shareRes.json()) as any).url.replace('dl=0', 'dl=1');
    } else {
      const errData: any = await shareRes.json();
      if (errData?.error?.shared_link_already_exists) {
        shareUrl = errData.error.shared_link_already_exists.metadata.url.replace('dl=0', 'dl=1');
      } else {
        throw new Error(`Share link failed: ${JSON.stringify(errData)}`);
      }
    }

    log.info(`[Dropbox] Uploaded: ${dbxPath}`);
    return { url: shareUrl, path: dbxPath };
  } catch (error) {
    log.error('[Dropbox] Error:', error);
    return null;
  }
}
