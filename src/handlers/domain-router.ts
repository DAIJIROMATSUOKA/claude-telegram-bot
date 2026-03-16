/**
 * domain-router.ts — Domain routing wrapper for specialized chats
 * 場所: ~/claude-telegram-bot/src/handlers/domain-router.ts
 *
 * chat-routing.yaml + domain-relay.sh のTypeScriptインターフェース。
 * text.tsから呼ばれ、Telegram→専門チャット→応答→Telegram返信を行う。
 */

import { exec } from "child_process";
import { promisify } from "util";
import type { Context } from "grammy";

const execAsync = promisify(exec);

const HOME = process.env.HOME || "/Users/daijiromatsuokam1";
const SCRIPTS_DIR = `${HOME}/claude-telegram-bot/scripts`;
const DOMAIN_RELAY = `${SCRIPTS_DIR}/domain-relay.sh`;
const CHAT_ROUTER = `${SCRIPTS_DIR}/chat-router.py`;

interface DomainRouteResult {
  domain: string;
  url: string;
  wt: string;
  response: string;
}

/**
 * Quick check: does the message match any domain keywords?
 * Synchronous — uses execSync for speed.
 */
export function quickDomainRoute(text: string): { domain: string; url: string } | null {
  try {
    const { execSync } = require("child_process");
    const out = execSync(
      `python3 "${CHAT_ROUTER}" route ${JSON.stringify(text)}`,
      { timeout: 5000, encoding: "utf-8" }
    );
    const domain = out.match(/^DOMAIN: (.+)$/m)?.[1]?.trim();
    const url = out.match(/^URL: (.+)$/m)?.[1]?.trim();

    if (!domain || domain === "inbox" || !url || url === "(未作成)") {
      return null;
    }
    return { domain, url };
  } catch {
    return null;
  }
}

/**
 * Full domain relay: route → inject → wait → response → Telegram reply.
 * Returns true if handled, false if should fall through.
 */

/**
 * Parse XREF tags from domain chat response and auto-query target domains.
 * Format: [XREF:domain:question]
 * Returns response with XREF results appended.
 */
async function resolveXrefs(
  response: string,
  sourceDomain: string,
  maxXrefs: number = 3
): Promise<string> {
  const xrefPattern = /\[XREF:([a-z0-9-]+):([^\]]+)\]/g;
  const matches: RegExpExecArray[] = []; let m: RegExpExecArray | null; while ((m = xrefPattern.exec(response)) !== null) matches.push(m);

  if (matches.length === 0) return response;

  const xrefResults: string[] = [];
  let count = 0;

  for (const match of matches) {
    if (count >= maxXrefs) break;
    const [fullMatch, targetDomain, question] = match;

    // Don't query self
    if (targetDomain === sourceDomain) continue;

    console.log(`[XREF] ${sourceDomain} -> ${targetDomain}: ${question.substring(0, 60)}`);

    try {
      const escapedQ = question.replace(/'/g, "'\''");
      const { stdout } = await execAsync(
        `bash "${DOMAIN_RELAY}" --domain "${targetDomain}" '${escapedQ}'`,
        {
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` },
        }
      );

      const xrefResponse = stdout.match(/^RESPONSE: ([\s\S]+)$/m)?.[1]?.trim();
      if (xrefResponse) {
        xrefResults.push(`📎 [${targetDomain}] ${xrefResponse}`);
        count++;
      }
    } catch (e: any) {
      console.error(`[XREF] Error querying ${targetDomain}:`, e?.message?.substring(0, 100));
      xrefResults.push(`⚠️ [${targetDomain}] 参照エラー`);
    }
  }

  if (xrefResults.length === 0) return response;

  // Remove XREF tags from response, append results
  let cleanResponse = response.replace(xrefPattern, "").trim();
  const xrefSection = "\n\n--- XREF参照結果 ---\n" + xrefResults.join("\n\n");
  return cleanResponse + xrefSection;
}

export async function handleDomainRelay(
  ctx: Context,
  message: string
): Promise<boolean> {
  // Quick check first (fast, synchronous)
  const route = quickDomainRoute(message);
  if (!route) return false;

  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  console.log(`[DomainRouter] Routing to ${route.domain}: ${route.url.substring(0, 50)}`);

  // Send "routing" indicator
  const statusMsg = await ctx.reply(`🔄 ${route.domain} チャットに転送中...`, {
    reply_to_message_id: ctx.message?.message_id,
  });

  try {
    // Shell escape message for domain-relay.sh
    const escapedMsg = message.replace(/'/g, "'\\''");
    const { stdout, stderr } = await execAsync(
      `bash "${DOMAIN_RELAY}" --domain "${route.domain}" '${escapedMsg}'`,
      {
        timeout: 150_000, // 2.5min
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` },
      }
    );

    // Parse response
    const response = stdout.match(/^RESPONSE: ([\s\S]+)$/m)?.[1]?.trim();

    if (!response) {
      console.error(`[DomainRouter] No response from ${route.domain}: ${stderr}`);
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `⚠️ ${route.domain}チャットから応答なし`
      );
      return true; // handled (with error), don't fall through
    }

    // Resolve XREF cross-domain queries
    const resolvedResponse = await resolveXrefs(response, route.domain);

    // Delete status message
    try {
      await ctx.api.deleteMessage(chatId, statusMsg.message_id);
    } catch {}

    // Send response (split if too long)
    const MAX_TG = 4000;
    if (resolvedResponse.length <= MAX_TG) {
      await ctx.reply(`📋 [${route.domain}]\n${response}`, {
        reply_to_message_id: ctx.message?.message_id,
      });
    } else {
      // Split into chunks
      const chunks: string[] = [];
      for (let i = 0; i < resolvedResponse.length; i += MAX_TG) {
        chunks.push(resolvedResponse.substring(i, i + MAX_TG));
      }
      for (let i = 0; i < chunks.length; i++) {
        const prefix = i === 0 ? `📋 [${route.domain}] (${i + 1}/${chunks.length})\n` : "";
        await ctx.reply(`${prefix}${chunks[i]}`, {
          reply_to_message_id: i === 0 ? ctx.message?.message_id : undefined,
        });
      }
    }

    console.log(`[DomainRouter] ${route.domain}: relayed ${resolvedResponse.length} chars`);
    return true;
  } catch (error: any) {
    console.error(`[DomainRouter] Error:`, error?.message);
    try {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `⚠️ ${route.domain}チャット転送エラー: ${error?.message?.substring(0, 100)}`
      );
    } catch {}
    return true;
  }
}
