/**
 * Phase 0 統一通知transport — verified `scripts/notify.sh` を spawn する薄いTSラッパー。
 * 配信ログ(logs/notify.log) / 失敗時リトライキュー / transport差替(NOTIFY_TRANSPORT) を共有。
 *
 * ⚠️ 対象 = outbound 通知のみ。inline_keyboard 付きのインタラクティブ送信(bridges等)は
 *   UI であり transport統一の対象外 → 直 sendMessage のまま bot/bridge 側に残す。
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const NOTIFY = join(homedir(), "claude-telegram-bot", "scripts", "notify.sh");

export interface NotifyOpts {
  parse?: "HTML" | "Markdown";
  button?: boolean; // 🗑削除ボタン(bot callback依存。既定オフ)
  tag?: string; // 配信ログ用タグ
}

/** 統一transport経由で通知を送る。解決した終了コードを返す(0=成功)。 */
export function notify(text: string, opts: NotifyOpts = {}): Promise<number> {
  const args = [text];
  if (opts.button) args.push("--button");
  if (opts.parse) args.push("--parse", opts.parse);
  args.push("--tag", opts.tag ?? "ts");
  return new Promise((resolve) => {
    const p = spawn(NOTIFY, args, { stdio: "ignore" });
    p.on("close", (code) => resolve(code ?? 0));
    p.on("error", () => resolve(1));
  });
}
