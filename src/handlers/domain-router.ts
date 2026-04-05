/**
 * domain-router.ts — Domain routing wrapper for specialized chats
 * 場所: ~/claude-telegram-bot/src/handlers/domain-router.ts
 *
 * chat-routing.yaml + domain-relay.sh のTypeScriptインターフェース。
 * text.tsから呼ばれ、Telegram→専門チャット→応答→Telegram返信を行う。
 */

import { exec, execSync } from "child_process";
import { promisify } from "util";
import type { Context } from "grammy";
import { DOMAIN_RELAY_TIMEOUT_MS, CMD_TIMEOUT_SHORT_MS } from "../constants";

function djQuote(msg: string): string {
  const clean = msg.replace(/\n/g, " ").trim();
  const truncated = clean.length > 60 ? clean.substring(0, 60) + "…" : clean;
  return `💬 ${truncated}\n`;
}



const execAsync = promisify(exec);

const HOME = process.env.HOME || "/Users/daijiromatsuokam1";
const SCRIPTS_DIR = `${HOME}/claude-telegram-bot/scripts`;
const DOMAIN_RELAY = `${SCRIPTS_DIR}/domain-relay.sh`;
const CHAT_ROUTER = `${SCRIPTS_DIR}/chat-router.py`;

/**
 * Quick check: does the message match any domain keywords?
 * Synchronous — uses execSync for speed.
 */
export function quickDomainRoute(text: string): { domain: string; url: string } | null {
  try {
    const out = execSync(
      `python3 "${CHAT_ROUTER}" route ${JSON.stringify(text)}`,
      { timeout: CMD_TIMEOUT_SHORT_MS, encoding: "utf-8" }
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
        timeout: DOMAIN_RELAY_TIMEOUT_MS,
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

    // Delete status message
    try {
      await ctx.api.deleteMessage(chatId, statusMsg.message_id);
    } catch {}

    // Send response (split if too long)
    const MAX_TG = 4000;
    if (response.length <= MAX_TG) {
      await ctx.reply(`${djQuote(message)}📋 [${route.domain}]\n${response}`, {
        reply_to_message_id: ctx.message?.message_id,
      });
    } else {
      // Split into chunks
      const chunks: string[] = [];
      for (let i = 0; i < response.length; i += MAX_TG) {
        chunks.push(response.substring(i, i + MAX_TG));
      }
      for (let i = 0; i < chunks.length; i++) {
        const prefix = i === 0 ? `${djQuote(message)}📋 [${route.domain}] (${i + 1}/${chunks.length})\n` : "";
        await ctx.reply(`${prefix}${chunks[i]}`, {
          reply_to_message_id: i === 0 ? ctx.message?.message_id : undefined,
        });
      }
    }

    console.log(`[DomainRouter] ${route.domain}: relayed ${response.length} chars`);
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
