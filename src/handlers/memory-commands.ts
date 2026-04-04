/**
 * Memory Commands - DJ直接制御用
 *
 * /memory          → 全メモリ概要表示
 * /memory pending  → 承認待ちメモリ表示
 * /memory approve <id> → pending承認
 * /memory reject <id>  → pending却下
 * /forget <keyword>    → メモリ削除（profile/projects/summaries/vector）
 * /remember <key> <value> → 手動メモリ登録（confidence=1.0, source=manual）
 */

import { Context } from 'grammy';
import { callMemoryGateway } from './ai-router';
import { fetchWithTimeout } from '../utils/fetch-with-timeout';
import {
  getProfile,
  getActiveProjects,
  getRecentSummaries,
  upsertProfile,
  searchMemories,
  deleteProfileKey,
  deleteProject,
  getPendingMemories,
  approvePendingMemory,
  rejectPendingMemory,
} from '../services/jarvis-memory';
import { escapeHtml } from '../formatting';
import { isAuthorized } from '../security';

const ALLOWED_USERS = (process.env.TELEGRAM_ALLOWED_USERS || '')
  .split(',')
  .map((id) => parseInt(id.trim(), 10))
  .filter(Boolean);

/** /memory -- Display all memory overview, pending items, or approve/reject. */
export async function handleMemory(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  const args = (ctx.message?.text || '').replace(/^\/memory\s*/, '').trim();

  if (args.startsWith('pending')) {
    return handleMemoryPending(ctx);
  }
  if (args.startsWith('approve ')) {
    const id = args.replace('approve ', '').trim();
    return handleMemoryApprove(ctx, id);
  }
  if (args.startsWith('reject ')) {
    const id = args.replace('reject ', '').trim();
    return handleMemoryReject(ctx, id);
  }

  // Default: show memory overview
  const [profile, projects, summaries, pending] = await Promise.all([
    getProfile(),
    getActiveProjects(),
    getRecentSummaries(5),
    getPendingMemories(),
  ]);

  // Vector stats
  let vectorCount = 0;
  try {
    const res = await fetchWithTimeout('http://127.0.0.1:19823/stats');
    const data = await res.json() as any;
    vectorCount = data?.total_embeddings || 0;
  } catch {}

  const lines: string[] = [];
  lines.push('🧠 <b>JARVIS Memory v2</b>\n');

  // Profile
  lines.push(`📋 <b>Profile</b> (${Object.keys(profile).length}件)`);
  for (const [k, v] of Object.entries(profile)) {
    lines.push(`  <code>${escapeHtml(k)}</code>: ${escapeHtml(String(v).substring(0, 60))}`);
  }

  // Projects
  lines.push(`\n📁 <b>Projects</b> (${projects.length}件)`);
  if (projects.length === 0) {
    lines.push('  なし');
  } else {
    for (const p of projects) {
      lines.push(`  <code>${escapeHtml(p.id)}</code>: ${escapeHtml(p.name)} (${p.status})`);
    }
  }

  // Stats
  lines.push(`\n📊 <b>Stats</b>`);
  lines.push(`  会話サマリ: ${summaries.length}件`);
  lines.push(`  ベクトル: ${vectorCount}件`);
  lines.push(`  承認待ち: ${pending.length}件`);

  if (pending.length > 0) {
    lines.push(`\n⏳ /memory pending で確認`);
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
}

async function handleMemoryPending(ctx: Context): Promise<void> {
  const pending = await getPendingMemories();

  if (pending.length === 0) {
    await ctx.reply('✅ 承認待ちメモリなし');
    return;
  }

  const lines: string[] = ['⏳ <b>承認待ちメモリ</b>\n'];
  for (const p of pending) {
    lines.push(
      `<b>${escapeHtml(p.id)}</b>` +
      `\n  type: ${p.type} | key: <code>${escapeHtml(p.key)}</code>` +
      `\n  value: ${escapeHtml(String(p.value).substring(0, 100))}` +
      `\n  confidence: ${p.confidence} | ${p.created_at}` +
      `\n  → /memory approve ${p.id}` +
      `\n  → /memory reject ${p.id}\n`
    );
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
}

async function handleMemoryApprove(ctx: Context, id: string): Promise<void> {
  const ok = await approvePendingMemory(id);
  if (ok) {
    await ctx.reply(`✅ 承認: ${id}`);
  } else {
    await ctx.reply(`❌ 見つからない: ${id}`);
  }
}

async function handleMemoryReject(ctx: Context, id: string): Promise<void> {
  const ok = await rejectPendingMemory(id);
  if (ok) {
    await ctx.reply(`🗑️ 却下: ${id}`);
  } else {
    await ctx.reply(`❌ 見つからない: ${id}`);
  }
}

/** /forget <keyword> -- Delete matching memory entries. */
export async function handleForget(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  const keyword = (ctx.message?.text || '').replace(/^\/forget\s*/, '').trim();
  if (!keyword) {
    await ctx.reply('使い方: /forget キーワード\n例: /forget 半導体  /forget itoham_labeler');
    return;
  }

  const results: string[] = [];

  // 1. Profile: exact key match or value contains
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT key, value FROM jarvis_user_profile WHERE key LIKE ? OR value LIKE ?`,
      params: [`%${keyword}%`, `%${keyword}%`],
    });
    const rows = (res as any)?.data?.results || [];
    for (const r of rows) {
      await deleteProfileKey(r.key);
      results.push(`Profile: ${r.key} (${r.value.substring(0, 40)})`);
    }
  } catch (e) {
    console.error('[Memory Forget] Profile search failed:', e);
  }

  // 2. Projects: id or name match
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT id, name FROM jarvis_projects WHERE id LIKE ? OR name LIKE ?`,
      params: [`%${keyword}%`, `%${keyword}%`],
    });
    const rows = (res as any)?.data?.results || [];
    for (const r of rows) {
      await deleteProject(r.id);
      results.push(`Project: ${r.id} (${r.name})`);
    }
  } catch (e) {
    console.error('[Memory Forget] Project search failed:', e);
  }

  // 3. Summaries: keyword match
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `SELECT id, summary FROM jarvis_conversation_summaries WHERE summary LIKE ? OR topics_json LIKE ?`,
      params: [`%${keyword}%`, `%${keyword}%`],
    });
    const rows = (res as any)?.data?.results || [];
    for (const r of rows) {
      await callMemoryGateway('/v1/db/query', 'POST', {
        sql: 'DELETE FROM jarvis_conversation_summaries WHERE id = ?',
        params: [r.id],
      });
      results.push(`Summary: ${r.summary.substring(0, 50)}`);
    }
  } catch (e) {
    console.error('[Memory Forget] Summary search failed:', e);
  }

  // 4. Vector: semantic search + delete
  try {
    const vectorResults = await searchMemories(keyword, 5);
    const kwLower = keyword.toLowerCase();
    const highMatches = vectorResults.filter(r => r.score > 0.85 || (r.score > 0.6 && r.text.toLowerCase().includes(kwLower)));
    for (const r of highMatches) {
      try {
        await fetch('http://127.0.0.1:19823/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_id: r.source_id }),
        });
        results.push(`Vector: ${r.text.substring(0, 50)} (score=${r.score.toFixed(2)})`);
      } catch {}
    }
  } catch (e) {
    console.error('[Memory Forget] Vector search failed:', e);
  }

  // 5. Pending memories
  try {
    const res = await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `DELETE FROM jarvis_pending_memory WHERE key LIKE ? OR value LIKE ?`,
      params: [`%${keyword}%`, `%${keyword}%`],
    });
    const changes = (res as any)?.data?.meta?.changes || 0;
    if (changes > 0) results.push(`Pending: ${changes}件`);
  } catch {}

  if (results.length === 0) {
    await ctx.reply(`🔍 「${keyword}」に一致するメモリなし`);
  } else {
    const msg = `🗑️ 削除完了 (${results.length}件):\n` + results.map(r => `  ・${r}`).join('\n');
    await ctx.reply(msg);
  }
}

/** /remember <key> <value> -- Manually store a memory entry. */
export async function handleRemember(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  const text = (ctx.message?.text || '').replace(/^\/remember\s*/, '').trim();
  if (!text) {
    await ctx.reply('使い方: /remember key value\n例: /remember client_primaham プリマハム（主要顧客）');
    return;
  }

  const spaceIdx = text.indexOf(' ');
  if (spaceIdx === -1) {
    await ctx.reply('❌ key と value をスペースで区切って');
    return;
  }

  const key = text.substring(0, spaceIdx).trim();
  const value = text.substring(spaceIdx + 1).trim();

  // Determine category from key pattern
  let category = 'general';
  if (/identity|name|location/.test(key)) category = 'identity';
  else if (/work|client|project|domain/.test(key)) category = 'work';
  else if (/tech|hardware|software/.test(key)) category = 'tech';
  else if (/rule|cost|constraint/.test(key)) category = 'rules';
  else if (/style|prefer|philosophy/.test(key)) category = 'preferences';

  await upsertProfile(key, value, category, 1.0, 'manual');
  await ctx.reply(`✅ 記憶: <code>${escapeHtml(key)}</code> = ${escapeHtml(value)}`, { parse_mode: 'HTML' });
}
