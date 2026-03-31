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

  const prompt = `あなたはNightly Agent。DJは朝3時に起きてTelegramでこのレポートを読む。
技術者ではない経営者にも分かる言葉で書け。ファイルは絶対に変更するな。

以下を順番に実行:
1. bun test 実行
2. git status --short と git log --oneline -3
3. src/handlers/ 内のTODO/FIXME検索
4. コードベースを読んで改善提案を1つ考える（diffフォーマットで、適用はしない）

報告フォーマット（この通りに出力）:

🌙 おはよう DJ

【健康状態】✅ or ❌
テスト結果とシステム状態を1行で。問題なければ「全部正常」。

【DJアクション】
DJが何かすべきことがあれば書く。なければ「なし」。

【改善アイデア】
何が問題で、直すと何が良くなるか、を2-3行で。
技術的なdiffはその下に折りたたみ風に添える。
DJが「やって」と返信すれば次のセッションで実装される。

日本語で、短く、分かりやすく。`;

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
