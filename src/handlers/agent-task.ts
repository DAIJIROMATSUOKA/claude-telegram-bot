/**
 * Agent Task Handler - Runs Claude Agent SDK inside Jarvis
 * Triggered by [AGENT] prefix in Telegram messages
 * croppy sends lightweight trigger → Jarvis runs heavy AI work in-process
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Api } from "grammy";

const MAX_TURNS = 15;
const CWD = (process.env.HOME || "/Users/daijiromatsuokam1") + "/claude-telegram-bot";

interface AgentResult {
  success: boolean;
  result: string;
  turns: number;
  cost: number;
  durationMs: number;
  sessionId?: string;
}

export async function handleAgentTask(
  taskPrompt: string,
  chatId: number,
  api: Api,
): Promise<AgentResult> {
  const preview = taskPrompt.substring(0, 100).replace(/\n/g, " ");
  const statusMsg = await api.sendMessage(chatId, `🤖 Agent Task 実行中...\n${preview}`);

  const start = Date.now();

  try {
    const messages: any[] = [];
    for await (const msg of query({
      prompt: taskPrompt,
      options: {
        cwd: CWD,
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permissionMode: "acceptEdits",
        maxTurns: MAX_TURNS,
        settingSources: ["user", "project"],
      },
    })) {
      messages.push(msg);
    }

    const resultMsg = messages.find((m: any) => m.type === "result");
    const elapsed = Date.now() - start;
    const result: AgentResult = {
      success: !resultMsg?.is_error,
      result: resultMsg?.result || "(no result)",
      turns: resultMsg?.num_turns || 0,
      cost: resultMsg?.total_cost_usd || 0,
      durationMs: elapsed,
      sessionId: resultMsg?.session_id,
    };

    const status = result.success ? "✅" : "⚠️";
    const summary = result.result.substring(0, 3500);
    const text = [
      `${status} Agent Task 完了`,
      `Turns: ${result.turns} | Cost: $${result.cost.toFixed(3)} | Time: ${Math.round(elapsed / 1000)}s`,
      ``,
      summary,
    ].join("\n");

    await api.editMessageText(chatId, statusMsg.message_id, text).catch(() =>
      api.sendMessage(chatId, text),
    );

    return result;
  } catch (error: any) {
    const elapsed = Date.now() - start;
    const errText = `❌ Agent Task 失敗 (${Math.round(elapsed / 1000)}s)\n${error.message || error}`;
    await api.editMessageText(chatId, statusMsg.message_id, errText).catch(() =>
      api.sendMessage(chatId, errText),
    );
    return { success: false, result: error.message, turns: 0, cost: 0, durationMs: elapsed };
  }
}
