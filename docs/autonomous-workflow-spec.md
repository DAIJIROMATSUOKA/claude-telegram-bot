# 自律実装フロー仕様書（autonomous-workflow-spec.md）
# v3.2 B-Plan — 🦞直接作業 + Auto-Kick アーキテクチャ

---

## DJ運用イメージ

### Before（v3.2以前）
```
DJ「○○を作りたい」
  → クロッピーが設計
  → DJがChatGPTに手動コピペしてレビュー依頼
  → DJがGeminiに手動コピペしてレビュー依頼
  → DJがレビュー結果をクロッピーに手動コピペ
  → クロッピーがコード書く
  → DJがコードをコピペしてJarvisに渡す
  → DJがJarvisのログを見て問題を報告
  → DJがクロッピーにエラーを伝える
  → 修正のたびにDJがコピペ往復
```
DJの作業: 10回以上のコピペ + 監視 + 判断

### After（v3.2 B-Plan）
```
DJ「○○を作りたい」
  → 🦞 croppy-start.sh（Auto-Kick ARM、サイレント）
  → 🦞 設計書作成
  → 🦞 自動でChatGPT/Geminiにレビュー依頼（exec bridge経由）
  → 🦞 FAIL項目を自動修正（grepでトークン節約）
  → 最大4ラウンドで自動収束
  → 🦞 exec bridgeで直接コード実装・テスト・修正
  → タイムアウト発生 → ウォッチドッグが自動復帰 → 🦞が作業継続
  → （自動復帰×N回、何度でも）
  → 🦞 croppy-done.sh（DISARM + Telegram通知）
```
DJの作業: 「○○を作りたい」の1行だけ。完了はTelegram通知。

### もしAuto-Kickが壊れても
```
  → 🦞 M1.mdに状態が書いてある
  → DJ 次にclaude.aiを開いた時
  → 🦞 M1.mdからNEXT_ACTIONを読んで即再開
```

---

## 0. 最優先原則

- DJ介入最小化（「1行投げたら何もしない」）
- 最小実装 → 実測 → 必要なら拡張（YAGNI）
- 1チャット完結（Thread分離しない）
- 🦞 = 設計+実装+テスト+修正の全責任者
- Auto-Kick = セッション延命機構
- Jarvis = 通知+cron+夜間バッチのみ（実装には関与しない）

---

## 1. ディベート決定事項

### v3.2 B-Planディベート（2026-02-15）

### [DECIDED] B案採用: 🦞直接作業 + Auto-Kick
- 投票: ChatGPT賛成 / Gemini賛成 / 🦞賛成（全員一致）
- 却下案: A案（Jarvis委譲）— 翻訳ロス、修正ラウンド増加、品質低下のため却下
- 却下案: ハイブリッド（A+B）— 複雑さに見合う価値がないため却下

### [DECIDED] Jarvis実装委譲は不要
- 投票: ChatGPT賛成 / Gemini賛成 / 🦞賛成
- 理由: 🦞がコンテキスト全保持で直接作業する方が品質高く、総ラウンド少ない
- 不要になったもの: TaskPlan JSON作成、実装用Orchestrator、poll_job.sh(Jarvis監視用)、🦞↔Jarvis状態同期
- Jarvisの残存役割: Telegram Bot通知、cron、夜間バッチのみ

### [DECIDED] フォールバック = DJ通知 + 次セッション再開
- 投票: ChatGPT賛成 / Gemini賛成 / 🦞賛成
- 却下案: Auto-Kick失敗時にJarvis CLIに自動切替 — 中途半端なコードが厄介、M1.md経由で🦞が次セッションで再開する方がシンプルで品質高い

### 初期ディベート決定事項（v3.2設計時、引き続き有効）

### [DECIDED] 状態マシン化
Claude（🦞）は状態のみ保持。設計全文・レビュー全文・ログ全文は外部ファイルに置く。

### [DECIDED] ID参照体系
`D0001@a13c` 形式（連番+hash4）で外部ファイルを参照。

### [DECIDED] ディレクトリ構造は最小3つ
state/ logs/ reviews/ のみ。追加は必要時。

### [DECIDED] レビュー形式はPASS/FAIL
S/A/B重大度は不採用。PASS/FAIL -> FIX形式。

### [DECIDED] Thread分離は不採用
1チャット完結。論理分離はファイルベースで実現。

### [DECIDED] チェックポイントは同一チャット内リセット
新チャット移行は200K危険域の最終手段のみ。

### [DECIDED] ERRSIG体系は不採用
exit code + stderr最後5行 + ログ参照IDで十分。

### [DECIDED] Extended Thinkingは実測後に判断
常時ON/OFFを決め打ちしない。

---

## 2. 外部ファイル構造

```
~/claude-telegram-bot/autonomous/
  state/
    M1.md              # 唯一の真実（状態ファイル）
    CHECKPOINTS.md      # チェックポイント履歴（追記）
  logs/                 # ジョブログ
  reviews/              # ChatGPT/Geminiレビュー結果
```

---

## 3. 状態ファイル（state/M1.md）

最大200 words。常に上書き。冗長説明禁止。

```
STATUS: PASS|FAIL|RUNNING
GOAL: <1行>
CONSTRAINTS:
- <最大3行>
CURRENT:
  TASK_ID: <NONE>
  LOGREF: <L-xxxx or NONE>
OPEN_K: <K1,K2,K3 or NONE>
ROUND: n/4
LAST_ACTION: <1行>
NEXT_ACTION: <1行>
```

NEXT_ACTIONには長時間ブロックコマンドを書かない。「何をやるか」を書く。実行方法は🦞が判断する。

---

## 4. Phase 1: 設計（多段レビューループ）

### フロー
```
DJ「○○を作りたい」
  → 🦞 croppy-start.sh（ARM）
  → 🦞 設計書をM1ファイルに書く
  → 🦞 exec bridge → ChatGPTにレビュー依頼 → 結果をreviews/に保存
  → 🦞 exec bridge → grep FAIL reviews/R-gpt-xxxx.md（数行だけコンテキストに入る）
  → 🦞 FAIL項目があれば設計書を更新
  → 🦞 exec bridge → Geminiにレビュー依頼 → 結果をreviews/に保存
  → 🦞 exec bridge → grep FAIL reviews/R-gem-xxxx.md
  → 🦞 FAIL項目があれば設計書を更新
  → （FAIL 0件で収束 or ROUND=4で停止）
  → 🦞 最終設計書をDJに提示
DJ「GO」→ Phase 2へ
```

### ルール
- レビュー順序: ChatGPT → Gemini → ChatGPT → Gemini
- 最大4ラウンド。収束しなければDJに判断を仰ぐ
- 各ラウンドで渡すのは「現在の設計書 + 前ラウンドのFAIL項目だけ」（累積しない）

### レビュー依頼プロンプトテンプレート
```
Review the spec below. Respond ONLY in this format:
PASS: <item>
FAIL: <item> -> FIX: <fix in 1 line>
Max 200 words. No prose.

---
<spec contents>
---
Previous FAIL items (if any):
<previous round FAIL lines>
```

---

## 5. Phase 2: 実装（🦞直接 + Auto-Kick）

### フロー
```
DJ「GO」
  → 🦞 exec bridgeで直接コード実装
  → 🦞 exec bridgeでテスト実行
  → 🦞 テスト失敗 → エラー確認 → 即修正（コンテキスト全保持）
  → 🦞 タイムアウト → Auto-Kick発動 → 同一コンテキストで再開
  → （実装→テスト→修正を繰り返す）
  → 🦞 全テスト通過
  → 🦞 git commit（exec bridge経由）
  → 🦞 croppy-done.sh（DISARM + Telegram通知）
```

### 🦞セッション切れ時（Auto-Kick失敗時）
```
  → M1.mdにLAST_ACTION/NEXT_ACTIONが書いてある
  → DJ 次にclaude.aiを開いた時（またはAuto-Kickが復旧した時）
  → 🦞 M1.mdからNEXT_ACTIONを読んで即再開
```

### 長時間タスク（30分超）
- 冪等なステージに分割: setup → build → test → package
- 各ステージ完了時にM1.md更新
- タイムアウト → Auto-Kick → 次のステージから継続

### ルール
1. 🦞が直接全作業を行う。Jarvisに委譲しない
2. exec bridgeの長時間コマンドは --fire --notify で非同期実行
3. M1.mdを定期的に更新（セッション切れに備える）
4. git commitはexec bridge経由。bash scripts/restart-bot.sh で再起動

---

## 6. Auto-Kick Watchdog

### 状態: ✅ 本番稼働中（2026-02-15 PoC成功、統合テスト成功）

### コンポーネント
| ファイル | 役割 |
|---|---|
| scripts/auto-kick-watchdog.sh | ウォッチドッグ本体 |
| com.jarvis.autokick-watchdog.plist | LaunchAgent |
| scripts/croppy-start.sh | ARM（サイレント） |
| scripts/croppy-done.sh | DISARM + Telegram通知 |

### 動作
```
🦞がタイムアウトで停止
  → ウォッチドッグが20秒間隔でチェック
  → aria-label「応答を停止」ボタン非表示 = STOPPED
  → 2回連続(40秒)でSTOPPED検知
  → osascript + Chrome JS でテキスト入力 + 送信
  → 🦞が同一コンテキストで再開
```

### 技術詳細
- エディタ検出: `document.querySelector('.ProseMirror')`
- テキスト入力: `document.execCommand('insertText')`
- 停止検知: `button[aria-label="応答を停止"]` の表示/非表示
- 送信: `KeyboardEvent('keydown', Enter)` — 🦞停止時のみ有効

### 制御
| 操作 | コマンド |
|---|---|
| ARM | `bash scripts/croppy-start.sh` または `touch /tmp/autokick-armed` |
| DISARM + 通知 | `bash scripts/croppy-done.sh 'メッセージ'` |
| 緊急停止 | `touch /tmp/autokick-stop` |

### リスクと受容
- UI変更で壊れる → 壊れたら直す（自動化優先）
- ログインセッション切れ → 手動再ログイン
- Anthropic ToSグレー → DJが受容済み

---

## 7. チェックポイント（同一チャット内リセット）

### 書式（最大200 words）
```
CHECKPOINT:
M1 synced.
ROUND: n/4
NEXT: <1行>
```

### ルール
- state/CHECKPOINTS.mdに追記
- 新チャットは原則作らない
- 200K危険域のみ最終手段として新チャット移行
- 新チャットでもM1.md + croppy-notesで復帰可能

---

## 8. トークン節約ルール

1. AI間通信は構造化英語のみ。日本語禁止
2. 応答フォーマット強制。散文禁止。PASS/FAIL形式
3. ファイル経由。コンテキスト汚染ゼロ。🦞はgrep結果だけ見る
4. 累積しない。各ラウンドは「現在の設計書 + 前ラウンドFAILだけ」
5. 出力サイズ制限。200 words以内

---

## 9. フェーズ分割

| Phase | 内容 | 状態 |
|-------|------|------|
| Phase 1 | Auto-Kick PoC + bash_tool実測 | ✅ 完了 |
| Phase 2 | Auto-Kick LaunchAgent本番化 | ✅ 完了 |
| Phase 3 | 設計レビューループの自動化 | 次に着手 |
| Phase 4 | 全体結合（DJ「1行」→完了通知まで自動） | Phase 3完了後 |

### 計測済みの値
| 項目 | 結果 |
|---|---|
| bash_tool実行時間上限 | 240-270秒 |
| 安全値 | 210秒 |

### MVP完了基準
- Auto-Kickが安定動作する（✅ 達成）
- 🦞が直接作業でタスクを完了できる
- 200 words以内で状態更新できる（✅ 達成）
- Telegram完了通知がDJに届く（✅ 達成）

---

## 10. Jarvisの役割（B-Plan以降）

### やること
- Telegram Bot（ユーザーコマンド受付、通知）
- cron（夜間バッチ、JARVIS Journal生成）
- Darwin Engine（夜間アイデア生成）

### やらないこと
- 実装作業（🦞が直接やる）
- TaskPlan実行
- 🦞との状態同期

---

*初期ディベート参加者: ChatGPT / Gemini / クロッピー🦞（全決定事項に3者合意済み）*
*B-Planディベート: 2026-02-15 ChatGPT / Gemini / 🦞（全員一致でB案採用）*
*Auto-Kick PoC: 2026-02-15 実証成功（DJ介入ゼロで自動復帰）*
