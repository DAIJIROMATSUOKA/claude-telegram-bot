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
  sendToSession,
  saveSessionState,
  splitTelegramMessage,
  AI_INFO,
  type AIBackend,
} from "../utils/session-bridge";
import { startTypingIndicator } from "../utils";

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

      // 既存セッションがあれば自動終了してから新規開始
      if (hasActiveSession(userId!)) {
        const prev = endSession(userId!)!;
        const prevInfo = AI_INFO[prev.ai];
        const duration = Math.round(
          (Date.now() - prev.startedAt) / 1000 / 60,
        );
        await ctx.reply(
          prevInfo.emoji +
            " " +
            prevInfo.name +
            " \u30BB\u30C3\u30B7\u30E7\u30F3\u81EA\u52D5\u7D42\u4E86 (" +
            prev.messageCount +
            "\u30E1\u30C3\u30BB\u30FC\u30B8 / " +
            duration +
            "\u5206)",
        );
      }

      const newSession = startSession(userId!, ai);

      // インラインメッセージ: /ai claude 本文 → セッション開始+即処理
      const inlineMessage = args.slice(1).join(" ").trim();

      await ctx.reply(
        info.emoji + " <b>" + info.name + " \u30BB\u30C3\u30B7\u30E7\u30F3\u958B\u59CB</b>",
        { parse_mode: "HTML" },
      );

      // インラインメッセージがあれば即座に処理
      if (inlineMessage) {
        const _typing = startTypingIndicator(ctx);
        try {
          const aiResponse = await sendToSession(userId!, inlineMessage);
          _typing.stop();
          const chunks = splitTelegramMessage(aiResponse);
          for (const chunk of chunks) {
            await ctx.reply(chunk);
          }
        } catch (e) {
          _typing.stop();
          const errMsg = e instanceof Error ? e.message : String(e);
          await ctx.reply("\u274C AI Session Error: " + errMsg);
        }
      }
      return;
    }

    case "end": {
      if (!hasActiveSession(userId!)) {
        await ctx.reply(
          "\u274C \u30A2\u30AF\u30C6\u30A3\u30D6\u306A\u30BB\u30C3\u30B7\u30E7\u30F3\u304C\u3042\u308A\u307E\u305B\u3093",
        );
        return;
      }

      // セッション情報を取得（endSession前に）
      const sessionToSave = getSession(userId!)!;

      // CLAUDE.mdに状態を自動保存（バックグラウンド、失敗しても続行）
      await ctx.reply("💾 セッション記憶を保存中...");
      await saveSessionState(sessionToSave);

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
          "\u5206\n" +
          "💾 セッション記憶をCLAUDE.mdに保存済み\n\n" +
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
