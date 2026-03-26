# Nightly Tasks (Updated 2026-03-16 09:05 by Croppy)

## Active
- [x] SKILL-PLC-001: ~/machinelab-knowledge/plc-ladder/journal.ndjsonの最新50件を分析。high/medium confidenceでまだpatterns.mdにないパターンを抽出→patterns.mdに追記。特にMRデバイスアドレス計算、DM割付、EtherNet/IP速度指令パターン。追記後 git add ~/machinelab-knowledge/plc-ladder/patterns.md && git commit --no-verify -m "skill: promote PLC journal findings to patterns"
- [x] SKILL-VISION-001: ~/machinelab-knowledge/inspection-vision/journal.ndjsonの全13件 + patterns.md(3KB)を読み、不足を分析。Web検索でKEYENCE XGシリーズ AI検査機能、食品向け照明設計ガイドを調査→patterns.mdに追記。git add ~/machinelab-knowledge/inspection-vision/patterns.md && git commit --no-verify -m "skill: enrich inspection-vision patterns with web research"

- [x] SKILL-MANUAL-001: manual-authoring/patterns.mdにISO 20607章構成テンプレート、シグナルワード4段階(DANGER/WARNING/CAUTION/NOTICE)、EHEDG/3-A SSI/NSF認証記載ルール、IEC/IEEE 82079-1 JIS化動向を追記。Web検索で補強。git add && git commit --no-verify -m "skill: manual-authoring patterns - ISO20607/EHEDG/signal words"
- [x] SKILL-MISUMI-001: misumi-procurement/patterns.mdにミスミ2026新商品(セーフティライトカーテン/センサ/SUSコンベヤ)、meviy即時見積もりワークフロー、カタログ規格外品サービス、FA部品選定フローを追記。git add && git commit --no-verify -m "skill: misumi-procurement patterns - 2026 products/meviy/selection flow"

- [x] SKILL-ICAD-002: icad/patterns.mdにEHEDG衛生設計チェックリスト(Ra≤0.8um/連続溶接/25mm間隔)、Doc.58リスクベース設計、iCAD 3D Browser活用、干渉検証早期適用(CKD事例)、SDK+カスタム自動化、V8配管統合を追記。git add && git commit --no-verify -m "skill: icad patterns - EHEDG hygiene/3D Browser/interference/SDK+"
- [x] SKILL-PLC-003: plc-ladder/patterns.mdにKV-XD02異常自動検出、エアシリンダ駆動時間監視、MOR運転記録実践フロー、KV-8000 vs KV-5500機能差分、インバータ予防保全を追記。git add && git commit --no-verify -m "skill: plc-ladder patterns - KV-XD02/MOR/8000vs5500/preventive"

- [x] SKILL-VISION-004: inspection-vision/patterns.mdにMOTOMAN NEXTシリーズAI自律ロボットとのビジョン統合パターン、AI自律判断ロボット+KamiCheck発展系(3Dカメラ+制御統合)を追記。Web検索で最新KEYENCE VS-G/IV4情報も補強。git add && git commit --no-verify -m "skill: vision patterns - AI robot integration, KamiCheck evolution"

- [x] SKILL-VISION-005: inspection-vision/patterns.mdにVS Series食品包装検査カタログ(シール/OCR/充填量/バーコード)、ディープラーニング適用判定フロー、熱画像デュアルモード将来パターン、XG-Xシリーズ詳細を追記。git add && git commit --no-verify -m "skill: vision patterns - VS food packaging, DL decision flow, thermal dual mode, XG-X specs"

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
