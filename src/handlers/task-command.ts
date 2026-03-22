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

    if (!result.ok) {
      await ctx.reply('\u274c タスク追加失敗: ' + (result.error || 'unknown'));
      return;
    }

    const priIcon = result.priority === 'high' ? '\ud83d\udd34' : result.priority === 'mid' ? '\ud83d\udfe1' : '\ud83d\udfe2';
    const dueStr = dueDate ? ' \ud83d\udcc5' + dueDate : '';
    await ctx.reply(
      `\u2705 ${priIcon} ${title}\n\ud83c\udff7 ${result.category}${dueStr}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '\u2705\u5b8c\u4e86', callback_data: `task:done:${result.id}` },
            { text: '\u274c\u524a\u9664', callback_data: `task:del:${result.id}` },
          ]],
        },
      }
    );
  } catch (e: any) {
    await ctx.reply('\u274c エラー: ' + (e.message || e));
  }
}

// ============================================================
// /tasks — list open tasks
// ============================================================

export async function handleTaskList(ctx: Context): Promise<void> {
  const filter = (ctx.message?.text || '').replace(/^\/todos\s*/, '').trim();

  try {
    let url = '/v1/tasks/list?status=open&limit=30';
    if (filter) url += '&category=' + encodeURIComponent(filter);

    const result: any = await apiGet(url);
    if (!result.ok || !result.tasks || result.tasks.length === 0) {
      await ctx.reply(filter ? `\ud83d\udcad ${filter} のタスクなし` : '\ud83d\udcad タスクなし');
      return;
    }

    // Group by category
    const groups: Record<string, any[]> = {};
    for (const t of result.tasks) {
      const cat = t.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    }

    const lines: string[] = [`\ud83d\udcdd <b>タスク ${result.count}件</b>`];

    for (const [cat, tasks] of Object.entries(groups)) {
      lines.push('');
      lines.push(`<b>\ud83c\udff7 ${cat}</b>`);
      for (const t of tasks) {
        const priIcon = t.priority === 'high' ? '\ud83d\udd34' : t.priority === 'mid' ? '\ud83d\udfe1' : '\ud83d\udfe2';
        const due = t.due_date ? ' \u23f0' + t.due_date.slice(5) : '';
        lines.push(`${priIcon} ${t.title}${due}`);
      }
    }

    // Build inline keyboard: done buttons for first 5 tasks
    const buttons = result.tasks.slice(0, 8).map((t: any, i: number) => ({
      text: `\u2705${i + 1}`,
      callback_data: `task:done:${t.id}`,
    }));

    // Split buttons into rows of 4
    const keyboard: any[][] = [];
    for (let i = 0; i < buttons.length; i += 4) {
      keyboard.push(buttons.slice(i, i + 4));
    }

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (e: any) {
    await ctx.reply('\u274c エラー: ' + (e.message || e));
  }
}

// ============================================================
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
      // Edit message to show strikethrough
      const msg = ctx.callbackQuery?.message;
      if (msg && 'text' in msg) {
        const newText = '\u2705 <s>' + (msg.text || '').split('\n')[0] + '</s>\n<i>\u5b8c\u4e86</i>';
        await ctx.editMessageText(newText, { parse_mode: 'HTML' }).catch(() => {});
      }
    } else if (action === 'del') {
      await apiPost('/v1/tasks/delete', { id: taskId });
      await ctx.answerCallbackQuery({ text: '\ud83d\uddd1 \u524a\u9664' });
      await ctx.deleteMessage().catch(() => {});
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
