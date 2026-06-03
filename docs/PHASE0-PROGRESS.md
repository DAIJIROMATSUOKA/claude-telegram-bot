# Phase 0 進捗ログ (TG縮退・CC主UI化)

_branch: phase0-tg-shrink / 開始 2026-06-03 夜 / 無人自律実行_
_方針: 追加的・可逆な作業のみ自動実行。破壊的/検証要(ライブ切替・launchctl・bot再起動・push・>5削除)は朝DJ。_
_通知=Telegram残置で確定(DJ承認 2026-06-03)。設計=`CC-ONLY-MIGRATION-DESIGN.md`。_

## 完了
- [x] **branch `phase0-tg-shrink` 作成**
- [x] **sendMessage/LINE 全件棚卸し (M1+M2)** → `docs/PHASE0-AUDIT.md`
  - prod 42 / test 10。LINE命名罠の波及5件特定。ネスト重複dir発見。

## 進行中 / TODO(自動・追加的)
- [x] **統一通知transport `scripts/notify.sh`**(🗑ボタン既定オフ、配信ログ`logs/notify.log`、失敗時リトライキュー`logs/notify-retry.ndjson`、`--flush-retry`、transport差替`NOTIFY_TRANSPORT`)。**配線テスト緑**(arg解析/ログ/キュー/再送)。実TG送信のみ朝検証(sandbox不可)。ライブ未配線=既存無傷。
- [x] **LINE送信器正名 `scripts/line-notify.py`**(tg-notify.py/telegram-notify.py=完全重複を確認、正名コピー+docstring修正)。呼出元5本の向け替え+dupe削除は朝。
- [x] **inbox承認 番号返信試作 `scripts/inbox-next.sh`**(H2: 外部バグ非依存フォールバック)。承認待ちescalateを番号メニュー描画(実データ動作確認)。実行(archive/draft/delete)はcroppy+Gmail MCP。
- [x] **カットオーバー手順書 `docs/PHASE0-CUTOVER-PLAN.md`**: 急所=notify-dj.shをnotify.shラッパー化で21呼出を一括移行。直curl11本の個別移行表。LINE5本向け替え。除去コマンド。検証grep。ロールバック。
- [ ] Phase1 休眠機能CC化 scaffold(設計済§5、DJ方向確認後に着手推奨=スコープ判断要のため自動化せず保留)

## チップ承認設計(H2 / Phase4前倒し試作)
- RC接続中: `AskUserQuestion`(選択肢チップ)で会話内ワンタップ → croppyがGmail MCPで実行
- RC未接続/モバイルバグ時: `inbox-next.sh`の番号メニュー → DJが`1a 3s`等で返信 → croppy実行(=Anthropic外部修正を待たない逃げ道、H2要件)
- 実行系統: archive/delete=Gmail MCP、draft=AI下書き+create_draft、show=get_thread全文

## カットオーバー実行ログ(2026-06-04 朝)
- [x] **notify.sh 実送信検証**(DJテスト)= TG着信+log `ok` ✅
- [x] **notify-dj.sh → notify.sh ラッパー化**(🗑ボタン維持)。DJ検証緑 → **notify-dj.sh経由21本が無変更で統一transport移行** ✅
- [x] **gcal-reminder.py** → notify.sh経由(HTML parse維持)。構文OK ✅
- [x] **LINE命名罠**: 4 briefing(cal/dj-ops/jarvis-inbox/morning)→ line-notify.py。telegram-notify.py git rm。LINE宛先不変。
- [ ] **ops-briefing.sh**(保留): `tg-notify.py "$ENV_FILE" "$MSG_FILE"` 異常シグネチャ=既存バグ濃厚(env pathを送信?)。tg-notify.py共々DJ確認待ち。
- [ ] **heartbeat**(careful): 良性ノイズと判明(誤kill無し)。真修理=bot に /tmp/jarvis-heartbeat writer 復活(bot編集+restart-bot.sh)。
- [ ] **ネスト重複dir `./claude-telegram-bot/`**: **untracked=rm不可逆**。DJがバックアップ後Finder削除。
- [x] **TS rewire(3本)**: 共有 `src/utils/notify.ts`(notify.sh spawn)作成 → daily-archive-summary.ts / nightly-agent.ts / line-schedule-poller.ts(notifyDJ部)を notify() 経由に。**typecheck 0エラー**。
  - **要DJ**: line-schedule-poller は常駐 → `launchctl kickstart -k gui/$(id -u)/com.jarvis.line-schedule-poller` で新コード反映。daily-archive/nightly は次回スケジュール(or 手動 `bun scripts/daily-archive-summary.ts`)で検証。
- [x] **bridge 3本(imessage/phone/slack)= UI据置**: inline_keyboard付きインタラクティブ送信 → 通知でなくUI。直sendMessageのまま正(botハンドラと同原則)。transport統一対象外と確定。
- [ ] exec.sh(critical据置) / auto-handoff*(遺物・hook配線確認後)

## 朝DJ判断・実行(破壊的/検証要)
- notify-dj.sh ライブ切替(TG実送信テスト要。sandboxから検証不可)
- LINE送信器 改名の呼出元5件更新 + 宛先監査
- ネスト重複dir `./claude-telegram-bot/` 削除(>5削除)
- LaunchAgent/launchctl(morning-briefing.ts/autokick-watchdog/embed-server除去)
- bot再起動(restart-bot.sh) / git push
- 各commitのレビュー

## メモ
- sandbox制約: `.env`読取不可 → 俺からTG/LINE実送信テスト不能。配線正しさはコードレビュー+朝の実機テストで担保。
- pre-existing 71未コミットは触らない(自分の作成物のみ扱う)。
