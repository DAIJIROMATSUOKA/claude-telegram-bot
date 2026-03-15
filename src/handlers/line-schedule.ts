/**
 * /line_schedule - Schedule LINE messages with file attachments
 * 画像/動画: LINE直接送信, ZIP/PDF等: Dropbox共有リンク
 */

import type { Context } from 'grammy';
import { getPendingAttach, clearPendingAttach } from '../utils/attach-pending';
import { parseJapaneseTime, formatJST } from '../utils/time-parser';
import { uploadAndShare } from '../services/dropbox-share';

const GATEWAY_URL =
  process.env.GATEWAY_URL ||
  'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';

interface LineTarget {
  source_id: string;
  name: string;
  is_group: boolean;
}

async function getLineTargets(): Promise<LineTarget[]> {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `SELECT source_id,
                COALESCE(
                  NULLIF(json_extract(source_detail, '$.group_name'), 'DM'),
                  json_extract(source_detail, '$.sender_name'),
                  source_id
                ) as name,
                json_extract(source_detail, '$.is_group') as is_group,
                MAX(created_at) as last_msg
              FROM message_mappings
              WHERE source='line'
              GROUP BY source_id
              ORDER BY json_extract(source_detail, '$.is_group') DESC, last_msg DESC
              LIMIT 30`,
      }),
    });
    const data: any = await res.json();
    return (data.results || []).map((r: any) => ({
      source_id: r.source_id,
      name: r.is_group ? (r.name || r.source_id) : (r.name && r.name !== 'DM' ? r.name : r.source_id),
      is_group: !!r.is_group,
    }));
  } catch { return []; }
}

const MEDIA_TYPES = ['image/'];  // 動画は未対応→Dropbox
function isDirectMedia(mimeType: string): boolean {
  return MEDIA_TYPES.some(t => mimeType.startsWith(t));
}

export async function handleLineSchedule(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id!;
  const raw = (ctx.message?.text || '').replace(/^\/line_?schedule\s*/i, '').trim();

  // Sub-commands: list, cancel
  if (raw === 'list' || raw === '一覧') {
    const data: any = await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `SELECT id, target_name, message, file_type, file_name, scheduled_at FROM line_scheduled WHERE status = 'pending' ORDER BY scheduled_at ASC LIMIT 20`,
      }),
    }).then(r => r.json());
    const tasks = data.results || [];
    if (tasks.length === 0) {
      await ctx.reply('📋 予約なし');
      return;
    }
    const lines = tasks.map((t: any, i: number) => {
      const time = formatJST(new Date(t.scheduled_at));
      const media = t.file_type ? ` 📎${t.file_type}` : '';
      const msg = (t.message || '').substring(0, 40);
      return `${i + 1}. ⏰${time} → ${t.target_name}${media}\n   ${msg}`;
    });
    await ctx.reply(`📋 予約一覧 (${tasks.length}件)\n\n${lines.join('\n')}\n\n取消: <code>/lineschedule cancel 番号</code>`, { parse_mode: 'HTML' });
    return;
  }

  const cancelMatch = raw.match(/^cancel\s+(\d+)$/i);
  if (cancelMatch) {
    const cancelIdx = parseInt(cancelMatch[1]!) - 1;
    const data: any = await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `SELECT id, target_name, scheduled_at FROM line_scheduled WHERE status = 'pending' ORDER BY scheduled_at ASC LIMIT 20`,
      }),
    }).then(r => r.json());
    const tasks = data.results || [];
    if (cancelIdx < 0 || cancelIdx >= tasks.length) {
      await ctx.reply(`❌ 番号が範囲外です (1-${tasks.length})`);
      return;
    }
    const task = tasks[cancelIdx];
    await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `UPDATE line_scheduled SET status = 'cancelled' WHERE id = ?`,
        params: [task.id],
      }),
    });
    const time = formatJST(new Date(task.scheduled_at));
    await ctx.reply(`🗑️ 予約取消
  → ${task.target_name}
  ⏰ ${time}`);
    return;
  }

  if (!raw) {
    const groups = await getLineTargets();
    const list = groups.length > 0
      ? groups.map((g, i) => `${i + 1}. ${g.is_group ? '👥' : '👤'} ${g.name}`).join('\n')
      : '(グループなし)';
    await ctx.reply(
      `📅 LINE予約送信\n\n使い方:\n<code>/line_schedule 明日8時 番号 メッセージ</code>\n\n📎 ファイル: 先に送信 → コマンド\n  画像/動画 → LINE直接送信\n  ZIP/PDF等 → Dropboxリンク\n\nグループ一覧:\n${list}`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const words = raw.split(/\s+/);
  let scheduledAt: Date | null = null;
  let restIdx = 0;

  for (let i = 1; i <= Math.min(words.length, 4); i++) {
    const candidate = words.slice(0, i).join(' ');
    const parsed = parseJapaneseTime(candidate);
    if (parsed) {
      if (scheduledAt && parsed.getTime() === scheduledAt.getTime()) break;
      scheduledAt = parsed;
      restIdx = i;
    }
  }

  if (!scheduledAt) {
    await ctx.reply('❌ 時刻を認識できません。\n例: <code>明日8時</code> <code>3/15 9時半</code>', { parse_mode: 'HTML' });
    return;
  }

  const rest = words.slice(restIdx);
  if (rest.length < 1) {
    await ctx.reply('❌ グループ番号/名前とメッセージを指定してください。');
    return;
  }

  const groups = await getLineTargets();
  let target: LineTarget | undefined;
  const groupWord = rest[0]!;
  const num = parseInt(groupWord);

  if (!isNaN(num) && num >= 1 && num <= groups.length) {
    target = groups[num - 1];
  } else {
    target = groups.find(g =>
      g.name?.toLowerCase().includes(groupWord.toLowerCase()) ||
      g.source_id === groupWord
    );
  }

  if (!target) {
    await ctx.reply(`❌ グループ ${groupWord} が見つかりません。`);
    return;
  }

  const message = rest.slice(1).join(' ');
  const pendingFile = userId ? getPendingAttach(userId) : null;

  if (!message && !pendingFile) {
    await ctx.reply('❌ メッセージまたはファイルが必要です。');
    return;
  }

  // File handling
  let fileId: string | null = null;
  let fileType: string | null = null;
  let fileName: string | null = null;
  let dropboxUrl: string | null = null;

  if (pendingFile && userId) {
    if (isDirectMedia(pendingFile.mimeType)) {
      // 画像/動画: file_idをD1に保存、送信時にLINE直接送信
      fileId = pendingFile.fileId;
      fileType = pendingFile.mimeType.startsWith('image/') ? 'image' : 'video';
      fileName = pendingFile.filename;
      clearPendingAttach(userId);
    } else {
      // ZIP/PDF等: Dropboxアップロード
      const statusMsg = await ctx.reply('📤 Dropboxにアップロード中...');
      const result = await uploadAndShare(pendingFile.fileId, pendingFile.filename);
      try { await ctx.api.deleteMessage(chatId, statusMsg.message_id); } catch {}

      if (result) {
        dropboxUrl = result.url;
        fileName = pendingFile.filename;
        clearPendingAttach(userId);
      } else {
        await ctx.reply('❌ Dropboxアップロード失敗。');
        return;
      }
    }
  }

  // Build message
  let finalMessage = message || '';
  if (dropboxUrl) {
    const linkLine = `\n📎 ${fileName}: ${dropboxUrl}`;
    finalMessage = finalMessage ? finalMessage + linkLine : linkLine.trim();
  }

  if (!finalMessage && !fileId) {
    await ctx.reply('❌ メッセージまたはファイルが必要です。');
    return;
  }

  // Store in D1
  const taskId = `ls_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `INSERT INTO line_scheduled (id, target_id, target_name, is_group, message, dropbox_url, file_id, file_type, file_name, scheduled_at, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
        params: [
          taskId,
          target.source_id,
          target.name,
          target.is_group ? 1 : 0,
          finalMessage || null,
          dropboxUrl || null,
          fileId || null,
          fileType || null,
          fileName || null,
          scheduledAt.toISOString(),
        ],
      }),
    });
  } catch (e) {
    await ctx.reply(`❌ スケジュール保存失敗: ${e}`);
    return;
  }

  const timeLabel = formatJST(scheduledAt);
  const mediaLabel = fileId ? (fileType === 'image' ? '🖼️ 画像(直接送信)' : '🎬 動画(直接送信)') : null;
  const parts = [
    '📅 LINE予約完了',
    `  📤 ${target.name}`,
    `  ⏰ ${timeLabel}`,
    finalMessage ? `  💬 ${finalMessage.substring(0, 100)}` : null,
    mediaLabel ? `  ${mediaLabel}: ${fileName}` : null,
    dropboxUrl && fileName ? `  📎 ${fileName}` : null,
  ].filter(Boolean).join('\n');

  await ctx.reply(parts);
}
