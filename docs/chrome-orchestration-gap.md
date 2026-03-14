# Chrome Orchestration 仕様書差分 (2026-03-14)

## 現状
- 17コミット完了。基盤プリミティブ全動作。
- 仕様書 (docs/claude-ai-orchestration-spec.md) との差分14件。

## ❌ 欠落 14件（次セッションで全修正）

### G1: 応答リレー
- 今: route()がfire-and-forget（inject後に応答を返さない）
- あるべき: inject → wait-response → read-response → ctx.reply()
- 場所: orchestrator-chrome.ts route()内

### G2: 二重投入排除
- 今: text.tsでBridge+Orchestrator両方が同じメッセージをinject
- あるべき: Orchestratorが処理した場合はBridgeスキップ
- 場所: text.ts のルーティング分岐

### G3: auto-handoff配線
- 今: checkAndHandoff()はあるがroute()から呼ばれない
- あるべき: route()でinject成功後にcheckHandoff()呼び出し
- 場所: orchestrator-chrome.ts route()末尾

### G4: リプライ→同案件タブ継続
- 今: Telegramリプライ→BridgeReplyMapのみ（旧Worker Tab宛）
- あるべき: ルーティング結果のtabWTをリプライマップに登録→リプライ時は同案件タブ
- 場所: orchestrator-chrome.ts + text.ts

### G5: キューバッファ
- 今: Chrome/タブ不調時→ERROR返却で終了
- あるべき: inject失敗→ローカルキュー保存→復旧後再送
- 場所: 新規 src/utils/message-queue.ts or orchestrator-chrome.ts内

### G6: Inboxフォールバック（resolve失敗時）
- 今: resolve失敗→ERROR
- あるべき: resolve失敗→Inboxタブに投入
- 場所: orchestrator-chrome.ts route()

### G7: /ask コマンドChrome版
- 今: claude-chat-api.ts (sessionKey依存)
- あるべき: /ask M1319 message → project-tab-router resolve → inject-file → wait → reply
- 場所: 新規コマンド or orchestrator-chrome.ts

### G8: /audit コマンド
- 今: audit.jsonlに書くだけ
- あるべき: /audit → 直近10件表示。/audit M1317 → 案件別フィルタ
- 場所: 新規コマンドハンドラ

### G9: /spec /decide /decisions 復活
- 今: F9削除済み。ファイル(DJ-SPEC.md, DJ-DECISIONS.ndjson)はある
- あるべき: Chrome非依存のファイル操作コマンド（sessionKey不要）
- 場所: 新規コマンドハンドラ（旧dj-spec-command.tsベース、API依存除去）

### G10: Access DB差分更新
- 今: 初回注入のみ
- あるべき: /refresh M1317 → Access DB再クエリ → 差分をチャットに投入
- 場所: orchestrator-chrome.ts or 新規コマンド

### G11: Nightly Forge v2 Chrome移行
- 今: F8未移行
- あるべき: Chrome Tab + exec bridge ループ（claude.aiで考える→M1で実行→結果投稿）
- 場所: 新規 scripts/nightly-forge-chrome.sh or TypeScript

### G12: DESIGN-RULES読み込みハードコード
- 今: Nightly Forgeが未実装なのでこれも未実装
- あるべき: Nightly開始時にDESIGN-RULES.mdを必ずinject
- 場所: G11と同時に実装

### G13: チェックポイント5行構造
- 今: 未実装
- あるべき: Nightly各ステップ完了時に5行要約をチャット投稿+Obsidianに全ログ
- 場所: G11と同時に実装

### G14: 案件チャット未作成→Inbox fallback
- G6と統合可能。resolve失敗時にInboxタブへ

## ⚠️ 部分的 6件

### P1: モデル制御
- Chrome方式では制御不可（プロジェクト設定に従う）→ DJ了承済み（無視OK）

### P2: chatlog mirror段階的退役
- claude-chatlog-api.pyがsessionKey依存→代替手段できるまで維持

### P3: 監査ログ閲覧
- G8で対応

### P4: DJ-SPEC Project Knowledge注入
- 手動コピペ。自動化はChrome操作で可能だが優先度低

### P5: Inbox ChャットSonnet指定
- Chrome方式では不可→P1と同じ

### P6: /spec /decide コマンド
- G9で対応

## 実装順序（依存関係考慮）

1. G2 二重投入排除 (text.ts) ← 最初に直さないと全部二重になる
2. G1 応答リレー (orchestrator-chrome.ts) ← これがないとDJに返答が来ない
3. G4 リプライ→同案件 (text.ts + orchestrator) ← 会話の連続性
4. G3 auto-handoff配線 (orchestrator-chrome.ts) ← 最優先実装（仕様書）
5. G6+G14 Inboxフォールバック (orchestrator-chrome.ts)
6. G5 キューバッファ
7. G7 /ask Chrome版
8. G8 /audit
9. G9 /spec /decide /decisions
10. G10 Access DB差分更新
11. G11+G12+G13 Nightly Forge v2 (最後、他全部安定後)
