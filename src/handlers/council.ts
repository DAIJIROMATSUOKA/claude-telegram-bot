/**
 * Council Debate Handler — 3AI評議会
 *
 * /debate <テーマ> — Claude/Gemini/ChatGPTが衝突→統合→最終案
 * /gpt <質問>     — ChatGPT直接
 * /gem <質問>     — Gemini直接
 *
 * 従量課金API不使用。全てCLI/Shortcuts経由。
 */

import type { Context } from "grammy";
import { ALLOWED_USERS } from "../config";
import { isAuthorized } from "../security";
import {
  askClaude,
  askGemini,
  askChatGPT,
  type AIResponse,
} from "../utils/multi-ai";

// ========================================
// Telegram Formatting Utilities
// ========================================

const TG_LIMIT = 4096;

function escHtml(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clip(text: string, limit = TG_LIMIT): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 20) + "\n\n...(truncated)";
}

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1) + "s";
}

async function safeEditMessageText(
  ctx: Context,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  try {
    await ctx.api.editMessageText(chatId, messageId, text, {
      parse_mode: "HTML",
    });
  } catch (e: any) {
    // Log error or handle silently as per current behavior
    console.error("Failed to edit message:", e);
  }
}

// ========================================
// Council Debate Types & Config
// ========================================

type CouncilRole = "disruptor" | "realist" | "humanizer";

interface RoleConfig {
  prompt: string;
  askFn: (prompt: string, timeout?: number) => Promise<AIResponse>;
  label: string;
}

// Prompts for each AI role
const PROMPT_DISRUPTOR =
  "あなたは Disruptor（破壊者）。\n" +
  "常識を壊す。遠慮禁止。突き抜けた案を出せ。\n" +
  "ただし最後は「次の一手」が具体的であること。";

const PROMPT_REALIST =
  "あなたは Realist（現実主義者）。\n" +
  "リスク・制約・工数・運用破綻を容赦なく指摘し、成立させる道筋を出せ。";

const PROMPT_HUMANIZER =
  "あなたは Humanizer（人間化担当）。\n" +
  "ユーザー体験・現場の運用・継続性・心理的ハードルを最優先に改善案を出せ。";

const ROLES: Record<CouncilRole, RoleConfig> = {
  disruptor: {
    prompt: PROMPT_DISRUPTOR,
    askFn: askClaude,
    label: "Disruptor",
  },
  realist: {
    prompt: PROMPT_REALIST,
    askFn: askGemini,
    label: "Realist",
  },
  humanizer: {
    prompt: PROMPT_HUMANIZER,
    askFn: askChatGPT,
    label: "Humanizer",
  },
};

const ROLE_ORDER: CouncilRole[] = ["disruptor", "realist", "humanizer"];

// UI Message Constants
const MSG_DEBATE_TITLE = "\u{1F3DB}\u{FE0F} <b>Council Debate</b>";
const MSG_THINKING = "\u{1F914} thinking...";
const MSG_ALL_AI_FAILED = "\u5168AI\u304C\u5FDC\u7B54\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002";
const MSG_UNKNOWN_ERROR_SUFFIX = ": ";
const MSG_DEBATE_INIT = "\u{1F3DB}\u{FE0F} <b>Council Debate</b>\n\n\u8A55\u8B70\u4F1A\u3092\u8D77\u52D5\u4E2D...";
const MSG_DEBATE_ERROR = "\u274C \u8A55\u8B70\u4F1A\u30A8\u30E9\u30FC: ";
const MSG_UNAUTHORIZED = "Unauthorized.";
const MSG_USAGE_DEBATE =
  `${MSG_DEBATE_TITLE}\n\n` +
  "Usage: /debate <\u30C6\u30FC\u30DE>\n" +
  "\u4F8B: /debate Jarvis\u306E\u6B21\u306E\u9032\u5316\u65B9\u5411\u306F\uFF1F\n\n" +
  "\u{1F9E0} Claude (Disruptor)\n" +
  "\u{1F52E} Gemini (Realist)\n" +
  "\u{1F4AC} ChatGPT (Humanizer)\n\n" +
  "3AI\u304C\u63D0\u6848\u2192\u6279\u5224\u2192\u5408\u610F\u5F62\u6210\u3092\u884C\u3044\u307E\u3059";
const MSG_USAGE_DIRECT_AI = (cmdName: string) => `Usage: /${cmdName} <\u8CEA\u554F>`;


// Round 1 (Generate)
const R1_PROMPT_TEMPLATE = `
テーマ: "{topic}"

以下のテンプレートで出力:
- 提案タイトル
- 要点（3つ）
- 実行手順（5ステップ）
- 最大リスク（1つ）
- その回避策（1つ）`;
const MSG_R1_PROGRESS = "\u{1F4DD} Round 1/3: 3AI\u304C\u63D0\u6848\u3092\u751F\u6210\u4E2D...";

// Round 2 (Critique)
const R2_PROMPT_TEMPLATE = `
テーマ: "{topic}"
他者の提案:
{r1Summary}

あなたの役割で:
1) 良い点（2つ）
2) 致命的な穴（2つ）
3) 改良案（2つ）`;
const MSG_R2_PROGRESS = (r1SuccessCount: number) =>
  `\u2705 Round 1: ${r1SuccessCount}AI\u53C2\u52A0\n` +
  "\u2694\uFE0F Round 2/3: \u76F8\u4E92\u6279\u5224\u4E2D...";

// Round 3 (Synthesis)
const SYNTHESIS_PROMPT_TEMPLATE =
  "\u3042\u306A\u305F\u306F\u8A55\u8B70\u4F1A\u306E\u8B70\u9577。\n" +
  "\u4EE5\u4E0B\u306E3\u8005\u306E\u63D0\u6848\u3068\u6279\u5224\u3092\u7D71\u5408\u3057\u300C\u5B9F\u884C\u53EF\u80FD\u306A\u6700\u7D42\u6848\u300D\u306B\u307E\u3068\u3081\u308D\u3002\n\n" +
  "\u30C6\u30FC\u30DE: \"{topic}\"\n\n" +
  "{allRoundsText}\n\n" +
  "\u51FA\u529B\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8:\n" +
  "\u3010\u5408\u610F\u70B9\u3011\u7B87\u6761\u66F8\u304D3\u3064\n" +
  "\u3010\u4E0D\u5408\u610F\u70B9\u3011\u7B87\u6761\u66F8\u304D3\u3064\u3008\u6B8B\u3059\u7406\u7531\u3082\u3009\n" +
  "\u3010\u6700\u7D42\u63D0\u6848\u3011\u76EE\u7684\u2192\u8A2D\u8A08\u2192\u904B\u7528\u2192\u6B21\u306E\u4E00\u624B\n" +
  "\u3010\u6B21\u306E24\u6642\u9593TODO\u30115\u3064";
const MSG_R3_PROGRESS = (r1SuccessCount: number, r2SuccessCount: number) =>
  `\u2705 Round 1: ${r1SuccessCount}\u53C2\u52A0\n` +
  `\u2705 Round 2: ${r2SuccessCount}\u6279\u5224\n` +
  "\u{1F91D} Round 3/3: \u5408\u610F\u5F62\u6210\u2192\u6700\u7D42\u6848\u3092\u751F\u6210\u4E2D...";

// Telegram Output Formatting
const MSG_R1_SECTION_TITLE = "<b>\u{1F4DD} Round 1: \u63D0\u6848</b>";
const MSG_R2_SECTION_TITLE = "<b>\u2694\uFE0F Round 2: \u6279\u5224</b>";
const MSG_TOTAL_TIME_PREFIX = "\u23F1 Total: ";
const MSG_SYNTHESIS_SECTION_TITLE = "<b>\u{1F91D} \u6700\u7D42\u63D0\u6848</b>";
const MSG_SYNTHESIS_FAILED = "\u274C \u5408\u610F\u5F62\u6210\u5931\u6557: ";
const MSG_FALLBACK_R1_TITLE = "<b>\u{1F4A1} Fallback: Round 1\u63D0\u6848</b>";


// ========================================
// Council Debate Core Logic
// ========================================

interface RoundEntry {
  role: CouncilRole;
  response: AIResponse;
}

interface DebateResult {
  topic: string;
  round1: RoundEntry[];
  round2: RoundEntry[];
  synthesis: AIResponse;
  totalTime: number;
}

async function runCouncilDebate(
  topic: string,
  onProgress: (msg: string) => Promise<void>,
): Promise<DebateResult> {
  const debateStart = Date.now();

  // ──────────────────────────────
  // Round 1: Generate（3AI並列）
  // ──────────────────────────────
  await onProgress(
    MSG_DEBATE_TITLE + "\n\n" +
    "\u{1F4CB} " + escHtml(topic) + "\n\n" +
    MSG_R1_PROGRESS
  );

  const r1Prompt = (role: CouncilRole, topic: string): string =>
    ROLES[role].prompt + R1_PROMPT_TEMPLATE.replace("{topic}", topic);

  const r1Results = await Promise.allSettled(
    ROLE_ORDER.map((role) => ROLES[role].askFn(r1Prompt(role, topic), 120_000)),
  );

  const round1: RoundEntry[] = [];
  r1Results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      round1.push({ role: ROLE_ORDER[i], response: r.value });
    }
  });

  // 全員失敗チェック
  const r1Success = round1.filter((e) => !e.response.error);
  if (r1Success.length === 0) {
    const failInfo = round1
      .map((e) => e.response.backend + MSG_UNKNOWN_ERROR_SUFFIX + (e.response.error || "unknown"))
      .join(", ");
    return {
      topic,
      round1,
      round2: [],
      synthesis: {
        output: MSG_ALL_AI_FAILED + "\n" + failInfo,
        backend: "none",
        emoji: "\u274C",
        latency_ms: 0,
        error: "all_failed",
      },
      totalTime: Date.now() - debateStart,
    };
  }

  // ──────────────────────────────
  // Round 2: Critique（成功したAIのみ並列）
  // ──────────────────────────────
  const r1Summary = r1Success
    .map(
      (e) =>
        "\u3010" + ROLES[e.role].label + " / " + e.response.backend + "\u3011\n" +
        e.response.output,
    )
    .join("\n\n---\n\n");

  await onProgress(
    MSG_DEBATE_TITLE + "\n\n" +
    "\u{1F4CB} " + escHtml(topic) + "\n\n" +
    MSG_R2_PROGRESS(r1Success.length)
  );

  const r2Prompt = (role: CouncilRole): string =>
    ROLES[role].prompt + R2_PROMPT_TEMPLATE.replace("{topic}", topic).replace("{r1Summary}", r1Summary);

  const r2Results = await Promise.allSettled(
    r1Success.map((entry) => ROLES[entry.role].askFn(r2Prompt(entry.role), 120_000)),
  );

  const round2: RoundEntry[] = [];
  r2Results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      round2.push({ role: r1Success[i].role, response: r.value });
    }
  });

  const r2Success = round2.filter((e) => !e.response.error);

  // ──────────────────────────────
  // Round 3: Synthesis（Claude議長）
  // ──────────────────────────────
  await onProgress(
    MSG_DEBATE_TITLE + "\n\n" +
    "\u{1F4CB} " + escHtml(topic) + "\n\n" +
    MSG_R3_PROGRESS(r1Success.length, r2Success.length)
  );

  const allRoundsText: string[] = [];
  allRoundsText.push("\u3010Round1 \u63D0\u6848\u3011");
  for (const e of r1Success) {
    allRoundsText.push("[" + ROLES[e.role].label + "/" + e.response.backend + "]");
    allRoundsText.push(e.response.output);
    allRoundsText.push("");
  }
  if (r2Success.length > 0) {
    allRoundsText.push("\u3010Round2 \u6279\u5224\u30FB\u6539\u826F\u3011");
    for (const e of r2Success) {
      allRoundsText.push("[" + ROLES[e.role].label + "/" + e.response.backend + "]");
      allRoundsText.push(e.response.output);
      allRoundsText.push("");
    }
  }

  const synthPrompt = SYNTHESIS_PROMPT_TEMPLATE
    .replace("{topic}", topic)
    .replace("{allRoundsText}", allRoundsText.join("\n"));

  const synthesis = await askClaude(synthPrompt, 150_000);

  return {
    topic,
    round1,
    round2,
    synthesis,
    totalTime: Date.now() - debateStart,
  };
}

// ========================================
// Telegram Output Formatting
// ========================================

const PREVIEW_LIMIT_R1 = 250;
const PREVIEW_LIMIT_R2 = 150;
const PREVIEW_LIMIT_FALLBACK = 800;

function formatDebateOutput(result: DebateResult): string[] {
  const messages: string[] = [];

  // Message 1: Round 1 proposals (brief)
  const r1Lines: string[] = [];
  r1Lines.push(MSG_DEBATE_TITLE);
  r1Lines.push("\u{1F4CB} " + escHtml(result.topic));
  r1Lines.push("");
  r1Lines.push(MSG_R1_SECTION_TITLE);

  for (const e of result.round1) {
    const cfg = ROLES[e.role];
    if (e.response.error) {
      r1Lines.push(
        e.response.emoji + " <b>" + cfg.label + "</b> (" + e.response.backend + ") \u274C " + e.response.error,
      );
    } else {
      const preview = e.response.output.slice(0, PREVIEW_LIMIT_R1).replace(/\n/g, " ");
      r1Lines.push(
        e.response.emoji +
        " <b>" + cfg.label + "</b> (" + e.response.backend + ", " + formatSeconds(e.response.latency_ms) + ")",
      );
      r1Lines.push(escHtml(preview) + (e.response.output.length > PREVIEW_LIMIT_R1 ? "..." : ""));
    }
    r1Lines.push("");
  }

  // Round 2 brief
  const r2Success = result.round2.filter((e) => !e.response.error);
  if (r2Success.length > 0) {
    r1Lines.push(MSG_R2_SECTION_TITLE);
    for (const e of r2Success) {
      const cfg = ROLES[e.role];
      const preview = e.response.output.slice(0, PREVIEW_LIMIT_R2).replace(/\n/g, " ");
      r1Lines.push(
        e.response.emoji +
        " <b>" + cfg.label + "</b> (" + e.response.backend + ", " + formatSeconds(e.response.latency_ms) + ")",
      );
      r1Lines.push(escHtml(preview) + (e.response.output.length > PREVIEW_LIMIT_R2 ? "..." : ""));
    }
    r1Lines.push("");
  }

  r1Lines.push(MSG_TOTAL_TIME_PREFIX + formatSeconds(result.totalTime));
  messages.push(clip(r1Lines.join("\n")));

  // Message 2: Final synthesis
  const synthLines: string[] = [];
  synthLines.push(MSG_SYNTHESIS_SECTION_TITLE);
  synthLines.push("");
  if (result.synthesis.error) {
    synthLines.push(MSG_SYNTHESIS_FAILED + escHtml(result.synthesis.error));

    // Fallback: show Round 1 proposals in full
    synthLines.push("");
    synthLines.push(MSG_FALLBACK_R1_TITLE);
    for (const e of result.round1.filter((x) => !x.response.error)) {
      synthLines.push("");
      synthLines.push(e.response.emoji + " <b>" + ROLES[e.role].label + "</b>");
      synthLines.push(escHtml(e.response.output.slice(0, PREVIEW_LIMIT_FALLBACK)));
    }
  } else {
    synthLines.push(escHtml(result.synthesis.output));
  }
  messages.push(clip(synthLines.join("\n")));

  return messages;
}

// ========================================
// Command Handlers
// ========================================

function getPromptFromCommand(ctx: Context, cmdName: string): string {
  const text =
    ctx.message && "text" in ctx.message ? ctx.message.text || "" : "";
  const prompt = text.replace(new RegExp("^/" + cmdName + "\\s*", "i"), "").trim();

  // Check reply
  const replyText =
    ctx.message?.reply_to_message && "text" in ctx.message.reply_to_message
      ? ctx.message.reply_to_message.text || ""
      : "";

  return prompt || replyText;
}

/**
 * /debate <テーマ> — 3AI評議会（Claude/Gemini/ChatGPT）
 */
export async function handleDebate(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(MSG_UNAUTHORIZED);
    return;
  }

  const topic = getPromptFromCommand(ctx, "debate");
  if (!topic) {
    await ctx.reply(MSG_USAGE_DEBATE, { parse_mode: "HTML" });
    return;
  }

  const chatId = ctx.chat!.id;
  const msg = await ctx.reply(MSG_DEBATE_INIT, { parse_mode: "HTML" });

  const onProgress = async (text: string) => {
    await safeEditMessageText(ctx, chatId, msg.message_id, text);
  };

  try {
    const result = await runCouncilDebate(topic, onProgress);
    const messages = formatDebateOutput(result);

    // Edit progress message to Round 1 summary
    await safeEditMessageText(ctx, chatId, msg.message_id, messages[0]);

    // Send synthesis as separate message
    if (messages[1]) {
      await ctx.reply(messages[1], { parse_mode: "HTML" });
    }
  } catch (e: any) {
    const errMsg =
      MSG_DEBATE_ERROR +
      escHtml(e?.message || String(e));
    await safeEditMessageText(ctx, chatId, msg.message_id, errMsg);
  }
}

/**
 * Direct AI command handler (shared logic)
 */
async function handleDirectAI(
  ctx: Context,
  askFn: (prompt: string, timeout?: number) => Promise<AIResponse>,
  cmdName: string,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply(MSG_UNAUTHORIZED);
    return;
  }

  const prompt = getPromptFromCommand(ctx, cmdName);
  if (!prompt) {
    await ctx.reply(MSG_USAGE_DIRECT_AI(cmdName));
    return;
  }

  const chatId = ctx.chat!.id;
  const msg = await ctx.reply(MSG_THINKING);

  try {
    const r = await askFn(prompt, 180_000);

    let output: string;
    if (r.error) {
      output = "\u274C " + r.backend + MSG_UNKNOWN_ERROR_SUFFIX + r.error;
    } else {
      output =
        r.emoji +
        " <b>" + r.backend + "</b> (" + formatSeconds(r.latency_ms) + ")\n\n" +
        escHtml(r.output);
    }

    await safeEditMessageText(ctx, chatId, msg.message_id, clip(output));
  } catch (e: any) {
    await safeEditMessageText(
      ctx,
      chatId,
      msg.message_id,
      "\u274C " + escHtml(e?.message || String(e)),
    );
  }
}

/**
 * /gpt <質問> — ChatGPT直接
 */
export async function handleAskGPT(ctx: Context): Promise<void> {
  await handleDirectAI(ctx, askChatGPT, "gpt");
}

/**
 * /gem <質問> — Gemini直接
 */
export async function handleAskGemini(ctx: Context): Promise<void> {
  await handleDirectAI(ctx, askGemini, "gem");
}
