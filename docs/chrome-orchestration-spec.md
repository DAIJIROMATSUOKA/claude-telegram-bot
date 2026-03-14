# Chrome Orchestration 仕様書
**作成:** 2026-03-14
**状態:** DECIDED (3AIディベート完了、DJ承認済み)

---

## 決定事項

### [DECIDED] sessionKey API廃棄
- F1-F9 (2,732行) → archiveブランチに退避、mainから削除
- chatlog mirror (claude-chatlog-api.py) → 段階的退役（読み取り専用・低頻度のため即廃棄ではない）
- 理由: ToS 3.7違反、2026-01〜BAN強制開始、BANで20案件コンテキスト喪失=事業リスク

### [DECIDED] Chrome Worker Tab方式に一本化
- 理由: claude.ai全機能維持(web検索/Artifacts/MCP)、BAN実績なし、認証安定、新機能自動追従
- 速度差は許容（DJ明言）
- DOM変更リスクはセーフモード+手動修正で吸収

### [DECIDED] Claude Code CLI移行は不要
- 固有機能(subagent/hook/json-schema/fork)は既存構成で十分代替
- 検証済み: -pフラグのstdinハング問題、起動7-14秒

### [DECIDED] 従量課金API不採用
- Orchestration稼働で$170-350/月（Max Plan $100の1.7-3.5倍）
- 会話長大化で上振れリスク大

---

## 却下案と理由

| 案 | 却下理由 |
|---|---|
| sessionKey API維持 | BAN=制御不能SPOF。アカウント喪失で全案件データ消失 |
| Claude Code CLI主系 | web検索/Artifacts/サーバー側MCP使えない。JSONL閲覧不可 |
| CLI主系+Chrome副系 (GPT案) | CLIの欠落が大きすぎる |
| 従量課金API | $170-350/月。上振れリスク。DJ原則違反 |

---

## 既存基盤（そのまま使う）

| プリミティブ | ファイル | 状態 |
|---|---|---|
| new-chat | croppy-tab-manager.sh | プロジェクトタブ作成+メッセージ注入 |
| inject / inject-raw | croppy-tab-manager.sh | メッセージ送信 |
| read-response | croppy-tab-manager.sh | 最終応答DOM取得(4KB上限) |
| health / check-status | croppy-tab-manager.sh | READY/BUSY/DEAD判定 |
| mark / unmark | croppy-tab-manager.sh | [J-WORKER-N]タグ管理 |
| list / list-all | croppy-tab-manager.sh | タブ一覧 |
| inject count + auto-handoff | croppy-bridge.ts | 25回警告/30回引き継ぎ |
| bridge reply routing | croppy-bridge.ts | Telegram返信→同Worker |

---

## 新規実装（3機能）

### N1: wait-response (BUSY→READY待ち+応答取得)

**場所:** croppy-tab-manager.sh に追加

**仕様:**
- check-status を1秒間隔でポーリング
- BUSY→READY遷移を検知したら read-response を実行
- タイムアウト: デフォルト300秒（引数で変更可）
- 出力: 応答テキスト or TIMEOUT or ERROR

```
./croppy-tab-manager.sh wait-response <W:T> [timeout_sec]
```

**フォールバック:** タイムアウト時はTIMEOUTを返す（エラーではない）

### N2: project-tab-router (案件別タブ管理)

**場所:** scripts/project-tab-router.sh (新規)

**仕様:**
- D1マッピング: project_id → {conv_url, wt_position, project_name, created_at}
- 案件ID(M番号)からタブ特定。閉じていたらURLで再オープン
- 新規案件は new-chat で作成→マッピング登録

```
./project-tab-router.sh resolve <M1317>     # W:T返却 (なければ作成)
./project-tab-router.sh list                 # 全案件マッピング
./project-tab-router.sh register <M1317> <conv_url>  # 手動登録
./project-tab-router.sh cleanup              # 閉じたタブのWT再解決
```

**永続化:** Memory Gateway D1 (project_tab_mappings)
**フォールバック:** D1失敗時はローカルJSON (~/.croppy-project-tabs.json)

### N3: tab-relay (タブ間応答リレー)

**場所:** scripts/tab-relay.sh (新規)

**仕様:**
- Tab A に inject → wait-response → 応答テキスト取得
- テキスト加工（オプション: プレフィックス追加）
- Tab B に inject-raw → 送信

```
./tab-relay.sh relay <from_wt> <to_wt> [prefix]
./tab-relay.sh ask-and-forward <from_wt> <to_wt> "question" [prefix]
./tab-relay.sh debate <wt_a> <wt_b> "topic" [rounds]
```

**フォールバック:** BUSYタイムアウト → Telegram通知して停止

---

## Orchestration Chrome実装マッピング

| 構想の要素 | sessionKey時代 | Chrome方式 |
|---|---|---|
| Inboxチャット作成 | POST chat_conversations | new-chat |
| 案件チャット特定 | UUID直指定POST | project-tab-router resolve |
| メッセージ転送 | POST completion | tab-relay ask-and-forward |
| 応答パース | SSEストリーム | wait-response + read-response |
| ディベート | 複数チャットに順次POST | tab-relay debate |
| 夜間自律改善 | completion POST + exec bridge | Worker Tab inject + exec bridge |
| DJ閲覧 | ブラウザで開く | そのまま |

---

## ファイル責務

| ファイル | 責務 | 変更種別 |
|---|---|---|
| scripts/croppy-tab-manager.sh | Chrome操作プリミティブ | 既存+wait-response追加 |
| scripts/project-tab-router.sh | 案件→タブ解決 | 新規 |
| scripts/tab-relay.sh | タブ間リレー | 新規 |
| src/handlers/croppy-bridge.ts | Telegram→Worker Tab接続 | 既存（変更なし） |
| src/handlers/orchestrator-chrome.ts | Inbox振り分けロジック | 新規(F4置換) |

---

## 実装順序（一気に、フェーズ分割なし）

1. wait-response を croppy-tab-manager.sh に追加
2. project-tab-router.sh 新規作成（D1テーブル含む）
3. tab-relay.sh 新規作成
4. スモークテスト: new-chat → inject → wait-response → relay
5. orchestrator-chrome.ts 新規作成
6. F1-F9アーカイブブランチ退避
7. FEATURE-CATALOG.md / croppy-notes.md 更新

---

## テスト計画

| テスト | 手順 | 合格基準 |
|---|---|---|
| wait-response基本 | inject → wait-response 60s | 応答テキスト取得 |
| wait-responseタイムアウト | BUSY中に10秒timeout | TIMEOUT返却、クラッシュなし |
| project-tab-router resolve | M1317指定 | W:T返却 or 新規作成 |
| project-tab-router復旧 | タブ閉じてresolve | URL再オープン+新W:T |
| tab-relay基本 | A→B転送 | Bに応答テキスト到着 |
| tab-relay debate | 3往復 | 交互に応答、最終結果取得 |
| DOM変更耐性 | セレクタ書き換え | エラー→Telegram通知→停止 |
