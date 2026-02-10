/**
 * Work State Manager - 長時間作業の永続化システム
 *
 * 再起動をまたいで「何の作業を、どこまでやったか」を保持する。
 * pending-task.ts（Layer 1）が1回のリクエスト保護なのに対し、
 * work-state（Layer 2）は複数ステップにわたる作業プラン全体を保持する。
 *
 * 保存先: プロジェクトディレクトリ内（/tmp だとOS再起動で消える）
 *
 * フロー:
 *   1. DJが「一任」等の長時間作業を指示 → Claudeが setWorkState() で保存
 *   2. 各ステップ完了時 → updateWorkProgress() で進捗更新
 *   3. 再起動時 → getWorkState() で読み込み → 自動再開
 *   4. 全作業完了 → clearWorkState()
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";

// プロジェクトディレクトリ内に保存（/tmp ではなく）
const WORK_STATE_FILE = resolve(
  import.meta.dir,
  "../../.work-state.json"
);

export interface WorkTask {
  id: number;
  task: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  notes?: string;
}

export interface WorkState {
  /** 作業プラン作成時刻 */
  created_at: string;
  /** 最終更新時刻 */
  updated_at: string;
  /** 指示者 */
  assigned_by: string;
  /** 元の指示（DJのメッセージ） */
  directive: string;
  /** DJのユーザーID */
  user_id: number;
  /** DJのチャットID */
  chat_id: number;
  /** ユーザー名 */
  username: string;
  /** タスクリスト */
  tasks: WorkTask[];
  /** 制約条件 */
  constraints: string[];
  /** 最後の進捗メモ */
  last_progress: string;
  /** Claudeセッション ID */
  session_id: string | null;
  /** 有効期限（ミリ秒） デフォルト48時間 */
  expires_at: number;
}

/**
 * 作業プランを保存
 */
export function setWorkState(state: Omit<WorkState, "created_at" | "updated_at" | "expires_at">): void {
  try {
    const now = new Date().toISOString();
    const data: WorkState = {
      ...state,
      created_at: now,
      updated_at: now,
      expires_at: Date.now() + 48 * 60 * 60 * 1000, // 48時間
    };
    writeFileSync(WORK_STATE_FILE, JSON.stringify(data, null, 2));
    console.log(`[WorkState] Saved: ${state.tasks.length} tasks, directive: "${state.directive.slice(0, 50)}"`);
  } catch (error) {
    console.error("[WorkState] Failed to save:", error);
  }
}

/**
 * 作業プランを取得（期限切れチェック付き）
 */
export function getWorkState(): WorkState | null {
  try {
    if (!existsSync(WORK_STATE_FILE)) {
      return null;
    }

    const raw = readFileSync(WORK_STATE_FILE, "utf-8");
    const state = JSON.parse(raw) as WorkState;

    // 期限切れチェック
    if (Date.now() > state.expires_at) {
      console.log(`[WorkState] Expired (created: ${state.created_at}), clearing`);
      clearWorkState();
      return null;
    }

    const pendingCount = state.tasks.filter(t => t.status === "pending" || t.status === "in_progress").length;
    console.log(`[WorkState] Found: ${pendingCount} remaining tasks of ${state.tasks.length} total`);
    return state;
  } catch (error) {
    console.error("[WorkState] Failed to read:", error);
    return null;
  }
}

/**
 * 作業進捗を更新
 */
export function updateWorkProgress(
  taskId: number,
  status: WorkTask["status"],
  notes?: string,
  lastProgress?: string
): void {
  try {
    const state = getWorkState();
    if (!state) return;

    const task = state.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = status;
      if (notes) task.notes = notes;
    }

    state.updated_at = new Date().toISOString();
    if (lastProgress) {
      state.last_progress = lastProgress;
    }

    writeFileSync(WORK_STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`[WorkState] Updated task ${taskId}: ${status}${notes ? ` (${notes})` : ""}`);
  } catch (error) {
    console.error("[WorkState] Failed to update:", error);
  }
}

/**
 * セッションIDを更新
 */
export function updateWorkStateSessionId(sessionId: string): void {
  try {
    const state = getWorkState();
    if (!state) return;

    state.session_id = sessionId;
    state.updated_at = new Date().toISOString();
    writeFileSync(WORK_STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`[WorkState] Updated session_id: ${sessionId.slice(0, 8)}...`);
  } catch (error) {
    console.error("[WorkState] Failed to update session_id:", error);
  }
}

/**
 * 作業プランをクリア（全完了時）
 */
export function clearWorkState(): void {
  try {
    if (existsSync(WORK_STATE_FILE)) {
      unlinkSync(WORK_STATE_FILE);
      console.log("[WorkState] Cleared");
    }
  } catch (error) {
    console.error("[WorkState] Failed to clear:", error);
  }
}

/**
 * 作業プランをコンテキスト文字列として整形
 * （Claudeへの注入用）
 */
export function formatWorkStateForContext(state: WorkState): string {
  const parts: string[] = [];

  parts.push(`[ACTIVE WORK PLAN]`);
  parts.push(`指示者: ${state.assigned_by}`);
  parts.push(`指示: ${state.directive}`);
  parts.push(`作成: ${state.created_at}`);

  if (state.constraints.length > 0) {
    parts.push(`制約: ${state.constraints.join(", ")}`);
  }

  parts.push(`\nタスク:`);
  for (const task of state.tasks) {
    const icon = task.status === "completed" ? "✅"
      : task.status === "in_progress" ? "🔄"
      : task.status === "failed" ? "❌"
      : "⬜";
    parts.push(`  ${icon} ${task.id}. ${task.task}${task.notes ? ` (${task.notes})` : ""}`);
  }

  if (state.last_progress) {
    parts.push(`\n最後の進捗: ${state.last_progress}`);
  }

  parts.push(`\n⚠️ この作業プランは再起動前から継続中。未完了タスクを続行すること。`);

  return parts.join("\n");
}

/**
 * 全タスク完了済みかチェック
 */
export function isWorkComplete(state: WorkState): boolean {
  return state.tasks.every(t => t.status === "completed" || t.status === "failed");
}

/**
 * WORK_STATE_FILE パスを公開（index.tsのシャットダウン処理用）
 */
export { WORK_STATE_FILE };
