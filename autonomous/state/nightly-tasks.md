# Nightly Tasks (Updated 2026-03-16 09:05 by Croppy)

## Active
- [x] SKILL-PLC-001: ~/machinelab-knowledge/plc-ladder/journal.ndjsonの最新50件を分析。high/medium confidenceでまだpatterns.mdにないパターンを抽出→patterns.mdに追記。特にMRデバイスアドレス計算、DM割付、EtherNet/IP速度指令パターン。追記後 git add ~/machinelab-knowledge/plc-ladder/patterns.md && git commit --no-verify -m "skill: promote PLC journal findings to patterns"
- [x] SKILL-VISION-001: ~/machinelab-knowledge/inspection-vision/journal.ndjsonの全13件 + patterns.md(3KB)を読み、不足を分析。Web検索でKEYENCE XGシリーズ AI検査機能、食品向け照明設計ガイドを調査→patterns.mdに追記。git add ~/machinelab-knowledge/inspection-vision/patterns.md && git commit --no-verify -m "skill: enrich inspection-vision patterns with web research"

## Blocked
- (none)

## Recently Completed
- [x] NIGHTLY-001 to NIGHTLY-007

## Rules
- 既存patterns.mdの構造（## セクション）を壊さない。追記のみ
- journal.ndjsonは読むだけ。書き換えない
- Web検索結果はURLを必ず含める
- git push禁止
- 完了行は [ ] を [x] に更新
- 迷ったら STUCK: 理由
