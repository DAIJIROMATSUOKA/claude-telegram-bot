# Phase 0 — カットオーバー手順書(朝、DJレビュー後に実行)

_branch: phase0-tg-shrink / 前提: `PHASE0-AUDIT.md`。通知=Telegram残置確定。_
_⚠️ 各ステップは実機/`.env`必要(sandbox検証不可)。実行前に該当の実送信テストを。_

---
## 急所: notify-dj.sh を notify.sh の薄いラッパーにする(21呼出を一括移行)

`notify-dj.sh` を呼ぶスクリプトが **21本**(aerox-watch, croppy-pc-*, nightly-*, batch-runner-*, auto-kick-watchdog, croppy-bridge.ts 等)。
notify-dj.sh 1ファイルを wrapper 化するだけで、**全21本が自動で 統一transport(配信ログ+再送キュー+transport差替可)に乗る**。呼出元は無変更。

### 新 notify-dj.sh(後方互換: 🗑ボタン維持)
```bash
#!/bin/bash
# notify-dj.sh — backward-compat shim. 🗑ボタン付きTG通知 = notify.sh --button。
# 新規/無ボタンで良い通知は notify.sh を直接使う(H1: ghost button削減)。
exec "$(dirname "$0")/notify.sh" "${1:-🦞 作業完了}" --button ${2:+--parse "$2"} --tag notify-dj
```
- **テスト**: `bash scripts/notify-dj.sh "🦞 cutover test"` → TG着信 + `logs/notify.log` に `ok` 記録を確認。
- これが通れば21本は無変更で移行完了。

---
## 直 curl 11本の個別移行

| ファイル | 対処 |
|---|---|
| `scripts/auto-handoff-claude-ai.py` | **削除**(claude.ai遺物) |
| `scripts/auto-handoff.py` | handoff廃止方針 → 要否判断。残すなら notify.sh 経由へ |
| `scripts/daily-archive-summary.ts` | curl部を `notify.sh "msg" --tag archive` 呼出に |
| `scripts/gcal-reminder.py` | 同上 `--tag gcal` |
| `scripts/imessage-telegram-bridge.ts` | 同上 `--tag imsg` |
| `scripts/phone-telegram-bridge.ts` | 同上 `--tag phone` |
| `scripts/slack-telegram-bridge.ts` | 同上 `--tag slack` |
| `src/bin/line-schedule-poller.ts` | 通知部のみ notify.sh、LINE配信部は別 |
| `src/bin/nightly-agent.ts` | 完了通知を notify.sh 経由 |
| `exec.sh` | `--notify` の curl を notify.sh 呼出に |
| `scripts/set-bot-commands.sh` | **対象外**(通知でなくbot commands設定。放置) |

→ 移行後の検証(完了条件): 
```bash
# script/cron で生 api.telegram.org が残っていない(bot本体UIのみ許容)
grep -rlE "api\.telegram\.org" --include=*.ts --include=*.py --include=*.sh . | grep -v node_modules \
  | grep -vE "src/(handlers|index|session|utils|services|task)" | grep -vE "notify\.sh|notify-dj\.sh|set-bot-commands"
# → 空になればOK
```

---
## LINE命名罠の解消(M2)

- `scripts/line-notify.py` = 正名版を**作成済**(telegram-notify.py の正名コピー、docstring修正済)。
- `tg-notify.py` と `telegram-notify.py` は**完全重複**(diff一致確認済)。
- **呼出元5本を line-notify.py に向け替え**(実宛先=LINEで正しいか各々DJ確認):
  ```
  scripts/cal-briefing.sh        : telegram-notify.py → line-notify.py
  scripts/dj-ops-briefing.sh     : telegram-notify.py → line-notify.py
  scripts/jarvis-inbox.sh        : telegram-notify.py → line-notify.py
  scripts/morning-briefing.sh    : telegram-notify.py → line-notify.py
  scripts/ops-briefing.sh        : tg-notify.py       → line-notify.py
  ```
- 向け替え + テスト後: `git rm scripts/tg-notify.py scripts/telegram-notify.py`

---
## 廃止/除去(DJ確認必須)

| 対象 | コマンド | 注意 |
|---|---|---|
| ネスト重複dir | `git rm -r claude-telegram-bot/` | >5削除。live=`./src`と別物を確認後 |
| morning-briefing.ts(壊れ放置) | launchd plistから除去 → `launchctl bootout` | M6: croppy-pc依存をgrep確認後 |
| autokick-watchdog | LaunchAgent除去 | claude.ai遺物。RC移行で不要 |
| embed-server(意味検索) | プロセス/Agent停止 | 意味検索MCP見送り決定済なのに常駐 |
| auto-handoff-claude-ai.py | `git rm` | vestigial |

---
## ロールバック
- 全作業は branch `phase0-tg-shrink`。`git checkout main` で即復帰。
- notify-dj.sh wrapper化が問題なら、旧notify-dj.sh は git履歴 or `git show main:scripts/notify-dj.sh` で復元。

## 完了の定義(Phase 0)
1. notify-dj.sh wrapper化 + 実送信テスト緑
2. 直curl 11本移行 + 上記grep検証が空
3. LINE 1本化 + 呼出元5本更新 + dupe削除
4. ネスト重複dir/遺物/壊れジョブ 除去(DJ承認分)
5. 配信ログ稼働確認(`logs/notify.log`)
