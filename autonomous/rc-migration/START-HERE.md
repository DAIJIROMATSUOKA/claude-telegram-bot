# START-HERE — RC移行 続き（軽量入口）

新チャットのクロッピー🦞へ。**これだけ読めば開始できる。重いファイルは"必要な時だけ"読む。**

## 最初の1手（exec bridge を直す）
毎セッション HTTPS_PROXY が空で exec.sh が壊れる。最初にこれだけ:
```
cp /mnt/project/exec.sh ~/exec.sh
sed -i 's|PROXY_OPT=.*|if [ -n "$HTTPS_PROXY" ]; then PROXY_OPT="--proxy-insecure -x $HTTPS_PROXY"; else PROXY_OPT=""; fi|' ~/exec.sh
bash ~/exec.sh "date"
```

## 状態
- **ミッション**: M1の Claude Code RC (croppy-pc) を JARVIS daily driver に。設計(A〜K)＋STEP2棚卸し完了。**残りは STEP8〜9＋soak＋cutover**。
- **今ここ**: STEP 0〜8 完了（backup 3本=稼働中）。**STEP 9 (Sonnet化) から**。
- PLAN: `RC-MIGRATION-PLAN.md` §3=STEP手順。一度に全部読むな、該当節だけ。

## STEP3〜7 完了（2026-06-03）
- **STEP3**: claude 2.1.161(≥2.1.59 で native auto-memory 標準搭載・plist修正不要)
- **STEP4**: user `~/.claude/settings.json`: model pin `claude-opus-4-8` / sandbox.filesystem.denyRead=[~/.ssh,~/.aws,~/claude-telegram-bot/.env(.save)] / allowWrite=[Obsidian 90_System/JARVIS]。project `.claude/settings.json` hooks形式修正(起動ブロッカーだった)
- **STEP5**(commit 6c56217 push済): launcher `scripts/croppy-pc-launch.py` を flag-mode RC化: `claude --resume <id> --remote-control croppy-pc-main --permission-mode acceptEdits`。resume=A方式(`/tmp/croppy-pc-last-session` に sessionId記録、実証済)
- **STEP6**(commit 1533fa9 push済): `scripts/croppy-pc-watchdog.sh`(60s/pure bash/debounce、/tmp/rc-croppy.log 監視→認証切れ・Sonnet降格を Telegram)。旧 croppy-health(Chrome監視)撤去(.disabled)
- **STEP7**(memory整備完了): native auto-memory稼働確認。root手動 MEMORY.md→docs/archive退避。架空 M1317(伊藤ハム)削除・M3→M5修正。RC側で consolidate(MEMORY.md索引化・@import維持)。**clobber元凶 auto-memory-sync.py を除去**(下記)

## 決定事項（外すな）
- 🔴 launcher は **--dangerously-skip-permissions なし**(①network隔離優先。RC対話で permission prompt 扱える、acceptEdits で Edit自動承認)
- 🔴 **failIfUnavailable 追加しない**(無人運用の可用性優先。secretsは denyRead で kernel級保護)
- 🔴 **auto-memory-sync.py を Stop hook から除去済**(settings.local.json、backup あり)。native auto-memory(v2.1.59+) 登場前の遺物で、task-state/architecture/lessons を WIP・git・DESIGN-RULES・FEATURE-CATALOG からプログラム再生成し native+手動編集を clobber していた。**復活させるな**。memory は native auto-memory + /dream(効かなければ「consolidate my memory files」)に一本化
- permission: read-only(cat/ls/grep等)は既に `Bash(cat:*)`(コロン形式)で許可済み。複合コマンド(`cd && for`)は shell operator awareness で確認必須(安全機構、settingsで恒久許可しない。一時作業は RCの「Always allow for session」)
- sandbox network: claude -p では非決定的・RC /sandbox 非対応で本検証不能→filesystem(denyRead)保護で十分と判断

## STEP8 完了（2026-06-03）— backup 3本稼働
- **8-1 config→git private**(B案): `~/jarvis-claude-config`(private, github.com/DAIJIROMATSUOKA)。whitelist copy方式。二重防御=allowlist cp+.gitignore+commit前 leak scan。`scripts/claude-config-sync.sh`(auto-push付)。16ファイル CLEAN
- **8-2 projects→Dropbox**: `scripts/claude-projects-backup.sh` rsync `~/.claude/projects`(5.8M)→`~/Machinelab Dropbox/machinelab/etc/jarvis-backup/claude-projects`
- **8-3 D1**: 既存`scripts/d1-backup.sh`(8テーブル→iCloud)統合。D1 Time Travel常時ON補完
- **自動化**: `scripts/nightly-backup.sh`→`com.jarvis.nightly-backup`(LaunchAgent 03:10)+Telegram

## STEP9 の中身（今やること）— Sonnet化 → soak → cutover
1. `~/.claude/settings.json` の `model`=`claude-opus-4-8` 確認
2. **web_search必須**: Sonnet最新モデル名＋Claude Code での model 切替方法
3. **soak**: settings.json model を Sonnet に変更 → 数日 RC で観察
4. **cutover**: 問題なければ croppy-pc を正式 daily driver 宣言
- 🔴 **注意**: `scripts/croppy-pc-watchdog.sh` の「Sonnet降格→Telegram通知」が誤検知する→STEP9で watchdog の期待モデルも Sonnet に変えること

## 注意（事故らない）
- 🔴 **kill自爆**: `pkill/grep "croppy-pc-launch"` は exec の bash自身にマッチして自分を kill。launcher再起動は **`launchctl kickstart -k gui/$(id -u)/com.jarvis.croppy-pc`**
- 🔴 **hard-delete(rm)しない**: ファイル削除は mv で退避(/tmp や docs/archive)
- 🔴 Gateway D1 が時々 "submit failed/timeout"→transient、少し待ってリトライで成功
- 🔴 トークン節約: PLAN 一度に全部読むな
- 既存 `~/.claude/CLAUDE.md` は上書きせずマージ。破壊的変更・push は DJ明示時のみ(push=`git push --no-verify origin main`)
- DJと呼ぶ。簡潔・前置き禁止・【決定】マーカー。実装前 web_search 必須

## 残タスク
- **STEP9**(Sonnet化)→soak→cutover（STEP8 backup=完了・稼働中）
- 別件: **docs/HANDOFF_* 61個**(毎日生成、廃止方針なのに継続)。Journal/auto-handoff-* は auto-memory-sync.py 停止で止まったが docs/ は別犯人→要調査
- **memory上限整理**: claude.ai userMemories が30件上限で追記不可(Claude Code memory とは別物)。古い項目の削除/統合が必要

## 各STEP所在
STEP4✅ / STEP5✅ / STEP6✅ / STEP7✅ / **STEP8✅** / **STEP9=Sonnet化** → soak → cutover
