/**
 * dj-spec-command.ts — Telegram commands for DJ-SPEC and Decision Log
 *
 * Commands:
 *   /spec           — Show current DJ-SPEC sections
 *   /spec N         — Show section N in detail
 *   /spec N content — Update section N
 *   /decide context | decision | reason — Log a decision
 *   /decisions [N]  — Show recent N decisions (default 5)
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

  // Ensure spec exists
  const created = initSpec();
  if (created) {
    await ctx.reply("📋 DJ-SPEC.md を初期作成しました。内容を記入してください。");
  }

  // No args: show section list
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

  // Parse: first token = section number
  const firstSpace = text.indexOf(" ");
  const sectionNum = firstSpace === -1 ? text : text.substring(0, firstSpace);
  const content = firstSpace === -1 ? "" : text.substring(firstSpace + 1).trim();

  // Validate section number
  if (!/^\d+$/.test(sectionNum)) {
    await ctx.reply("使い方: /spec [セクション番号] [新しい内容]");
    return;
  }

  // Show section detail
  if (!content) {
    const sections = getSpecSections();
    const idx = parseInt(sectionNum) - 1;
    if (idx < 0 || idx >= sections.length) {
      await ctx.reply(`セクション ${sectionNum} は存在しません (1-${sections.length})`);
      return;
    }
    const section = sections[idx];
    await ctx.reply(
      `📋 <b>${escapeHtml(section.title)}</b>\n\n${escapeHtml(truncate(section.content, 3000))}`,
      { parse_mode: "HTML" },
    );
    return;
  }

  // Update section
  const ok = updateSpecSection(sectionNum, content);
  if (ok) {
    await ctx.reply(`✅ セクション ${sectionNum} を更新しました`);
  } else {
    await ctx.reply(`❌ セクション ${sectionNum} の更新に失敗しました`);
  }
}

/** /decide context | decision | reason [| rejected_alternatives] */
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
    await ctx.reply("最低3項目必要: 文脈 | 判断 | 理由（パイプ | で区切る）");
    return;
  }

  // Detect project ID from context
  const projectMatch = parts[0].match(/M\d{4}/);

  logDecision({
    date: new Date().toISOString(),
    context: parts[0],
    decision: parts[1],
    reason: parts[2],
    rejected_alternatives: parts[3] || undefined,
    project_id: projectMatch?.[0] || undefined,
    source: "telegram",
  });

  const total = countDecisions();
  await ctx.reply(`📝 判断記録 #${total}\n文脈: ${parts[0]}\n判断: ${parts[1]}\n理由: ${parts[2]}`);
}

/** /decisions [N] */
export async function handleDecisions(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").replace(/^\/decisions\s*/, "").trim();
  const count = parseInt(text) || 5;

  const decisions = getRecentDecisions(count);

  if (decisions.length === 0) {
    await ctx.reply("判断ログがまだありません。\n<code>/decide 文脈 | 判断 | 理由</code> で記録", { parse_mode: "HTML" });
    return;
  }

  const total = countDecisions();
  const lines = decisions.map((d, i) => {
    const date = d.date?.substring(0, 10) || "?";
    const proj = d.project_id ? `[${d.project_id}]` : "";
    return `<b>${date}</b> ${proj}\n  📌 ${escapeHtml(truncate(d.decision, 60))}\n  💡 ${escapeHtml(truncate(d.reason, 60))}`;
  });

  await ctx.reply(
    `📊 <b>判断ログ</b> (直近${decisions.length}件 / 全${total}件)\n\n${lines.join("\n\n")}`,
    { parse_mode: "HTML" },
  );
}
