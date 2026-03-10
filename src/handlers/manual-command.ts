/**
 * /manual command handler - Claude Code autonomous manual generation
 *
 * Usage:
 *   /manual M1308 ベーコン原木をハーフカットする装置
 *   /manual M1308  (description auto-detected from project folder)
 *
 * Flow: /manual → Claude Code spawn → generate-manual.sh (3-phase) → Telegram notify
 */

import type { Context } from "grammy";
import { exec } from "child_process";
import { isAuthorized } from "../security";
import { ALLOWED_USERS } from "../config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const REPO_DIR =
  process.env.REPO_DIR ||
  resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function buildManualPrompt(
  deviceNumber: string,
  description: string
): string {
  const descSection = description
    ? `装置概要: ${description}`
    : `装置概要は未指定。以下の順で自動取得:
1. Dropboxプロジェクトフォルダ内の「装置概要.txt」
2. フォルダ名から推測（例: M1308_伊藤ハム_ベーコンカッター → ベーコンカッター）
3. 部品表や図面から推測`;

  return `装置 ${deviceNumber} の取扱説明書を自動生成せよ。

${descSection}

【実行手順】
1. Dropbox内から ${deviceNumber}_ で始まるプロジェクトフォルダを特定
   検索: ls "/Users/daijiromatsuokam1/Machinelab Dropbox/Matsuoka Daijiro/${deviceNumber}_"*
2. 装置概要を確定（上記の優先順位で取得）
3. 実行: bash scripts/generate-manual.sh ${deviceNumber} "確定した装置概要"
4. 生成結果の確認:
   - /tmp/manual-${deviceNumber}/ 内のファイルチェック
   - content.md が500bytes以上あること
   - Docxファイルが正常に生成されたこと
5. エラー時は原因分析→修正→再試行（最大2回）
6. 完了報告: Docxパス、サイズ、章構成の概要

【制約】
- 従量課金API使用禁止（CLI経由のみ）
- Phase 2のClaude CLIは generate-manual.sh 内で自動実行される
- 結果はDropboxプロジェクトフォルダに自動コピーされる

【トラブルシュート】
- openpyxlがない → pip3 install openpyxl
- docxモジュールがない → cd scripts && npm install docx (ローカル)
- Claude CLI失敗 → /tmp/manual-${deviceNumber}/claude-stderr.log を確認
- .cjsが動かない → package.jsonの"type":"module"環境では.cjs必須`;
}

export async function handleManual(ctx: Context): Promise<void> {
  if (!isAuthorized(ctx.from?.id, ALLOWED_USERS)) return;

  const text = ctx.message?.text || "";
  const args = text.replace(/^\/manual\s*/, "").trim();

  if (!args) {
    await ctx.reply(
      [
        "📖 マニュアル自動生成",
        "",
        "Usage: /manual <装置番号> [装置概要]",
        "",
        "例:",
        "  /manual M1308 ベーコン原木をハーフカットする装置",
        "  /manual M1308  (概要は自動検出)",
        "",
        "Claude Codeが3フェーズを自律実行:",
        "  Phase 1: 素材収集 (collect-materials.py)",
        "  Phase 2: AI生成 (Claude CLI)",
        "  Phase 3: Docx変換 (generate-docx.cjs)",
      ].join("\n")
    );
    return;
  }

  // Parse: first token = device number, rest = description
  const tokens = args.split(/\s+/);
  const deviceNumber = tokens[0]!.toUpperCase();
  const description = tokens.slice(1).join(" ");

  // Validate device number format (M + digits)
  if (!/^M\d+$/.test(deviceNumber)) {
    await ctx.reply(
      `⚠️ 装置番号の形式が不正: ${deviceNumber}\nM + 数字で指定 (例: M1308)`
    );
    return;
  }

  const descLabel = description || "自動検出";
  await ctx.reply(
    [
      `📖 マニュアル生成開始: ${deviceNumber}`,
      `📋 概要: ${descLabel}`,
      `⏱ Phase 1-3を自律実行中（数分〜10分）`,
      `完了時にStop hookで通知します`,
    ].join("\n")
  );

  const prompt = buildManualPrompt(deviceNumber, description);
  const logFile = `/tmp/claude-code-manual-${deviceNumber}.log`;

  // Spawn Claude Code as independent process (nohup prevents SIGTERM cascade)
  const cmd = `cd ${REPO_DIR} && nohup claude -p --dangerously-skip-permissions ${JSON.stringify(prompt)} > ${logFile} 2>&1 & echo $!`;

  exec(
    cmd,
    {
      shell: "/bin/zsh",
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:${process.env.PATH}`,
      },
    },
    async (err, stdout) => {
      const pid = stdout?.trim();
      if (err || !pid) {
        await ctx.reply(`❌ Claude Code起動失敗: ${err?.message || "unknown"}`);
        return;
      }
      await ctx.reply(
        [
          `✅ Claude Code spawned (PID: ${pid})`,
          `📝 ログ: ${logFile}`,
          `🛑 停止: kill ${pid}`,
        ].join("\n")
      );
    }
  );
}
