# Nightly Tasks (Updated 2026-03-16 by Croppy)
# Auto memory管理外。直接編集OK。

## Active
- [x] NIGHTLY-001: nightly-forge-chrome.sh メインループ冒頭でnightly-tasks.mdを/tmp/nightly-forge/にバックアップ。execブロック実行後にファイル構造検証、壊れたら復元するvalidate_nightly_tasks()追加。bash -n scripts/nightly-forge-chrome.sh で構文確認後commit
- [x] NIGHTLY-002: checkpoint()にbun test結果メトリクス行を追加(METRIC: test_pass=N test_fail=N)。obsidian_appendにも含める。bash -n確認後commit
- [x] NIGHTLY-003: Finalizeセクションで完了/未完了タスク一覧+git diff stat+最終checkpointをObsidian ## Handoffに追記。bash -n確認後commit

## Blocked
- (none)

## Recently Completed
- (none)

## Rules
- bash -n scripts/nightly-forge-chrome.sh で構文チェック必須
- git push禁止
- 完了行は [ ] を [x] に更新
- ヘッダ構造変更禁止
- 迷ったら STUCK: 理由
