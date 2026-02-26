# iPhone→M1リモート操作 仕様書
**日付:** 2026-02-22
**ディベート:** クロッピー x ChatGPT x Gemini 全員一致採用
**状態:** セットアップ完了・動作確認済み

## 概要
Poller/Watchdog全滅時の最終手段としてTailscale SSH + Termiusスニペットを導入。
日常運用ではない。日常はTelegram + exec bridge。

## iPhoneからできること
- 全JARVISプロセスの生死確認 (launchctl list)
- Jarvis再起動 (scripts/restart-bot.sh)
- Poller強制再起動 (launchctl kickstart)
- ログ確認 (Poller/Jarvis/Watchdog)
- 自律ループ状態確認 (M1.md)
- git status / git pull / git push
- 任意のシェルコマンド実行

## 構成
- VPN: Tailscale 1.94.1 (WireGuard)
- M1 IP: 100.65.128.43
- SSH: Tailscale SSH (鍵/パスワード不要)
- iPhoneアプリ: Termius
- スリープ防止: pmset disablesleep 1

## M1再起動時
Tailscaleはsystem daemonインストール済み。
M1再起動後、自動的にデーモン起動しSSH利用可能。DJ追加操作不要。

## 決定事項
- DECIDED: Tailscale SSH + Termiusスニペット
- REJECTED: VNC/Screen Sharing (モバイル非実用的)
- REJECTED: 超軽量Telegram Bot (複雑性増大)

## Termiusスニペット
- 全プロセス状態: launchctl list | grep jarvis
- Jarvis再起動: ~/claude-telegram-bot/scripts/restart-bot.sh
- Poller再起動: launchctl kickstart -k gui/501/com.jarvis.task-poller
- M1状態: cat ~/claude-telegram-bot/autonomous/state/M1.md
- Pollerログ: tail -20 /tmp/task-poller.log
- Jarvisログ: tail -20 /tmp/jarvis-bot.log
- git status: cd ~/claude-telegram-bot and git status

## セッション履歴
- 2026-02-22: ディベート > セットアップ > 動作確認完了
