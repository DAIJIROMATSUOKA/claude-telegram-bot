# Skill Learning Tasks (Nightly Forge用テンプレート)
# nightly-tasks.mdにコピーして使う。毎晩1-2個ずつ投入。

## journal→patterns昇格タスク
- [ ] SKILL-PLC-001: ~/machinelab-knowledge/plc-ladder/journal.ndjsonの最新50件を分析。high confidenceでまだpatterns.mdにないパターンを抽出→patterns.mdに追記。追記後 git commit --no-verify
- [ ] SKILL-PLC-002: plc-ladder/patterns.mdを読み、KV Studio ST構文の注意点セクションを最新のchatlog情報（~/scripts/search-chatlogs.py "KV STUDIO" --list で検索）と照合。古い/不正確な記述があれば修正。git commit
- [ ] SKILL-VISION-001: inspection-vision/journal.ndjsonの全13件を分析→patterns.mdに昇格可能なパターンを追記。特にKamiCheck関連の知見。git commit
- [ ] SKILL-MISUMI-001: misumi-procurement/journal.ndjsonの全26件を分析→patterns.mdに型式選定パターン、納期目安、代替品情報を追記。git commit
- [ ] SKILL-MANUAL-001: manual-authoring/をWeb検索で補強。FA装置マニュアルのベストプラクティス（安全警告の書き方、章構成、規格参照）を調べてpatterns.md作成。git commit
- [ ] SKILL-ICAD-001: icad/patterns.mdの「DJワークフロー」セクションをchatlog検索（"iCAD" --list）で最新化。新しいコマンドやショートカットが見つかれば追記。git commit
- [ ] SKILL-ACCESS-001: access-db/patterns.mdの採番ロジック・テーブルスキーマが最新か検証。schema.mdとの整合性チェック。不整合があれば修正。git commit

## 外部知識取り込みタスク（Web検索必要）
- [ ] SKILL-PLC-WEB: Web検索でKV Studio最新バージョンの新機能・変更点を調査→plc-ladder/patterns.mdに追記。特にST構文の改善、新デバイスタイプ、EtherNet/IP関連
- [ ] SKILL-VISION-WEB: Web検索でKEYENCE XGシリーズ・CV-Xシリーズの最新機能を調査→inspection-vision/patterns.mdに追記。AI検査機能、照明設計ガイド等
- [ ] SKILL-MISUMI-WEB: Web検索でMisumi 2026年新商品カタログ・廃番情報を調査→misumi-procurement/patterns.mdに追記

## クロスドメイン学習タスク
- [ ] SKILL-CROSS-001: access-db/schema.mdのプロジェクト管理フィールドとplc-ladder/のI/O表パターンを照合。案件番号→PLC構成の対応関係を文書化
- [ ] SKILL-CROSS-002: inspection-vision/とplc-ladder/の連携パターンを文書化。検査NG→PLC排出シーケンスの標準パターン

## 運用ノート
- 1晩に1-2タスクが適正（Worker Tabのコンテキスト消費考慮）
- journal昇格タスクは外部アクセス不要で確実に完了する→初回テストに最適
- Web検索タスクはリサーチモードと重複しないように（リサーチ=発見、タスク=確定反映）
