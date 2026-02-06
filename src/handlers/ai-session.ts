/**
 * AI Session Handler
 *
 * /ai claude  → Claude Opus 4.5 セッション開始（ファイル操作可能）
 * /ai gemini  → Gemini 2.5 Pro セッション開始（ファイル操作可能）
 * /ai gpt     → ChatGPT 5.2 セッション開始（相談のみ）
 * /ai end     → セッション終了
 * /ai status  → 現在のセッション情報
 *
 * DJの大原則: Telegramへの最初の投稿以外は何もしない
 */

import type { Context } from "grammy";
import { ALLOWED_USERS } from "../config";
import { isAuthorized } from "../security";
import {
  startSession,
  endSession,
  getSession,
  hasActiveSession,
  AI_INFO,
  type AIBackend,
} from "../utils/session-bridge";

export async function handleAISession(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const text =
    ctx.message && "text" in ctx.message ? ctx.message.text || "" : "";
  const args = text.replace(/^\/ai\s*/i, "").trim().split(/\s+/);
  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) {
    // Usage
    const current = hasActiveSession(userId!)
      ? getSession(userId!)
      : null;

    let statusLine: string;
    if (current) {
      const info = AI_INFO[current.ai];
      const mins = Math.round(
        (Date.now() - current.startedAt) / 1000 / 60,
      );
      statusLine =
        "\n\u{1F7E2} \u73FE\u5728: " +
        info.emoji +
        " " +
        info.name +
        " (" +
        current.messageCount +
        "\u30E1\u30C3\u30BB\u30FC\u30B8 / " +
        mins +
        "\u5206)";
    } else {
      statusLine =
        "\n\u{1F534} \u30BB\u30C3\u30B7\u30E7\u30F3\u306A\u3057";
    }

    await ctx.reply(
      "\u{1F916} <b>AI Session Bridge</b>" +
        statusLine +
        "\n\n" +
        "<b>\u30BB\u30C3\u30B7\u30E7\u30F3\u958B\u59CB:</b>\n" +
        "/ai claude \u2014 \u{1F9E0} Claude Opus 4.5\n" +
        "/ai gemini \u2014 \u{1F52E} Gemini 2.5 Pro\n" +
        "/ai gpt \u2014 \u{1F4AC} ChatGPT 5.2\n\n" +
        "<b>\u64CD\u4F5C:</b>\n" +
        "/ai end \u2014 \u30BB\u30C3\u30B7\u30E7\u30F3\u7D42\u4E86\n" +
        "/ai status \u2014 \u73FE\u5728\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u60C5\u5831\n\n" +
        "\u{1F4A1} \u30BB\u30C3\u30B7\u30E7\u30F3\u4E2D\u306F\u30E1\u30C3\u30BB\u30FC\u30B8\u304C\u76F4\u63A5AI\u306B\u9001\u3089\u308C\u307E\u3059\n" +
        "\u{1F4A1} Claude/Gemini\u306FM1\u4E0A\u3067\u76F4\u63A5\u30D5\u30A1\u30A4\u30EB\u7DE8\u96C6\u30FB\u30B3\u30DE\u30F3\u30C9\u5B9F\u884C\u53EF\u80FD",
      { parse_mode: "HTML" },
    );
    return;
  }

  switch (subcommand) {
    case "claude":
    case "gemini":
    case "gpt": {
      const ai = subcommand as AIBackend;
      const info = AI_INFO[ai];

      // 既存セッションチェック
      if (hasActiveSession(userId!)) {
        const current = getSession(userId!)!;
        const currentInfo = AI_INFO[current.ai];

        if (current.ai === ai) {
          await ctx.reply(
            currentInfo.emoji +
              " " +
              currentInfo.name +
              "\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u304C\u65E2\u306B\u30A2\u30AF\u30C6\u30A3\u30D6\u3067\u3059\u3002\n" +
              "\u305D\u306E\u307E\u307E\u30E1\u30C3\u30BB\u30FC\u30B8\u3092\u9001\u3063\u3066\u304F\u3060\u3055\u3044\u3002",
          );
        } else {
          await ctx.reply(
            "\u26A0\uFE0F " +
              currentInfo.emoji +
              " " +
              currentInfo.name +
              "\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u304C\u30A2\u30AF\u30C6\u30A3\u30D6\u3067\u3059\u3002\n" +
              "\u5148\u306B /ai end \u3057\u3066\u304B\u3089\u5207\u308A\u66FF\u3048\u3066\u304F\u3060\u3055\u3044\u3002",
          );
        }
        return;
      }

      const session = startSession(userId!, ai);

      let capNote = "";
      if (ai === "claude" || ai === "gemini") {
        capNote =
          "\n\n\u{1F527} <b>\u3067\u304D\u308B\u3053\u3068:</b>\n" +
          "\u30FB\u30D5\u30A1\u30A4\u30EB\u306E\u8AAD\u307F\u66F8\u304D\u30FB\u4FEE\u6B63\n" +
          "\u30FBbun test \u7B49\u306E\u30B3\u30DE\u30F3\u30C9\u5B9F\u884C\n" +
          "\u30FBgit commit / diff / status\n" +
          "\u30FB\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u5168\u4F53\u306E\u7406\u89E3\uFF08" +
          (ai === "claude" ? "CLAUDE.md" : "GEMINI.md") +
          "\u81EA\u52D5\u8AAD\u307F\u8FBC\u307F\uFF09";
      } else {
        capNote =
          "\n\n\u{1F4AC} \u76F8\u8AC7\u30FB\u30EC\u30D3\u30E5\u30FC\u30FB\u30A2\u30A4\u30C7\u30A2\u51FA\u3057\u5C02\u7528\n" +
          "\uFF08\u30D5\u30A1\u30A4\u30EB\u64CD\u4F5C\u306F\u3067\u304D\u307E\u305B\u3093\uFF09";
      }

      await ctx.reply(
        info.emoji +
          " <b>" +
          info.name +
          " \u30BB\u30C3\u30B7\u30E7\u30F3\u958B\u59CB</b>" +
          capNote +
          "\n\n\u{1F4DD} \u3053\u308C\u4EE5\u964D\u306E\u30E1\u30C3\u30BB\u30FC\u30B8\u306F\u76F4\u63A5" +
          info.name +
          "\u306B\u9001\u3089\u308C\u307E\u3059\u3002\n" +
          "\u7D42\u4E86: /ai end",
        { parse_mode: "HTML" },
      );
      return;
    }

    case "end": {
      if (!hasActiveSession(userId!)) {
        await ctx.reply(
          "\u274C \u30A2\u30AF\u30C6\u30A3\u30D6\u306A\u30BB\u30C3\u30B7\u30E7\u30F3\u304C\u3042\u308A\u307E\u305B\u3093",
        );
        return;
      }

      const ended = endSession(userId!)!;
      const info = AI_INFO[ended.ai];
      const duration = Math.round(
        (Date.now() - ended.startedAt) / 1000 / 60,
      );

      await ctx.reply(
        info.emoji +
          " <b>" +
          info.name +
          " \u30BB\u30C3\u30B7\u30E7\u30F3\u7D42\u4E86</b>\n" +
          "\u{1F4CA} " +
          ended.messageCount +
          "\u30E1\u30C3\u30BB\u30FC\u30B8 / " +
          duration +
          "\u5206\n\n" +
          "\u901A\u5E38\u306EJarvis\u30E2\u30FC\u30C9\u306B\u623B\u308A\u307E\u3057\u305F\u3002",
        { parse_mode: "HTML" },
      );
      return;
    }

    case "status": {
      if (!hasActiveSession(userId!)) {
        await ctx.reply(
          "\u{1F4A4} \u30A2\u30AF\u30C6\u30A3\u30D6\u306A\u30BB\u30C3\u30B7\u30E7\u30F3\u306A\u3057\n" +
            "/ai claude|gemini|gpt \u3067\u958B\u59CB",
        );
        return;
      }

      const session = getSession(userId!)!;
      const info = AI_INFO[session.ai];
      const duration = Math.round(
        (Date.now() - session.startedAt) / 1000 / 60,
      );

      await ctx.reply(
        "\u{1F7E2} <b>\u30A2\u30AF\u30C6\u30A3\u30D6\u30BB\u30C3\u30B7\u30E7\u30F3</b>\n\n" +
          info.emoji +
          " " +
          info.name +
          "\n" +
          "\u{1F4CA} " +
          session.messageCount +
          "\u30E1\u30C3\u30BB\u30FC\u30B8 / " +
          duration +
          "\u5206\n" +
          "\u{1F4C1} \u4F1A\u8A71\u5C65\u6B74: " +
          session.history.length +
          "\u30A8\u30F3\u30C8\u30EA",
        { parse_mode: "HTML" },
      );
      return;
    }

    default:
      await ctx.reply(
        "\u274C \u4E0D\u660E\u306A\u30B5\u30D6\u30B3\u30DE\u30F3\u30C9: " +
          subcommand +
          "\n/ai \u3067\u4F7F\u3044\u65B9\u3092\u78BA\u8A8D",
      );
  }
}
