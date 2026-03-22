/**
 * Task Management Commands
 * /task <title> [due:YYYY-MM-DD] [p:high|mid|low] — add task
 * /tasks [category] — list open tasks
 * Callback: task:done:<id>, task:postpone:<id>
 */

import { Context } from 'grammy';

const GATEWAY_URL = process.env.GATEWAY_URL || 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';

// ============================================================
// API helpers
// ============================================================

async function apiPost(path: string, body: any): Promise<any> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${GATEWAY_URL}${path}`);
  return res.json();
}

// ============================================================
// /task — add a new task
// ============================================================

export async function handleTaskAdd(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || '').replace(/^\/todo\s*/, '').trim();
  if (!text) {
    await ctx.reply('使い方: /task タスク名 [due:2026-03-25] [p:high]');
    return;
  }

  // Parse optional flags
  let title = text;
  let dueDate: string | undefined;
  let priority: string | undefined;

  const dueMatch = title.match(/\bdue:(\d{4}-\d{2}-\d{2})\b/);
  if (dueMatch) {
    dueDate = dueMatch[1];
    title = title.replace(dueMatch[0], '').trim();
  }

  const priMatch = title.match(/\bp:(high|mid|low)\b/);
  if (priMatch) {
    priority = priMatch[1];
    title = title.replace(priMatch[0], '').trim();
  }

  try {
    const result: any = await apiPost('/v1/tasks/add', {
      title,
      due_date: dueDate,
      priority,
      source: 'telegram',
    });

    // Delete DJ's command message
    await ctx.deleteMessage().catch(() => {});

    if (!result.ok) {
      await ctx.reply('\u274c タスク追加失敗: ' + (result.error || 'unknown'));
      return;
    }

    // Show full task list after adding
    await showTaskList(ctx, null, `\u2705 追加: ${title}`);
  } catch (e: any) {
    await ctx.reply('\u274c エラー: ' + (e.message || e));
  }
}

// ============================================================
// /tasks — list open tasks
// ============================================================

export async function handleTaskList(ctx: Context): Promise<void> {
  const filter = (ctx.message?.text || '').replace(/^\/todos\s*/, '').trim();

  // Delete DJ's command message
  await ctx.deleteMessage().catch(() => {});

  await showTaskList(ctx, filter || null);
}

// ============================================================

// ============================================================
// Shared task list renderer
// ============================================================

async function showTaskList(ctx: Context, filter: string | null, header?: string): Promise<void> {
  try {
    let url = '/v1/tasks/list?status=open&limit=30';
    if (filter) url += '&category=' + encodeURIComponent(filter);

    const result: any = await apiGet(url);
    if (!result.ok || !result.tasks || result.tasks.length === 0) {
      const msg = header ? header + '\n' : '';
      await ctx.reply(msg + (filter ? `\ud83d\udcad ${filter} \u306e\u30bf\u30b9\u30af\u306a\u3057` : '\ud83d\udcad \u30bf\u30b9\u30af\u306a\u3057'));
      return;
    }

    const groups: Record<string, any[]> = {};
    for (const t of result.tasks) {
      const cat = t.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    }

    const lines: string[] = [];
    if (header) lines.push(header);
    lines.push(`\ud83d\udcdd <b>\u30bf\u30b9\u30af ${result.count}\u4ef6</b>`);

    for (const [cat, tasks] of Object.entries(groups)) {
      lines.push('');
      lines.push(`<b>\ud83c\udff7 ${cat}</b>`);
      for (const t of tasks) {
        const priIcon = t.priority === 'high' ? '\ud83d\udd34' : t.priority === 'mid' ? '\ud83d\udfe1' : '\ud83d\udfe2';
        const due = t.due_date ? ' \u23f0' + t.due_date.slice(5) : '';
        const idx = result.tasks.indexOf(t) + 1;
        lines.push(`${idx}. ${priIcon} ${t.title}${due}`);
      }
    }

    const buttons = result.tasks.slice(0, 8).map((t: any, i: number) => ({
      text: `\u2705${i + 1}`,
      callback_data: `task:done:${t.id}`,
    }));

    const keyboard: any[][] = [];
    for (let i = 0; i < buttons.length; i += 4) {
      keyboard.push(buttons.slice(i, i + 4));
    }

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (e: any) {
    await ctx.reply('\u274c \u30a8\u30e9\u30fc: ' + (e.message || e));
  }
}

// Callback handler
// ============================================================

export async function handleTaskCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith('task:')) return false;

  const parts = data.split(':');
  if (parts.length < 3) return false;

  const [, action, taskId] = parts;

  try {
    if (action === 'done') {
      await apiPost('/v1/tasks/done', { id: taskId });
      await ctx.answerCallbackQuery({ text: '\u2705 \u5b8c\u4e86!' });
      // Delete old list and show updated list
      await ctx.deleteMessage().catch(() => {});
      await showTaskList(ctx, null);
    } else if (action === 'del') {
      await apiPost('/v1/tasks/delete', { id: taskId });
      await ctx.answerCallbackQuery({ text: '\ud83d\uddd1 \u524a\u9664' });
      await ctx.deleteMessage().catch(() => {});
      await showTaskList(ctx, null);
    } else if (action === 'postpone') {
      // Postpone by 1 day
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      await apiPost('/v1/tasks/update', { id: taskId, due_date: tomorrow });
      await ctx.answerCallbackQuery({ text: '\u23f0 \u660e\u65e5\u306b\u5ef6\u671f' });
    }
  } catch (e) {
    await ctx.answerCallbackQuery({ text: '\u274c \u30a8\u30e9\u30fc' });
  }

  return true;
}
