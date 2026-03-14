/**
 * audit-command.ts — G8: /audit コマンド
 *
 * Usage:
 *   /audit        — 直近10件の振り分けログ
 *   /audit M1317  — 案件別フィルタ
 *   /audit 20     — 件数指定
 *   /audit queue  — キュー内メッセージ表示
 */

import type { Context } from "grammy";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getQueuedMessages } from "../utils/message-queue";

const AUDIT_FILE = join(homedir(), ".jarvis/orchestrator/audit.jsonl");

function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max) + "…" : text;
}

interface AuditEntry {
  timestamp: string;
  source: string;
  method: string;
  projectId: string | null;
  confidence: number;
  reason: string;
  messagePreview: string;
  needsReview: boolean;
}

function loadAuditEntries(): AuditEntry[] {
  try {
    if (!existsSync(AUDIT_FILE)) return [];
    return readFileSync(AUDIT_FILE, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export async function handleAudit(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").replace(/^\/audit\s*/, "").trim();

  // /audit queue — show message queue
  if (text.toLowerCase() === "queue") {
    const queued = getQueuedMessages();
    if (queued.length === 0) {
      await ctx.reply("📭 メッセージキューは空です");
      return;
    }
    const lines = queued.map((m) => {
      const age = Math.round((Date.now() - new Date(m.queuedAt).getTime()) / 60000);
      return `• <b>${m.projectId}</b> (${age}分前, retry:${m.retries})\n  ${escapeHtml(truncate(m.text, 60))}\n  ❌ ${escapeHtml(truncate(m.lastError, 40))}`;
    });
    await ctx.reply(`📬 <b>メッセージキュー</b> (${queued.length}件)\n\n${lines.join("\n\n")}`, {
      parse_mode: "HTML",
    });
    return;
  }

  // Parse args
  let n = 10;
  let projectFilter: string | undefined;

  for (const part of text.split(/\s+/).filter(Boolean)) {
    if (/^\d+$/.test(part)) {
      n = Math.min(parseInt(part), 50);
    } else if (/^M\d{4}$/i.test(part)) {
      projectFilter = part.toUpperCase();
    }
  }

  const allEntries = loadAuditEntries();
  let filtered = projectFilter
    ? allEntries.filter((e) => e.projectId?.toUpperCase() === projectFilter)
    : allEntries;

  const recent = filtered.slice(-n).reverse();

  if (recent.length === 0) {
    const msg = projectFilter
      ? `📊 ${projectFilter} の振り分けログはありません`
      : "📊 振り分けログはまだありません";
    await ctx.reply(msg);
    return;
  }

  const header = projectFilter
    ? `📊 <b>${projectFilter} 振り分けログ</b> (${recent.length}件)`
    : `📊 <b>振り分けログ</b> (直近${recent.length}件 / 全${allEntries.length}件)`;

  const methodIcon: Record<string, string> = {
    "m-number": "🔢",
    "sender-map": "👤",
    "keyword": "🔑",
    "claude-inbox": "🤖",
    "no-route": "❓",
  };

  const lines = recent.map((e) => {
    const time = e.timestamp.substring(11, 16);
    const icon = methodIcon[e.method] || "•";
    const proj = e.projectId || "—";
    const review = e.needsReview ? " ⚠️" : "";
    return `${icon} <b>${time}</b> → ${proj} (${(e.confidence * 100).toFixed(0)}%)${review}\n  ${escapeHtml(truncate(e.messagePreview, 50))}\n  💡 ${escapeHtml(truncate(e.reason, 40))}`;
  });

  await ctx.reply(`${header}\n\n${lines.join("\n\n")}`, { parse_mode: "HTML" });
}
