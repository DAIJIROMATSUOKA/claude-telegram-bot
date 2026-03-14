/**
 * dj-spec-command.ts — G9: /spec, /decide, /decisions commands (restored)
 *
 * Restored from F9 archive. All sessionKey API dependencies removed.
 * Pure file operations on DJ-SPEC.md + DJ-DECISIONS.ndjson.
 */

import type { Context } from "grammy";
import {
  readSpec,
  getSpecSections,
  updateSpecSection,
  logDecision,
  getRecentDecisions,
  countDecisions,
  initSpec,
} from "../utils/dj-spec-manager";

function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max) + "…" : text;
}

/** /spec [N] [content] */
export async function handleSpec(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").replace(/^\/spec\s*/, "").trim();

  const created = initSpec();
  if (created) {
    await ctx.reply("📋 DJ-SPEC.md を初期作成しました。内容を記入してください。");
  }

  if (!text) {
    const sections = getSpecSections();
    const lines = sections.map((s, i) => `<b>${i + 1}.</b> ${escapeHtml(s.title)}`);
    const total = countDecisions();

    await ctx.reply(
      `📋 <b>DJ-SPEC</b>\n\n${lines.join("\n")}\n\n` +
        `📊 判断ログ: ${total}件\n\n` +
        `詳細: <code>/spec N</code>\n更新: <code>/spec N 新しい内容</code>\n判断記録: <code>/decide 文脈 | 判断 | 理由</code>`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const firstSpace = text.indexOf(" ");
  const sectionNum = firstSpace === -1 ? text : text.substring(0, firstSpace);
  const content = firstSpace === -1 ? "" : text.substring(firstSpace + 1).trim();

  if (!/^\d+$/.test(sectionNum)) {
    await ctx.reply("使い方: /spec [セクション番号] [新しい内容]");
    return;
  }

  if (!content) {
    const sections = getSpecSections();
    const idx = parseInt(sectionNum) - 1;
    if (idx < 0 || idx >= sections.length) {
      await ctx.reply(`セクション ${sectionNum} は存在しません (1-${sections.length})`);
      return;
    }
    const section = sections[idx]!;
    await ctx.reply(
      `📋 <b>${escapeHtml(section.title)}</b>\n\n${escapeHtml(truncate(section.content, 3000))}`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const ok = updateSpecSection(sectionNum, content);
  if (ok) {
    await ctx.reply(`✅ セクション ${sectionNum} を更新しました`);
  } else {
    await ctx.reply(`❌ セクション ${sectionNum} の更新に失敗しました`);
  }
}

/** /decide context | decision | reason [| rejected] [| project_id] */
export async function handleDecide(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").replace(/^\/decide\s*/, "").trim();

  if (!text) {
    await ctx.reply(
      "使い方: <code>/decide 文脈 | 判断 | 理由</code>\n" +
        "例: <code>/decide M1317見積 | 粗利30%だが受注 | リピート顧客で関係維持優先</code>",
      { parse_mode: "HTML" },
    );
    return;
  }

  const parts = text.split("|").map((p) => p.trim());
  if (parts.length < 3) {
    await ctx.reply("❌ 最低3項目必要: 文脈 | 判断 | 理由");
    return;
  }

  // Auto-detect M-number from context
  const mMatch = parts[0]!.match(/M\d{4}/i);
  const projectId = parts[4]?.trim() || (mMatch ? mMatch[0].toUpperCase() : undefined);

  const entry = logDecision({
    context: parts[0]!,
    decision: parts[1]!,
    reason: parts[2]!,
    rejectedAlternatives: parts[3]?.trim(),
    projectId,
    source: "telegram",
  });

  const lines = [
    `✅ 判断記録完了`,
    `📋 ${escapeHtml(entry.context)}`,
    `→ ${escapeHtml(entry.decision)}`,
    `💡 ${escapeHtml(entry.reason)}`,
  ];
  if (entry.rejected_alternatives) {
    lines.push(`❌ 却下: ${escapeHtml(entry.rejected_alternatives)}`);
  }
  if (entry.project_id) {
    lines.push(`🏭 案件: ${entry.project_id}`);
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

/** /decisions [N] [M1317] */
export async function handleDecisions(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").replace(/^\/decisions\s*/, "").trim();

  let n = 5;
  let projectFilter: string | undefined;

  for (const part of text.split(/\s+/)) {
    if (/^\d+$/.test(part)) {
      n = Math.min(parseInt(part), 20);
    } else if (/^M\d{4}$/i.test(part)) {
      projectFilter = part.toUpperCase();
    }
  }

  const decisions = getRecentDecisions(n, projectFilter);
  if (decisions.length === 0) {
    const msg = projectFilter
      ? `📊 ${projectFilter} の判断記録はありません`
      : "📊 判断記録はまだありません。<code>/decide</code> で記録を開始してください。";
    await ctx.reply(msg, { parse_mode: "HTML" });
    return;
  }

  const total = countDecisions();
  const header = projectFilter
    ? `📊 <b>${projectFilter} の判断ログ</b> (${decisions.length}件)`
    : `📊 <b>判断ログ</b> (直近${decisions.length}件 / 全${total}件)`;

  const lines = decisions.map((d) => {
    const date = d.date.substring(0, 10);
    const proj = d.project_id ? `[${d.project_id}]` : "";
    return `<b>${date}</b> ${proj}\n  📋 ${escapeHtml(truncate(d.context, 50))}\n  → ${escapeHtml(truncate(d.decision, 60))}\n  💡 ${escapeHtml(truncate(d.reason, 60))}`;
  });

  await ctx.reply(`${header}\n\n${lines.join("\n\n")}`, { parse_mode: "HTML" });
}
