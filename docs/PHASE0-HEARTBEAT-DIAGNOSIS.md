# heartbeat-check 機能不全 — 根本原因診断 (読み取り専用)

_2026-06-03 / 設計 §9.3「表面修理でなく根本原因(なぜ3回)」に従う / 修理は朝(running monitor/launchd)_

## 症状
`check-heartbeat.sh` が全時間帯で「heartbeatファイル無いがBot稼働中」WARNING を吐き続ける(死活監視 実質不能)。

## なぜ? (3回)
1. **なぜWARNING?** → `check-heartbeat.sh` が監視する `HEARTBEAT_FILE=/tmp/jarvis-heartbeat` が存在しないから(実ファイル確認: 無し)。
2. **なぜ存在しない?** → **誰も `/tmp/jarvis-heartbeat` を書いていない**。コード全文grep で書込み元ゼロ(参照は check-heartbeat.sh 自身のパス定義のみ)。コメントは「Botが30秒毎に書込む」前提だが、その writer が bot に実装されていない/消失。
3. **なぜ writer が無い?** → bot(src/index.ts/session.ts)に heartbeat 書込み処理が存在しない。過去に存在した想定が現コードと乖離(= 監視対象がファントム)。

→ **根本原因: check-heartbeat.sh は「書かれないファイル」を監視している。**

## 関連(別系統・実害マスク済)
- `poller-watchdog.sh` は `/tmp/poller-heartbeat-m1` を見る。実ファイル存在(12:53)。
- 一方 `src/bin/task-poller.ts:244,285` は `/tmp/poller-heartbeat`(**`-m1`無し**)に書く → パス不一致。
- ただし lessons.md 既知のとおり poller-watchdog は **pgrep を real liveness** とし MAX_AGE 86400 で stale 許容 → heartbeatパス不一致の実害はマスク済(誤restartは止まっている)。`-m1` を書く実体は task-poller.ts ではない別経路(要特定、優先度低)。

## 修理案(朝・DJ判断)
| 案 | 内容 | 評価 |
|---|---|---|
| A | bot に `/tmp/jarvis-heartbeat` writer 実装(30秒毎 writeFile) | 設計通りだが書込み処理追加 |
| **B(推奨)** | check-heartbeat.sh を **pgrep 実死活**に変更(poller-watchdog と同方式) | ファントムファイル依存を断つ。最も堅い |
| C | check-heartbeat.sh 廃止(croppy-pc-watchdog/poller-watchdog が死活カバー済なら) | 重複監視の棚卸し |

→ B か C。いずれも running monitor/launchd に触れるため**朝に実行**。task-poller.ts の heartbeat パスも `-m1` 統一 or pgrep 化で整理。
