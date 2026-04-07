/**
 * Pending Task Manager - ファイルベースのタスク復帰システム
 *
 * Bot再起動時に中断されたタスクを自動的に再開するための仕組み。
 * Memory Gateway不要。/tmp にJSONファイルで保存。
 *
 * フロー:
 *   1. テキストハンドラでClaude処理開始時に savePendingTask()
 *   2. 処理完了時に clearPendingTask()
 *   3. シャットダウン時: ファイルが残っていれば中断タスクあり
 *   4. 起動時: getPendingTask() で検出 → 自動再送
 */

import { createLogger } from "./logger";
const log = createLogger("pending-task");

import { existsSync, unlinkSync, writeFileSync } from "fs";
import { PENDING_TASK_FILE } from "../config";
import { loadConfig, invalidateConfig } from "./config-loader";

export interface PendingTask {
  /** ユーザーID */
  user_id: number;
  /** チャットID */
  chat_id: number;
  /** ユーザー名 */
  username: string;
  /** 元のユーザーメッセージ */
  original_message: string;
  /** Claudeセッション ID (resume用) */
  session_id: string | null;
  /** タスク開始時刻 */
  started_at: number;
  /** 保存時刻 */
  saved_at: number;
}

/**
 * 処理開始時にペンディングタスクを保存
 */
export function savePendingTask(task: Omit<PendingTask, "saved_at">): void {
  try {
    const data: PendingTask = {
      ...task,
      saved_at: Date.now(),
    };
    writeFileSync(PENDING_TASK_FILE, JSON.stringify(data, null, 2));
    invalidateConfig(PENDING_TASK_FILE);
    log.info("[PendingTask] Saved:", task.original_message.slice(0, 50));
  } catch (error) {
    log.error("[PendingTask] Failed to save:", error);
  }
}

/**
 * 処理完了時にペンディングタスクをクリア
 */
export function clearPendingTask(): void {
  try {
    if (existsSync(PENDING_TASK_FILE)) {
      unlinkSync(PENDING_TASK_FILE);
      invalidateConfig(PENDING_TASK_FILE);
      log.info("[PendingTask] Cleared");
    }
  } catch (error) {
    log.error("[PendingTask] Failed to clear:", error);
  }
}

/**
 * 起動時にペンディングタスクを取得
 * 5分以内のタスクのみ有効（古いものは無視）
 */
export function getPendingTask(): PendingTask | null {
  try {
    if (!existsSync(PENDING_TASK_FILE)) {
      return null;
    }

    const task = loadConfig<PendingTask>(PENDING_TASK_FILE);

    // 24時間以上前のタスクは無視（十分な余裕を持たせる）
    const age = Date.now() - task.saved_at;
    if (age > 24 * 60 * 60 * 1000) {
      log.info(`[PendingTask] Expired (age=${Math.round(age / 1000)}s), clearing`);
      clearPendingTask();
      return null;
    }

    log.info(`[PendingTask] Found pending task (age=${Math.round(age / 1000)}s):`, task.original_message.slice(0, 50));
    return task;
  } catch (error) {
    log.error("[PendingTask] Failed to read:", error);
    clearPendingTask();
    return null;
  }
}

/**
 * セッションIDを更新（Claude応答でsession_idが確定した時）
 */
export function updatePendingTaskSessionId(sessionId: string): void {
  try {
    if (!existsSync(PENDING_TASK_FILE)) return;

    const task = loadConfig<PendingTask>(PENDING_TASK_FILE);
    task.session_id = sessionId;
    writeFileSync(PENDING_TASK_FILE, JSON.stringify(task, null, 2));
    invalidateConfig(PENDING_TASK_FILE);
    log.info("[PendingTask] Updated session_id:", sessionId.slice(0, 8));
  } catch (error) {
    log.error("[PendingTask] Failed to update session_id:", error);
  }
}
