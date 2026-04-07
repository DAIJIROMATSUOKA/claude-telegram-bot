/**
 * Task Management Commands
 * /task <title> [due:YYYY-MM-DD] [p:high|mid|low] — add task
 * /tasks [category] — list open tasks
 * Callback: task:done:<id>, task:postpone:<id>
 */

import { createLogger } from "../utils/logger";
const log = createLogger("task-command");

import { Context } from 'grammy';
import { DEFAULT_GATEWAY_URL } from '../constants';
import { fetchWithTimeout } from '../utils/fetch-with-timeout';

const GATEWAY_URL = process.env.GATEWAY_URL || DEFAULT_GATEWAY_URL;

// Track last task list message per chat for cleanup
const lastTaskMsgs: Record<number, number[]> = {};

// ============================================================
// API helpers
// ============================================================

async function apiPost(path: string, body: any): Promise<any> {
  try {
    const res = await fetchWithTimeout(`${GATEWAY_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  } catch (e) {
    log.error('[TaskCommand] apiPost failed:', path, e);
    throw e;
  }
}

async function apiGet(path: string): Promise<any> {
  try {
    const res = await fetchWithTimeout(`${GATEWAY_URL}${path}`);
    return res.json();
  } catch (e) {
    log.error('[TaskCommand] apiGet failed:', path, e);
    throw e;
  }
}

/** /todo <title> -- Add a new task to the task list. */
export async function handleTaskAdd(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || '').replace(/^\/todo\s*/, '').trim();
  if (!text) {
    await ctx.reply([
      "/todo \u30bf\u30b9\u30af\u540d",
      "/todo \u30bf\u30b9\u30af\u540d due:2026-04-01",
      "/todo \u30bf\u30b9\u30af\u540d p:high",
      "",
      "\u4f8b:",
      "  /todo M1300 \u90e8\u54c1\u767a\u6ce8",
      "  /todo \u7f8e\u5c71\u898b\u7a4d\u308a due:2026-04-05",
      "  /todo \u30ad\u30fc\u30a8\u30f3\u30b9\u96fb\u8a71 p:high",
      "",
      "\u512a\u5148\u5ea6: p:high(\u8d64) p:mid(\u9ec4) p:low(\u7dd1)",
      "\u671f\u9650: due:YYYY-MM-DD\uff082\u65e5\u4ee5\u5185\u3067\u81ea\u52d5high\uff09",
      "\u4e00\u89a7: /todos",
    ].join("\n"));
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
/** /todos -- List open tasks with inline action buttons. */
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
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Delete all previous task messages
    if (lastTaskMsgs[chatId]) {
      for (const msgId of lastTaskMsgs[chatId]) {
        await ctx.api.deleteMessage(chatId, msgId).catch(() => {});
      }
    }
    lastTaskMsgs[chatId] = [];

    if (!result.ok || !result.tasks || result.tasks.length === 0) {
      const msg = header ? header + '\n' : '';
      const noTask = filter ? `\ud83d\udcad ${filter} \u306e\u30bf\u30b9\u30af\u306a\u3057` : '\ud83d\udcad \u30bf\u30b9\u30af\u306a\u3057';
      const sent = await ctx.reply(msg + noTask);
      lastTaskMsgs[chatId].push(sent.message_id);
      setTimeout(() => ctx.api.deleteMessage(chatId, sent.message_id).catch(() => {}), 5000);
      return;
    }

    // Optional header (auto-delete after 3s)
    if (header) {
      const headerMsg = await ctx.reply(header);
      setTimeout(() => ctx.api.deleteMessage(chatId, headerMsg.message_id).catch(() => {}), 3000);
    }

    // Group by category
    const groups: Record<string, any[]> = {};
    for (const t of result.tasks) {
      const cat = t.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    }

    // 1 category = 1 message with task buttons
    for (const [cat, tasks] of Object.entries(groups)) {
      const keyboard: any[][] = [];
      for (const t of tasks) {
        const priIcon = t.priority === 'high' ? '\ud83d\udd34' : t.priority === 'mid' ? '\ud83d\udfe1' : '\ud83d\udfe2';
        const due = t.due_date ? ` \u23f0${t.due_date.slice(5)}` : '';
        keyboard.push([{
          text: `\u2705 ${priIcon} ${t.title}${due}`,
          callback_data: `task:done:${t.id}:${cat}`,
        }]);
      }

      const sent = await ctx.reply(`\ud83c\udff7 ${cat}`, {
        reply_markup: { inline_keyboard: keyboard },
      });
      lastTaskMsgs[chatId].push(sent.message_id);
    }
  } catch (e: any) {
    await ctx.reply('\u274c \u30a8\u30e9\u30fc: ' + (e.message || e));
  }
}

// ============================================================
// Callback handler
// ============================================================

/** Handle inline button callbacks for task done/postpone actions. */
export async function handleTaskCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith('task:')) return false;

  const parts = data.split(':');
  if (parts.length < 3) return false;

  const action = parts[1];
  const taskId = parts[2];

  try {
    if (action === 'done') {
      await apiPost('/v1/tasks/done', { id: taskId });
      await ctx.answerCallbackQuery({ text: '\u2705 \u5b8c\u4e86!' });

      // Re-render this category: remove completed task's button
      const msg = ctx.callbackQuery?.message;
      if (msg && ctx.chat?.id) {
        const chatId = ctx.chat.id;
        const msgId = msg.message_id;
        const currentKb = (msg as any).reply_markup?.inline_keyboard || [];

        // Filter out the completed task
        const newKb = currentKb.filter((row: any[]) =>
          !row.some((btn: any) => btn.callback_data === data)
        );

        if (newKb.length === 0) {
          // No tasks left in this category -> delete the message
          await ctx.api.deleteMessage(chatId, msgId).catch(() => {});
          // Remove from tracked messages
          if (lastTaskMsgs[chatId]) {
            lastTaskMsgs[chatId] = lastTaskMsgs[chatId].filter(id => id !== msgId);
          }
        } else {
          // Update message with remaining tasks
          await ctx.api.editMessageReplyMarkup(chatId, msgId, {
            reply_markup: { inline_keyboard: newKb },
          }).catch(() => {});
        }
      }
    } else if (action === 'del') {
      await apiPost('/v1/tasks/delete', { id: taskId });
      await ctx.answerCallbackQuery({ text: '\ud83d\uddd1 \u524a\u9664' });
      await ctx.deleteMessage().catch(() => {});
    } else if (action === 'postpone') {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      await apiPost('/v1/tasks/update', { id: taskId, due_date: tomorrow });
      await ctx.answerCallbackQuery({ text: '\u23f0 \u660e\u65e5\u306b\u5ef6\u671f' });
    }
  } catch (e) {
    await ctx.answerCallbackQuery({ text: '\u274c \u30a8\u30e9\u30fc' });
  }

  return true;
}
