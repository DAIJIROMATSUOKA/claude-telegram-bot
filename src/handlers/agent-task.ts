/**
 * Agent Task Handler - Runs Claude Agent SDK inside Jarvis
 * Two modes:
 *   "read"    → Read/Glob/Grep only, no file writes or bash. For bootstrap, investigation, summaries.
 *   "execute" → Full tool access. For implementation, fixes, deployments.
 */
import { createLogger } from "../utils/logger";
const log = createLogger("agent-task");

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Api } from "grammy";

export type AgentMode = "read" | "execute";

const CWD = (process.env.HOME || "/Users/daijiromatsuokam1") + "/claude-telegram-bot";

const MODE_PRESETS: Record<AgentMode, {
  allowedTools: string[];
  disallowedTools: string[];
  systemPrompt: string;
  maxTurns: number;
  permissionMode: "acceptEdits" | "default" | "dontAsk";
}> = {
  read: {
    allowedTools: ["Read", "Glob", "Grep"],
    disallowedTools: ["Write", "Edit", "Bash"],
    systemPrompt: "You are a read-only assistant. Read the requested files and return a concise summary. Do not attempt to modify anything.",
    maxTurns: 10,
    permissionMode: "dontAsk",
  },
  execute: {
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    disallowedTools: [],
    systemPrompt: "",
    maxTurns: 15,
    permissionMode: "acceptEdits",
  },
};

interface AgentResult {
  success: boolean;
  result: string;
  turns: number;
  cost: number;
  durationMs: number;
  sessionId?: string;
}

/**
 * Extract result text from SDK messages.
 * SDKResultMessage has two variants:
 *   subtype "success"         → result: string
 *   subtype "error_max_turns" → errors: string[], no result field
 * Fallback: last assistant message text blocks.
 */
function extractResult(messages: any[]): { text: string; success: boolean; turns: number; cost: number; sessionId?: string } {
  const resultMsg = messages.find((m: any) => m.type === "result");

  let text = "";
  let success = true;

  if (resultMsg) {
    if (resultMsg.subtype === "success") {
      text = resultMsg.result || "";
    } else {
      // error_max_turns, error_during_execution, error_max_budget_usd, etc.
      success = false;
      text = (resultMsg.errors || []).join("\n");
    }
  }

  // Fallback: last assistant text blocks (common when maxTurns hit mid-response)
  if (!text) {
    const assistantMsgs = messages.filter((m: any) => m.type === "assistant");
    for (let i = assistantMsgs.length - 1; i >= 0; i--) {
      const content = assistantMsgs[i].message?.content || [];
      const textBlocks = content.filter((b: any) => b.type === "text");
      const combined = textBlocks.map((b: any) => b.text).join("\n").trim();
      if (combined) {
        text = combined;
        break;
      }
    }
  }

  if (!text) text = "(no result)";

  return {
    text,
    success,
    turns: resultMsg?.num_turns || 0,
    cost: resultMsg?.total_cost_usd || 0,
    sessionId: resultMsg?.session_id,
  };
}

export async function handleAgentTask(
  taskPrompt: string,
  chatId: number,
  api: Api,
  mode: AgentMode = "execute",
  silent = false,
  timeoutMs?: number,
): Promise<AgentResult> {
  const preset = MODE_PRESETS[mode];
  const modeLabel = mode === "read" ? "📖" : "🤖";

  // silent=true: no Telegram notifications (used by HTTP endpoint / exec bridge)
  let statusMsgId: number | null = null;
  if (!silent) {
    const preview = taskPrompt.substring(0, 100).replace(/\n/g, " ");
    const statusMsg = await api.sendMessage(chatId, `${modeLabel} Agent Task (${mode})...\n${preview}`);
    statusMsgId = statusMsg.message_id;
  }

  const start = Date.now();

  try {
    const messages: any[] = [];
    // AbortController to kill SDK process on timeout
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => {
      abortController.abort();
      log.error("[AgentTask] Timeout: aborting SDK process");
    }, (timeoutMs ?? 720000) - 5000); // 5s before HTTP timeout
    try {
    for await (const msg of query({
      prompt: taskPrompt,
      options: {
        cwd: CWD,
        allowedTools: preset.allowedTools,
        disallowedTools: preset.disallowedTools,
        ...(preset.systemPrompt ? { systemPrompt: preset.systemPrompt } : {}),
        permissionMode: preset.permissionMode,
        maxTurns: preset.maxTurns,
        settingSources: ["user", "project"],
        model: "claude-opus-4-6",
        abortController,
      },
    })) {
      messages.push(msg);
    }
    } finally {
      clearTimeout(abortTimer);
    }

    const extracted = extractResult(messages);
    const elapsed = Date.now() - start;

    const result: AgentResult = {
      success: extracted.success,
      result: extracted.text,
      turns: extracted.turns,
      cost: extracted.cost,
      durationMs: elapsed,
      sessionId: extracted.sessionId,
    };

    if (!silent && statusMsgId !== null) {
      const status = result.success ? "✅" : "⚠️";
      const summary = result.result.substring(0, 3500);
      const text = [
        `${status} Agent (${mode}) 完了`,
        `Turns: ${result.turns} | Cost: $${result.cost.toFixed(3)} | Time: ${Math.round(elapsed / 1000)}s`,
        ``,
        summary,
      ].join("\n");
      await api.editMessageText(chatId, statusMsgId, text).catch(() =>
        api.sendMessage(chatId, text),
      );
    }

    return result;
  } catch (error: any) {
    const elapsed = Date.now() - start;
    if (!silent && statusMsgId !== null) {
      const errText = `❌ Agent (${mode}) 失敗 (${Math.round(elapsed / 1000)}s)\n${error.message || error}`;
      await api.editMessageText(chatId, statusMsgId, errText).catch(() =>
        api.sendMessage(chatId, errText),
      );
    }
    return { success: false, result: error.message, turns: 0, cost: 0, durationMs: elapsed };
  }
}
