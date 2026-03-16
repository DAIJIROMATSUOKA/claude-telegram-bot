# Nightly Tasks (Updated 2026-03-16 09:05 by Croppy)

## Active
- [ ] M1311-PREP-001: M1311チャット(m1311ドメイン)に案件コンテキストを注入。以下を実行:
  1. exec bridge経由で ~/Machinelab Dropbox/machinelab/プロジェクト/M1311_ヤガイ_おやつカルパスライン/ のフォルダ構成を確認
  2. M1311-PLC・画面関係資料_20260130/ 内のデバイスMAP(DM/MR/T/W/ZF)PDFを読んで要約
  3. M1311-設定割付・手動操作割付資料/ のモータ一覧・手動操作割付を読んで要約  
  4. 制御設計MEMOの主要情報を抽出
  5. 上記をまとめてM1311チャットにdomain-relay.sh経由で注入: bash scripts/domain-relay.sh --domain m1311 "要約テキスト"
  ※ 目的: 明日のFA制御設計（ラダー作成）でM1311チャットが即答できる状態にする
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
