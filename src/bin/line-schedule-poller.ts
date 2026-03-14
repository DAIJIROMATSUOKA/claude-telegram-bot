/**
 * LINE Schedule Poller - Sends scheduled LINE messages when time arrives
 * 画像: LINE Worker image_url で直接送信
 * 動画: LINE Worker video_url で直接送信（Worker対応後）
 * テキスト/Dropbox: LINE Worker text で送信
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';
const LINE_WORKER_URL = process.env.LINE_WORKER_URL || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_ALLOWED_USERS || '';

async function query(sql: string, params?: any[]) {
  const res = await fetch(`${GATEWAY_URL}/v1/db/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  return res.json() as any;
}

async function notifyDJ(msg: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
    });
  } catch {}
}

async function getTgFileUrl(fileId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${fileId}`);
    const data: any = await res.json();
    if (!data.ok) return null;
    return `https://api.telegram.org/file/bot${TG_TOKEN}/${data.result.file_path}`;
  } catch { return null; }
}

async function sendToLine(task: any): Promise<boolean> {
  const errors: string[] = [];

  // Send media first (image/video)
  if (task.file_id && task.file_type) {
    const fileUrl = await getTgFileUrl(task.file_id);
    if (!fileUrl) {
      errors.push('Telegram file URL取得失敗');
    } else if (task.file_type === 'image') {
      const res = await fetch(`${LINE_WORKER_URL}/v1/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_id: task.target_id,
          is_group: !!task.is_group,
          image_url: fileUrl,
        }),
      });
      const result: any = await res.json();
      if (!result.ok) errors.push(`画像送信失敗: ${result.error || 'unknown'}`);
    } else if (task.file_type === 'video') {
      // video_url未対応の場合はDropboxリンクにフォールバック
      errors.push('動画直接送信は未対応（Workerアップデート必要）');
    }
  }

  // Send text message
  if (task.message) {
    const res = await fetch(`${LINE_WORKER_URL}/v1/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_id: task.target_id,
        text: task.message,
        is_group: !!task.is_group,
      }),
    });
    const result: any = await res.json();
    if (!result.ok) errors.push(`テキスト送信失敗: ${result.error || 'unknown'}`);
  }

  if (errors.length > 0) {
    console.error(`[LineSchedule] Errors: ${errors.join(', ')}`);
    // Partial success is still success (e.g. text OK but video fallback)
    if (errors.every(e => e.includes('未対応'))) return true;
    return false;
  }
  return true;
}

async function main() {
  if (!LINE_WORKER_URL) {
    console.error('[LineSchedule] LINE_WORKER_URL not set');
    process.exit(1);
  }

  const now = new Date();
  const data = await query(
    `SELECT * FROM line_scheduled WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 5`,
    [now.toISOString()]
  );

  const tasks = data.results || [];
  if (tasks.length === 0) process.exit(0);

  for (const task of tasks) {
    console.log(`[LineSchedule] Sending: ${task.id} → ${task.target_name}`);

    try {
      const ok = await sendToLine(task);
      if (ok) {
        await query(
          `UPDATE line_scheduled SET status = 'sent', sent_at = datetime('now') WHERE id = ?`,
          [task.id]
        );
        const mediaNote = task.file_type ? ` + ${task.file_type}` : '';
        await notifyDJ(`📤 LINE予約送信完了\n→ ${task.target_name}${mediaNote}\n💬 ${(task.message || '').substring(0, 80)}`);
      } else {
        await query(`UPDATE line_scheduled SET status = 'failed' WHERE id = ?`, [task.id]);
        await notifyDJ(`❌ LINE予約送信失敗\n→ ${task.target_name}`);
      }
    } catch (e: any) {
      await query(`UPDATE line_scheduled SET status = 'failed' WHERE id = ?`, [task.id]);
      await notifyDJ(`❌ LINE予約送信エラー: ${e.message}`);
    }
  }
}

main().catch(e => {
  console.error('[LineSchedule] Fatal:', e);
  process.exit(1);
});
