/**
 * Task Management Commands
 * /task <title> [due:YYYY-MM-DD] [p:high|mid|low] — add task
 * /tasks [category] — list open tasks
 * Callback: task:done:<id>, task:postpone:<id>
 */

import { Context } from 'grammy';

const GATEWAY_URL = process.env.GATEWAY_URL || 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';

// Track last task list message per chat for cleanup
const lastTaskMsgs: Record<number, number[]> = {};

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
      const noTask = filter ? `\ud83d\udcad ${filter} \u306e\u30bf\u30b9\u30af\u306a\u3057` : '\ud83d\udcad \u30bf\u30b9\u30af\u306a\u3057';
      const sent = await ctx.reply(msg + noTask);
      // Auto-delete "no tasks" message after 5s
      setTimeout(() => ctx.api.deleteMessage(ctx.chat!.id, sent.message_id).catch(() => {}), 5000);
      return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Delete all previous task messages
    if (lastTaskMsgs[chatId]) {
      for (const msgId of lastTaskMsgs[chatId]) {
        await ctx.api.deleteMessage(chatId, msgId).catch(() => {});
      }
    }
    lastTaskMsgs[chatId] = [];

    // Optional header message
    if (header) {
      const headerMsg = await ctx.reply(header);
      lastTaskMsgs[chatId].push(headerMsg.message_id);
      setTimeout(() => ctx.api.deleteMessage(chatId, headerMsg.message_id).catch(() => {}), 3000);
    }

    // Group by category
    const groups: Record<string, any[]> = {};
    for (const t of result.tasks) {
      const cat = t.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    }

    // Send 1 message per task: button = task name, click = complete
    for (const [cat, tasks] of Object.entries(groups)) {
      // Category header as a minimal message
      const catMsg = await ctx.reply(`\ud83c\udff7 ${cat}`, { parse_mode: 'HTML' });
      lastTaskMsgs[chatId].push(catMsg.message_id);

      for (const t of tasks) {
        const priIcon = t.priority === 'high' ? '\ud83d\udd34' : t.priority === 'mid' ? '\ud83d\udfe1' : '\ud83d\udfe2';
        const due = t.due_date ? ` \u23f0${t.due_date.slice(5)}` : '';
        const btnText = `\u2705 ${priIcon} ${t.title}${due}`;

        const sent = await ctx.reply('\u200b', {  // Zero-width space as minimal body
          reply_markup: {
            inline_keyboard: [[
              { text: btnText, callback_data: `task:done:${t.id}` },
            ]],
          },
        });
        lastTaskMsgs[chatId].push(sent.message_id);
      }
    }
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
      // Just delete this task's message (no full list re-render)
      await ctx.deleteMessage().catch(() => {});
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
