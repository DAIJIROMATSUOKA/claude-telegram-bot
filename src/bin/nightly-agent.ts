/**
 * Nightly Agent - Autonomous code analysis + improvement proposals
 * Runs via LaunchAgent at 23:00 JST, sends results to Telegram
 * READ-ONLY: no file modifications, proposals only
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

const CWD = (process.env.HOME || "/Users/daijiromatsuokam1") + "/claude-telegram-bot";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_ALLOWED_USERS || "";

async function sendTelegram(text: string) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("[Nightly] No Telegram config, printing:", text);
    return;
  }
  const chunks = [];
  for (let i = 0; i < text.length; i += 4000) {
    chunks.push(text.substring(i, i + 4000));
  }
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: chunk }),
    }).catch(e => console.error("[Nightly] Telegram error:", e));
  }
}

async function main() {
  const start = Date.now();
  console.log("[Nightly Agent] Starting...");

  const prompt = `あなたはNightly Agent。深夜の自動コード分析・改善提案を行う。
ファイルは絶対に変更するな（Read-Only）。

以下を順番に実行し、最後にまとめて報告:

1. テスト実行: bun test を実行し、pass/fail数を報告
2. git状態: git status --short と git log --oneline -3 で未コミット・未push確認
3. ドキュメント鮮度: docs/FEATURE-CATALOG.md と docs/DESIGN-RULES.md のgit log最終更新日
4. コード品質: src/handlers/ 内のTODO/FIXME/HACK コメントを検索
5. 改善提案: コードベースを読んで具体的な改善提案を1つ。diffフォーマットで提示（適用はしない）

報告フォーマット:
🌙 Nightly Agent Report

[テスト] ✅/❌ N passed, M failed
[Git] 未コミット: N files / 未push: N commits
[Docs] FEATURE-CATALOG: YYYY-MM-DD / DESIGN-RULES: YYYY-MM-DD
[品質] TODO: N件, FIXME: N件
[提案] タイトル
  理由: ...
  diff: ...

簡潔に。`;

  try {
    const messages: any[] = [];
    for await (const msg of query({
      prompt,
      options: {
        cwd: CWD,
        allowedTools: ["Read", "Grep", "Glob", "Bash"],
        permissionMode: "bypassPermissions",
        maxTurns: 15,
        settingSources: ["user", "project"],
      },
    })) {
      messages.push(msg);
    }

    const resultMsg = messages.find((m: any) => m.type === "result");
    const elapsed = Math.round((Date.now() - start) / 1000);
    const cost = resultMsg?.total_cost_usd?.toFixed(3) || "?";
    const report = resultMsg?.result || "(no result)";

    const fullReport = `${report}\n\n⏱ ${elapsed}s | $${cost}`;
    console.log(fullReport);
    await sendTelegram(fullReport);
  } catch (error: any) {
    const errMsg = `❌ Nightly Agent 失敗\n${error.message}`;
    console.error(errMsg);
    await sendTelegram(errMsg);
  }
}

main().catch(console.error);
