/**
 * /nightshift コマンド — DJ就寝中にタスクリストを自律実行する夜間バッチモード
 *
 * 仕様:
 *   ① タスクリスト（配列）を受け取り、Claude Agent SDKで順番に実行
 *   ② 各タスク完了後にcroppy承認（GO/STOP二値判定）で自動続行/中断
 *   ③ 全タスク完了 or STOP時にTelegram通知で結果サマリー送信
 *   ④ 安全装置: 最大4時間、連続エラー3回で停止、不可逆操作は実行しない
 *
 * 使い方:
 *   /nightshift
 *   1. 型エラーを修正
 *   2. テストを実行して全パス確認
 *   3. 未使用ファイルを特定して報告
 */

import type { Context } from "grammy";
import type { Api } from "grammy";
import { session } from "../session";
import { TELEGRAM_TOKEN } from "../config";
import { isAutoApprovalEnabled } from "./croppy-commands";
import { setWorkState, updateWorkProgress, clearWorkState } from "../utils/work-state";
import type { WorkTask } from "../utils/work-state";

// Bot API reference (set during command handling to avoid creating new Bot instances)
let botApi: Api | null = null;

// ============== Constants ==============

const MAX_DURATION_MS = 4 * 60 * 60 * 1000; // 4時間
const MAX_CONSECUTIVE_ERRORS = 3;
const TASK_TIMEOUT_MS = 15 * 60 * 1000; // 1タスクあたり15分
const BLOCKED_KEYWORDS = [
  "git push",
  "force push",
  "push --force",
  "rm -rf",
  "drop table",
  "delete from",
  "npm publish",
  "deploy",
];

// ============== State ==============

interface NightshiftState {
  isRunning: boolean;
  startTime: number;
  tasks: NightshiftTask[];
  currentTaskIndex: number;
  consecutiveErrors: number;
  chatId: number;
  results: TaskResult[];
  abortRequested: boolean;
}

interface NightshiftTask {
  index: number;
  description: string;
}

interface TaskResult {
  index: number;
  description: string;
  status: "completed" | "failed" | "skipped" | "stopped";
  duration_ms: number;
  summary: string;
  error?: string;
}

// Singleton state
let nightshiftState: NightshiftState | null = null;

// ============== Public API ==============

/**
 * 現在nightshiftが実行中かどうか
 */
export function isNightshiftRunning(): boolean {
  return nightshiftState?.isRunning === true;
}

/**
 * nightshiftを中断リクエスト
 */
export function requestNightshiftAbort(): void {
  if (nightshiftState) {
    nightshiftState.abortRequested = true;
    console.log("[Nightshift] Abort requested");
  }
}

/**
 * /nightshift コマンドハンドラ
 */
export async function handleNightshift(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  const username = ctx.from?.username || "DJ";

  if (!chatId || !userId) return;

  // Bot API reference を保持（バックグラウンド処理で使用）
  botApi = ctx.api;

  const messageText = ctx.message?.text || "";

  // サブコマンド判定
  const firstLine = messageText.split("\n")[0]?.trim() || "";
  const subcommand = firstLine.replace(/^\/nightshift\s*/i, "").trim().toLowerCase();

  if (subcommand === "stop" || subcommand === "abort") {
    return handleNightshiftStop(ctx);
  }

  if (subcommand === "status") {
    return handleNightshiftStatus(ctx);
  }

  // 実行中チェック
  if (nightshiftState?.isRunning) {
    await ctx.reply(
      "⚠️ Nightshiftは既に実行中です。\n" +
      `/nightshift stop で中断できます。\n` +
      `/nightshift status で進捗確認できます。`
    );
    return;
  }

  // タスクリスト解析
  const tasks = parseTaskList(messageText);

  if (tasks.length === 0) {
    await ctx.reply(
      "📋 <b>/nightshift — 夜間バッチモード</b>\n\n" +
      "使い方:\n" +
      "<code>/nightshift\n" +
      "1. 型エラーを修正\n" +
      "2. テストを実行\n" +
      "3. 未使用コードを削除</code>\n\n" +
      "サブコマンド:\n" +
      "• <code>/nightshift stop</code> — 実行中のnightshiftを中断\n" +
      "• <code>/nightshift status</code> — 進捗確認\n\n" +
      "安全装置:\n" +
      "• 最大実行時間: 4時間\n" +
      "• 連続エラー3回で自動停止\n" +
      "• 不可逆操作（git push等）は実行しない\n" +
      "• croppy承認STOPで中断→DJ通知",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Croppy有効チェック
  const croppyEnabled = await isAutoApprovalEnabled();

  // 開始通知
  const taskListStr = tasks.map(t => `  ${t.index}. ${t.description}`).join("\n");
  await ctx.reply(
    `🌙 <b>Nightshift開始</b>\n\n` +
    `📋 タスクリスト (${tasks.length}件):\n${taskListStr}\n\n` +
    `🦞 Croppy承認: ${croppyEnabled ? "✅ 有効" : "⚠️ 無効（全タスク手動承認なし）"}\n` +
    `⏰ 最大実行時間: 4時間\n` +
    `🛡️ 安全装置: 連続エラー3回で停止\n\n` +
    `💤 おやすみなさい。結果は完了時にお知らせします。`,
    { parse_mode: "HTML" }
  );

  // Work State保存（再起動復旧用）
  const workTasks: WorkTask[] = tasks.map(t => ({
    id: t.index,
    task: t.description,
    status: "pending" as const,
  }));

  setWorkState({
    assigned_by: username,
    directive: `Nightshift: ${tasks.length}タスク自動実行`,
    user_id: userId,
    chat_id: chatId,
    username,
    tasks: workTasks,
    constraints: ["従量課金API禁止", "不可逆操作禁止", "最大4時間"],
    last_progress: "開始",
    session_id: session.sessionId,
  });

  // バックグラウンド実行開始
  executeNightshift(tasks, chatId, userId, username).catch(err => {
    console.error("[Nightshift] Unhandled error:", err);
  });
}

// ============== Internal ==============

/**
 * /nightshift stop
 */
async function handleNightshiftStop(ctx: Context): Promise<void> {
  if (!nightshiftState?.isRunning) {
    await ctx.reply("ℹ️ Nightshiftは実行されていません。");
    return;
  }

  requestNightshiftAbort();
  await ctx.reply("🛑 Nightshiftの中断をリクエストしました。現在のタスク完了後に停止します。");
}

/**
 * /nightshift status
 */
async function handleNightshiftStatus(ctx: Context): Promise<void> {
  if (!nightshiftState) {
    await ctx.reply("ℹ️ Nightshiftは実行されていません。");
    return;
  }

  const elapsed = Date.now() - nightshiftState.startTime;
  const elapsedMin = Math.round(elapsed / 60000);
  const remainingMin = Math.round((MAX_DURATION_MS - elapsed) / 60000);

  const completed = nightshiftState.results.filter(r => r.status === "completed").length;
  const failed = nightshiftState.results.filter(r => r.status === "failed").length;
  const total = nightshiftState.tasks.length;
  const current = nightshiftState.currentTaskIndex + 1;

  let statusMsg = `🌙 <b>Nightshift Status</b>\n\n`;
  statusMsg += `⏱ 経過: ${elapsedMin}分 / 残り: ${remainingMin}分\n`;
  statusMsg += `📋 進捗: ${completed}/${total} 完了`;
  if (failed > 0) statusMsg += ` (${failed}失敗)`;
  statusMsg += `\n`;

  if (nightshiftState.isRunning && nightshiftState.currentTaskIndex < total) {
    const currentTask = nightshiftState.tasks[nightshiftState.currentTaskIndex];
    statusMsg += `\n🔄 実行中: ${current}. ${currentTask?.description}\n`;
  }

  statusMsg += `\n連続エラー: ${nightshiftState.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}\n`;

  if (nightshiftState.abortRequested) {
    statusMsg += `\n⚠️ 中断リクエスト済み（現タスク完了後に停止）`;
  }

  await ctx.reply(statusMsg, { parse_mode: "HTML" });
}

/**
 * メッセージからタスクリストを解析
 */
function parseTaskList(message: string): NightshiftTask[] {
  const lines = message.split("\n").slice(1); // 1行目（/nightshift）を除く
  const tasks: NightshiftTask[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // "1. タスク", "- タスク", "• タスク", "タスク" を全て受け付ける
    const match = trimmed.match(/^(?:(\d+)[.)\s]+|[-•*]\s+)?(.+)$/);
    if (match) {
      const description = match[2]?.trim();
      if (description) {
        tasks.push({
          index: tasks.length + 1,
          description,
        });
      }
    }
  }

  return tasks;
}

/**
 * Nightshiftメイン実行ループ
 */
async function executeNightshift(
  tasks: NightshiftTask[],
  chatId: number,
  userId: number,
  username: string,
): Promise<void> {
  const state: NightshiftState = {
    isRunning: true,
    startTime: Date.now(),
    tasks,
    currentTaskIndex: 0,
    consecutiveErrors: 0,
    chatId,
    results: [],
    abortRequested: false,
  };

  nightshiftState = state;

  console.log(`[Nightshift] Starting with ${tasks.length} tasks`);

  try {
    for (let i = 0; i < tasks.length; i++) {
      state.currentTaskIndex = i;
      const task = tasks[i]!;

      // ── Safety checks ──
      // 1. 時間制限
      const elapsed = Date.now() - state.startTime;
      if (elapsed > MAX_DURATION_MS) {
        console.log(`[Nightshift] Time limit reached (${Math.round(elapsed / 60000)}min)`);
        // 残タスクをskip
        for (let j = i; j < tasks.length; j++) {
          state.results.push({
            index: tasks[j]!.index,
            description: tasks[j]!.description,
            status: "skipped",
            duration_ms: 0,
            summary: "時間制限により省略",
          });
          updateWorkProgress(tasks[j]!.index, "failed", "時間制限");
        }
        break;
      }

      // 2. 中断リクエスト
      if (state.abortRequested) {
        console.log(`[Nightshift] Abort requested, stopping`);
        for (let j = i; j < tasks.length; j++) {
          state.results.push({
            index: tasks[j]!.index,
            description: tasks[j]!.description,
            status: "stopped",
            duration_ms: 0,
            summary: "ユーザーにより中断",
          });
          updateWorkProgress(tasks[j]!.index, "failed", "中断");
        }
        break;
      }

      // 3. 連続エラー制限
      if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log(`[Nightshift] ${MAX_CONSECUTIVE_ERRORS} consecutive errors, stopping`);
        for (let j = i; j < tasks.length; j++) {
          state.results.push({
            index: tasks[j]!.index,
            description: tasks[j]!.description,
            status: "skipped",
            duration_ms: 0,
            summary: `連続エラー${MAX_CONSECUTIVE_ERRORS}回で停止`,
          });
          updateWorkProgress(tasks[j]!.index, "failed", "連続エラー制限");
        }
        break;
      }

      // 4. 不可逆操作チェック
      const blockedKeyword = BLOCKED_KEYWORDS.find(kw =>
        task.description.toLowerCase().includes(kw)
      );
      if (blockedKeyword) {
        console.log(`[Nightshift] Blocked keyword: "${blockedKeyword}" in task ${task.index}`);
        state.results.push({
          index: task.index,
          description: task.description,
          status: "skipped",
          duration_ms: 0,
          summary: `不可逆操作（${blockedKeyword}）により省略`,
        });
        updateWorkProgress(task.index, "failed", `不可逆操作: ${blockedKeyword}`);
        continue;
      }

      // ── タスク実行 ──
      console.log(`[Nightshift] Executing task ${task.index}/${tasks.length}: ${task.description}`);
      updateWorkProgress(task.index, "in_progress");

      const taskStart = Date.now();
      let result: TaskResult;

      try {
        const response = await executeTask(task, chatId, userId, username);
        const durationMs = Date.now() - taskStart;

        result = {
          index: task.index,
          description: task.description,
          status: "completed",
          duration_ms: durationMs,
          summary: extractSummary(response),
        };

        state.consecutiveErrors = 0; // リセット
        updateWorkProgress(task.index, "completed", result.summary);

        console.log(`[Nightshift] Task ${task.index} completed in ${Math.round(durationMs / 1000)}s`);
      } catch (error) {
        const durationMs = Date.now() - taskStart;
        const errorMsg = error instanceof Error ? error.message : String(error);

        result = {
          index: task.index,
          description: task.description,
          status: "failed",
          duration_ms: durationMs,
          summary: `エラー: ${errorMsg.slice(0, 200)}`,
          error: errorMsg,
        };

        state.consecutiveErrors++;
        updateWorkProgress(task.index, "failed", errorMsg.slice(0, 100));

        console.error(`[Nightshift] Task ${task.index} failed (consecutive: ${state.consecutiveErrors}):`, errorMsg);
      }

      state.results.push(result);

      // ── Croppy承認チェック（失敗タスクの後も判定） ──
      if (i < tasks.length - 1) { // 最後のタスクでなければ
        const shouldContinue = await checkCroppyContinuation(result, state);
        if (!shouldContinue) {
          console.log(`[Nightshift] Croppy STOP — halting`);
          for (let j = i + 1; j < tasks.length; j++) {
            state.results.push({
              index: tasks[j]!.index,
              description: tasks[j]!.description,
              status: "stopped",
              duration_ms: 0,
              summary: "Croppy STOPにより中断",
            });
            updateWorkProgress(tasks[j]!.index, "failed", "Croppy STOP");
          }
          break;
        }
      }
    }
  } catch (error) {
    console.error("[Nightshift] Fatal error:", error);
  } finally {
    state.isRunning = false;
    nightshiftState = null;

    // ── 結果サマリー送信 ──
    await sendResultSummary(state, chatId);

    // Work State クリア
    clearWorkState();

    console.log(`[Nightshift] Finished. Total time: ${Math.round((Date.now() - state.startTime) / 60000)}min`);
  }
}

/**
 * 個別タスクをClaude Agent SDKで実行
 */
async function executeTask(
  task: NightshiftTask,
  chatId: number,
  userId: number,
  username: string,
): Promise<string> {
  const prompt = buildTaskPrompt(task);

  // タイムアウト付きで実行
  // AbortController for clean timeout cancellation
  const abortController = new AbortController();
  const timer = setTimeout(() => {
    abortController.abort();
    // セッション中断
    session.stop().catch(() => {});
  }, TASK_TIMEOUT_MS);

  try {
    const segments: string[] = [];

    const response = await session.sendMessageStreaming(
      prompt,
      username,
      userId,
      async (type, content) => {
        // タイムアウト済みなら何もしない
        if (abortController.signal.aborted) return;
        if (type === "segment_end" && content) {
          segments.push(content);
        }
        // toolやthinkingはログのみ（Telegramには送らない = 静か）
        if (type === "tool") {
          console.log(`[Nightshift] Tool: ${content?.slice(0, 100)}`);
        }
      },
      chatId,
    );

    clearTimeout(timer);

    // タイムアウト後にresolveされた場合はエラーとして扱う
    if (abortController.signal.aborted) {
      throw new Error(`タスクタイムアウト (${TASK_TIMEOUT_MS / 60000}分)`);
    }

    return response;
  } catch (error) {
    clearTimeout(timer);
    if (abortController.signal.aborted) {
      throw new Error(`タスクタイムアウト (${TASK_TIMEOUT_MS / 60000}分)`);
    }
    throw error;
  }
}

/**
 * タスク用のプロンプトを構築
 */
function buildTaskPrompt(task: NightshiftTask): string {
  return `[NIGHTSHIFT MODE — 夜間自動実行]
あなたはDJ就寝中のnightshiftモードで動作しています。

## ルール
- 不可逆操作（git push, デプロイ, ファイル削除）は絶対にしない
- 従量課金API（ANTHROPIC_API_KEY, OPENAI_API_KEY）は使用禁止
- エラーが発生したら修正を試みず、エラー内容を報告して終了
- 作業結果を簡潔にまとめること

## タスク ${task.index}
${task.description}

上記タスクを実行してください。完了したら結果を簡潔に報告してください。`;
}

/**
 * Croppy承認チェック — 次のタスクに進むべきか判定
 */
async function checkCroppyContinuation(
  lastResult: TaskResult,
  state: NightshiftState,
): Promise<boolean> {
  // Croppy有効チェック
  const croppyEnabled = await isAutoApprovalEnabled();

  if (!croppyEnabled) {
    // Croppy無効 = 全自動（ただし安全装置は効く）
    console.log("[Nightshift] Croppy disabled — auto-continuing");
    return true;
  }

  // GO/STOP判定ロジック
  // Croppy有効時はより保守的に判定:
  //   GO条件: タスク成功
  //   STOP条件: 連続エラー2回以上（Croppy無効時は3回）
  // Croppyの役割: 夜間無人運転の安全弁として、早めに止める

  if (lastResult.status === "completed") {
    console.log("[Nightshift] Croppy GO — task completed successfully");
    return true;
  }

  if (lastResult.status === "failed") {
    // Croppy有効時: 連続エラー2回でSTOP（無効時の3回より厳しい）
    const croppyErrorThreshold = 2;
    if (state.consecutiveErrors >= croppyErrorThreshold) {
      console.log(`[Nightshift] Croppy STOP — consecutive errors (${state.consecutiveErrors}) reached croppy threshold (${croppyErrorThreshold})`);
      return false;
    }
    console.log(`[Nightshift] Croppy GO (with warning) — 1st failure, will stop on next consecutive error`);
    return true;
  }

  return true;
}

/**
 * 応答からサマリーを抽出（最大200文字）
 */
function extractSummary(response: string): string {
  if (!response) return "（応答なし）";

  // 最後のパラグラフを取得（通常まとめが最後にある）
  const paragraphs = response.split("\n\n").filter(p => p.trim());
  const lastParagraph = paragraphs[paragraphs.length - 1] || response;

  // マークダウン記法を除去
  const cleaned = lastParagraph
    .replace(/[#*`_~]/g, "")
    .replace(/\[.*?\]\(.*?\)/g, "")
    .trim();

  if (cleaned.length <= 200) return cleaned;
  return cleaned.slice(0, 197) + "...";
}

/**
 * 結果サマリーをTelegramに送信
 */
async function sendResultSummary(
  state: NightshiftState,
  chatId: number,
): Promise<void> {
  const totalMs = Date.now() - state.startTime;
  const totalMin = Math.round(totalMs / 60000);

  const completed = state.results.filter(r => r.status === "completed").length;
  const failed = state.results.filter(r => r.status === "failed").length;
  const skipped = state.results.filter(r => r.status === "skipped").length;
  const stopped = state.results.filter(r => r.status === "stopped").length;

  const allSuccess = failed === 0 && skipped === 0 && stopped === 0;
  const icon = allSuccess ? "✅" : failed > 0 ? "⚠️" : "ℹ️";

  let summary = `🌙 <b>Nightshift完了 ${icon}</b>\n\n`;
  summary += `⏱ 所要時間: ${totalMin}分\n`;
  summary += `📊 結果: ${completed}完了`;
  if (failed > 0) summary += ` / ${failed}失敗`;
  if (skipped > 0) summary += ` / ${skipped}スキップ`;
  if (stopped > 0) summary += ` / ${stopped}中断`;
  summary += `\n\n`;

  summary += `━━━━━━━━━━━━━━━\n`;

  for (const result of state.results) {
    const statusIcon =
      result.status === "completed" ? "✅" :
      result.status === "failed" ? "❌" :
      result.status === "skipped" ? "⏭" :
      "🛑";

    const durationStr = result.duration_ms > 0
      ? ` (${Math.round(result.duration_ms / 1000)}s)`
      : "";

    summary += `\n${statusIcon} <b>${result.index}. ${escapeHtml(result.description)}</b>${durationStr}\n`;
    summary += `   ${escapeHtml(result.summary.slice(0, 150))}\n`;
  }

  summary += `\n━━━━━━━━━━━━━━━`;

  // ネガティブ報告: 問題があれば明示
  if (failed > 0) {
    summary += `\n\n⚠️ <b>失敗タスク:</b>\n`;
    for (const r of state.results.filter(r => r.status === "failed")) {
      summary += `  • ${r.index}. ${escapeHtml(r.description)}: ${escapeHtml(r.error?.slice(0, 100) || "不明")}\n`;
    }
  }

  if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    summary += `\n🚨 連続エラー${MAX_CONSECUTIVE_ERRORS}回で自動停止しました。`;
  }

  if (state.abortRequested) {
    summary += `\n🛑 ユーザーリクエストにより中断しました。`;
  }

  try {
    const api = await getApi();

    // Telegram 4096文字制限対応
    if (summary.length > 4000) {
      // 分割送信
      const firstPart = summary.slice(0, 4000);
      const secondPart = summary.slice(4000);

      await api.sendMessage(chatId, firstPart, { parse_mode: "HTML" });
      if (secondPart.trim()) {
        await api.sendMessage(chatId, secondPart, { parse_mode: "HTML" });
      }
    } else {
      await api.sendMessage(chatId, summary, { parse_mode: "HTML" });
    }
  } catch (error) {
    console.error("[Nightshift] Failed to send summary:", error);

    // フォールバック: プレーンテキストで送信
    try {
      const api = await getApi();
      const plainSummary = summary.replace(/<[^>]+>/g, "");
      await api.sendMessage(chatId, plainSummary);
    } catch (e2) {
      console.error("[Nightshift] Failed to send even plain summary:", e2);
    }
  }
}

/**
 * Bot APIを取得（保持済みのctx.apiを使い、なければ新規作成）
 */
async function getApi(): Promise<Api> {
  if (botApi) return botApi;

  // Fallback: 新しいBot instanceから取得
  const { Bot } = await import("grammy");
  const bot = new Bot(TELEGRAM_TOKEN);
  return bot.api;
}

/**
 * HTML特殊文字をエスケープ
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
