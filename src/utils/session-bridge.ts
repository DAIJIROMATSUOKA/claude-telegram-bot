/**
 * AI Session Bridge - 3AI CLIとのインタラクティブセッション管理
 *
 * Claude/Gemini: -p 呼び出し + 会話履歴自動注入
 * ChatGPT: Shortcuts経由 + 会話履歴注入
 *
 * DJの大原則: Telegramへの最初の投稿以外は何もしない
 * → 全AIがM1上で直接ファイル操作・コマンド実行を行う
 * → DJはTelegramで指示するだけ
 *
 * 従量課金ゼロ。全て固定費サブスク。
 */

import { spawn } from "node:child_process";

// ========================================
// Types
// ========================================

export type AIBackend = "claude" | "gemini" | "gpt";

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface AISession {
  ai: AIBackend;
  sessionId: string;
  startedAt: number;
  messageCount: number;
  history: HistoryEntry[];
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

// ========================================
// AI Info
// ========================================

export const AI_INFO: Record<
  AIBackend,
  { name: string; emoji: string; capabilities: string }
> = {
  claude: {
    name: "Claude Opus 4.5",
    emoji: "\u{1F9E0}",
    capabilities:
      "\u30D5\u30A1\u30A4\u30EB\u7DE8\u96C6\u30FB\u30B3\u30DE\u30F3\u30C9\u5B9F\u884C\u30FBgit\u64CD\u4F5C\u30FB\u30C6\u30B9\u30C8\u5B9F\u884C",
  },
  gemini: {
    name: "Gemini 2.5 Pro",
    emoji: "\u{1F52E}",
    capabilities:
      "\u30D5\u30A1\u30A4\u30EB\u7DE8\u96C6\u30FB\u30B3\u30DE\u30F3\u30C9\u5B9F\u884C\u30FBgit\u64CD\u4F5C",
  },
  gpt: {
    name: "ChatGPT 5.2",
    emoji: "\u{1F4AC}",
    capabilities:
      "\u76F8\u8AC7\u30FB\u30EC\u30D3\u30E5\u30FC\u30FB\u30A2\u30A4\u30C7\u30A2\u51FA\u3057\uFF08\u30D5\u30A1\u30A4\u30EB\u64CD\u4F5C\u4E0D\u53EF\uFF09",
  },
};

// ========================================
// Session Store (in-memory, DJ 1人なのでこれで十分)
// ========================================

const activeSessions = new Map<number, AISession>();

export function hasActiveSession(userId: number): boolean {
  return activeSessions.has(userId);
}

export function getSession(userId: number): AISession | undefined {
  return activeSessions.get(userId);
}

export function startSession(userId: number, ai: AIBackend): AISession {
  // 既存セッションがあれば終了
  activeSessions.delete(userId);

  const session: AISession = {
    ai,
    sessionId: "ai_" + ai + "_" + Date.now(),
    startedAt: Date.now(),
    messageCount: 0,
    history: [],
  };

  activeSessions.set(userId, session);
  return session;
}

export function endSession(userId: number): AISession | undefined {
  const session = activeSessions.get(userId);
  activeSessions.delete(userId);
  return session;
}

// ========================================
// CLI Spawn (shell不使用で安全)
// ========================================

function spawnCLI(
  cmd: string,
  args: string[],
  input: string | null,
  timeoutMs: number,
  cwd?: string,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let done = false;

    const child = spawn(cmd, args, {
      stdio: [input != null ? "pipe" : "ignore", "pipe", "pipe"],
      cwd: cwd || process.env.HOME + "/claude-telegram-bot",
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      resolve({ stdout: stdout.trim(), stderr, code, timedOut });
    };

    // Soft kill at timeout
    const softTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {}
    }, timeoutMs);

    // Hard kill 5s after
    const hardTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs + 5_000);

    if (input != null) {
      try {
        child.stdin!.write(input);
        child.stdin!.end();
      } catch {}
    }

    child.stdout!.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr!.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("close", (code) => finish(code ?? 1));
    child.on("error", () => finish(1));
  });
}

// ========================================
// History Management
// ========================================

/**
 * 会話履歴をプロンプト用テキストに変換
 * 直近N往復分を含める。古い履歴は要約。
 */
function buildHistoryPrompt(history: HistoryEntry[]): string {
  if (history.length === 0) return "";

  // 直近10往復 = 20エントリ
  const MAX_ENTRIES = 20;
  const recent = history.slice(-MAX_ENTRIES);

  const lines: string[] = [];
  lines.push("=== Previous conversation (continue from here) ===");
  for (const h of recent) {
    const prefix = h.role === "user" ? "User" : "AI";
    // 各エントリは最大500文字に切り詰め（プロンプト肥大化防止）
    const content =
      h.content.length > 500
        ? h.content.slice(0, 497) + "..."
        : h.content;
    lines.push(prefix + ": " + content);
  }
  lines.push("=== End of history ===");
  lines.push("");

  return lines.join("\n");
}

// ========================================
// Core: Send Message to AI Session
// ========================================

/**
 * セッション中のAIにメッセージを送信
 * 
 * Claude/Gemini: -p で呼び出し。CLAUDE.md/GEMINI.md を自動読み込み。
 *   → M1上で直接ファイル操作・コマンド実行が可能
 * ChatGPT: Shortcuts経由。相談のみ。
 */
export async function sendToSession(
  userId: number,
  message: string,
): Promise<string> {
  const session = activeSessions.get(userId);
  if (!session) throw new Error("No active session");

  session.messageCount++;

  // 会話履歴を組み立て
  const historyPrompt = buildHistoryPrompt(session.history);
  const fullPrompt = historyPrompt + "User: " + message;

  let result: SpawnResult;

  switch (session.ai) {
    case "claude":
      // Claude CLI: CLAUDE.md自動読み込み、ファイル操作・コマンド実行可能
      // --dangerously-skip-permissions: 承認プロンプトなし（DJはTelegram以外触らない原則）
      result = await spawnCLI(
        "claude",
        ["--dangerously-skip-permissions", "-p", fullPrompt],
        null,
        300_000, // 5分
      );
      break;

    case "gemini":
      // Gemini CLI: GEMINI.md自動読み込み、ファイル操作可能
      // --yolo: 承認プロンプトなし
      result = await spawnCLI(
        "gemini",
        ["--yolo", "-p", fullPrompt],
        null,
        300_000,
      );
      break;

    case "gpt":
      // ChatGPT: Shortcuts経由、stdin でプロンプト渡し
      // ファイル操作不可、相談のみ
      result = await spawnCLI(
        "shortcuts",
        ["run", "Ask ChatGPT"],
        fullPrompt,
        180_000, // 3分
      );
      break;

    default:
      throw new Error("Unknown AI backend: " + session.ai);
  }

  // 出力取得（stdoutがあればexit code関係なく使う）
  let output: string;
  if (result.stdout) {
    output = result.stdout;
  } else if (result.timedOut) {
    output = "\u274C \u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\uFF085\u5206\uFF09";
  } else if (result.stderr) {
    output =
      "\u274C \u30A8\u30E9\u30FC (exit " +
      result.code +
      "):\n" +
      result.stderr.slice(0, 500);
  } else {
    output = "\u274C \u5FDC\u7B54\u306A\u3057 (exit " + result.code + ")";
  }

  // 履歴に追加
  const now = Date.now();
  session.history.push({ role: "user", content: message, timestamp: now });
  session.history.push({ role: "assistant", content: output, timestamp: now });

  // 履歴が20往復超えたら古いのを削除
  if (session.history.length > 40) {
    session.history = session.history.slice(-30);
  }

  return output;
}

// ========================================
// Utility: Split long messages for Telegram
// ========================================

/**
 * Telegram 4096文字制限対応の分割
 */
export function splitTelegramMessage(
  text: string,
  maxLen = 4000,
): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // 改行位置で区切る（自然な分割）
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen / 2) {
      // 改行が遠すぎる場合はスペースで区切る
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitAt < maxLen / 2) {
      // それでもダメなら強制分割
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
