# Phase 0 — sendMessage / LINE 全件棚卸し (M1+M2)

_生成: 2026-06-03 / branch: phase0-tg-shrink / `CC-ONLY-MIGRATION-DESIGN.md` §9.5 step1_
_これが全Phaseの真の前提。各送信呼び出しの「意図宛先」を確定し、移行/抽象/削除に分類する。_

## サマリ
- TG/LINE 送信を含むファイル: **prod 42 / test 10**
- 通知トランスポート統一(`notify-dj.sh`一本化)の対象 = **outbound通知系**(cron/script)。
- bot本体の `sendMessage`(grammY応答)は**通知でなくUI** → bot側に残す(=縮退後も通知専用botとして稼働)。

## ⚠️ 重大発見

### A. LINE命名罠の波及 (M2)
`scripts/telegram-notify.py` と `scripts/tg-notify.py` は**実体がLINE送信器**(`api.line.me`、docstring: "LINE notification sender (drop-in replacement for Telegram version)")。両者は**ほぼ同一の重複**。
これを呼ぶ briefing 群 = **「telegram-notify」という名前だがLINEに送っている**:

| 呼び出し元 | 呼ぶスクリプト | 実宛先 | 意図 |
|---|---|---|---|
| `scripts/cal-briefing.sh` | telegram-notify.py | **LINE** | 要確認(意図的LINE化か誤認か) |
| `scripts/dj-ops-briefing.sh` | telegram-notify.py | **LINE** | 同上 |
| `scripts/jarvis-inbox.sh` | telegram-notify.py | **LINE** | 同上 |
| `scripts/morning-briefing.sh` | telegram-notify.py | **LINE** | ※morning-briefing.ts は別(壊れ放置・廃止対象) |
| `scripts/ops-briefing.sh` | tg-notify.py | **LINE** | 同上 |

→ **対処**: line-notify.py に改名・1本化(重複排除)。呼び出し元の「LINE送信で正しいか」をDJ確認(朝)。命名罠を断つ。

### B. ネスト重複ディレクトリ `./claude-telegram-bot/`
リポジトリ内に **Feb 5 付の古いリポジトリ実体コピー**(`./claude-telegram-bot/src/handlers/{callback,document,photo,voice,text}.ts`, `index.ts`, `session.ts` 等)。grepが二重ヒットする原因。**死コードの疑い濃厚**(live は `./src`)。
→ **>5ファイル削除につき自動削除しない**(憲法 git safety)。朝、DJ確認の上で `git rm -r claude-telegram-bot/`(branch上=可逆)。`photo.ts`/`voice.ts` はこのネスト側にのみ存在 = live未使用の確証材料。

## 機能別分類(prod outbound通知系 = 統一transport対象)

| ファイル | 役割 | 現状宛先 | 分類 | アクション |
|---|---|---|---|---|
| `scripts/notify-dj.sh` | 汎用TG通知(🗑ボタン付) | TG | **統一transportの母体** | 全outboundをここに集約。🗑ボタン既定オフ可能化(H1: bot不可分性を断つ) |
| `scripts/auto-handoff.py` | handoff通知 | TG | 経由化 | notify-dj.sh呼出へ。※handoff廃止方針なので要否再検討 |
| `scripts/auto-handoff-claude-ai.py` | claude.ai handoff | TG | **廃止** | vestigial(claude.ai運用遺物) |
| `scripts/daily-archive-summary.ts` | 日次要約 | TG | 経由化 | notify-dj.sh経由へ |
| `scripts/gcal-reminder.py` | 予定リマインド | TG | 経由化 | 同上 |
| `scripts/nightly-agent` (bin) | 夜間自律完了通知 | TG | 経由化 | 同上 |
| `src/task/reporter.ts` | タスク結果通知 | TG | 経由化 | 同上 |
| `scripts/imessage-telegram-bridge.ts` | iMessage→TG | TG | 経由化(transport差替可に) | 同上 |
| `scripts/phone-telegram-bridge.ts` | 電話→TG | TG | 経由化 | 同上 |
| `scripts/slack-telegram-bridge.ts` | Slack→TG | TG | 経由化 | 同上 |
| `src/bin/line-schedule-poller.ts` | LINE予約送信 | TG(通知)+LINE(配信) | 経由化 | 通知部のみnotify-dj.sh |
| `scripts/midnight-inbox-check.ts` | 深夜inbox点検 | TG | 経由化 | 同上 |
| `exec.sh --notify` | bridge完了通知 | TG | 経由化 | 同上 |
| `src/services/inbox-triage.ts` | inbox承認カード(最重要) | TG | **移植(承認は当面TGボタン)** | transport経由 + チップ版並行試作 |
| `src/services/snooze.ts` | スヌーズ再通知 | TG | 経由化 | 同上 |

### bot本体の sendMessage(通知でなくUI → bot側に残す)
`src/handlers/{callback,text,document,voice-chat,media-commands,deadline-input,agent-task,timetimer-command,line-post}.ts`, `src/index.ts`, `src/session.ts`, `src/utils/{rate-limiter,tg-file,tower-manager}.ts`, `src/services/dropbox-share.ts`
→ これらはgrammY botがユーザーに返信するUI。縮退後も**通知専用botの一部として稼働**。統一transport対象外。

### LINE送信器
| `scripts/telegram-notify.py` / `scripts/tg-notify.py` | LINE送信(重複) | LINE | **改名・統合** | `line-notify.py` 1本へ。呼出元5件を更新 |

### vestigial / 廃止
- `scripts/auto-handoff-claude-ai.py`(claude.ai中継), `apply-patches.py`(一時パッチ) → 削除候補
- `morning-briefing.ts`(別途・壊れ放置) → launchd除去はDJ(launchctl)

## Phase 0 完了条件(機械検証)
- [ ] 全outbound通知が notify-dj.sh(統一transport)経由 → `grep -rlE "api.telegram.org" --include=*.ts --include=*.py` が **bot本体UIのみ**に収束
- [ ] LINE送信器1本化 + 呼出元の宛先監査完了
- [ ] notify-dj.sh が🗑ボタン既定オフ可能(H1分離)
- [ ] 配信ログ/再送キューの器(M4)
- [ ] ネスト重複dir のDJ判断

## 注意(自動実行しない=朝DJ)
- notify-dj.sh ライブ切替(TG実送信テスト要、sandboxから検証不可)
- LaunchAgent/launchctl 操作 / bot再起動 / git push / >5削除
