# 自律実装フロー仕様書（autonomous-workflow-spec.md）
# v3.2 MVP — ディベート全決定事項含む

---

## DJ運用イメージ（こんなことができるようになる）

### Before（今）
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

### After（この機能完成後）
```
DJ「○○を作りたい」
  → クロッピーが設計
  → クロッピーが自動でChatGPTにレビュー依頼（exec bridge経由）
  → クロッピーが自動でGeminiにレビュー依頼（exec bridge経由）
  → クロッピーがFAIL項目だけ見て設計改善（grepでトークン節約）
  → 最大4ラウンドで自動収束
  → クロッピーがDJに最終設計を提示
DJ「GO」
  → クロッピーがTaskPlanを作ってJarvisに投入（exec.sh --fire）
  → クロッピーがpoll_job.shで自動待機
  → Jarvisが実装・テスト
  → 問題発生 → クロッピーが自動でエラー分析・修正パッチ投入
  → 最大4ラウンドで自動解決
  → クロッピーがDJに完了報告
```
DJの作業: 「○○を作りたい」+「GO」の2回だけ

### もしクロッピーのセッションが切れても
```
  → Jarvisは最後まで作業を続ける（中断しない）
  → 完了/失敗をTelegram通知
  → DJが次にclaude.aiを開いた時
  → クロッピーが --check で結果を自動回収
  → 途中からシームレスに再開
```

---

## 0. 最優先原則

- DJ介入最小化（「1行投げたら基本触らない」）
- 最小実装 → 実測 → 必要なら拡張（YAGNI）
- 1チャット完結（Thread分離しない）
- Claude = 制御エンジン、外部ファイル = 記憶装置
- 🦞タイムアウトでもJarvisは継続（絶対ルール）

---

## 1. ディベート決定事項

### [DECIDED] 状態マシン化
Claude（🦞）は状態のみ保持。設計全文・レビュー全文・ログ全文は外部ファイルに置く。
- 投票: ChatGPT賛成 / Gemini賛成 / 🦞賛成
- 却下案: 全文をコンテキストに保持する方式（200K窓を急速に消費するため却下）

### [DECIDED] ID参照体系
`D0001@a13c` 形式（連番+hash4）で外部ファイルを参照。
- 投票: ChatGPT賛成 / Gemini賛成 / 🦞賛成
- 却下案: ファイル名のみの参照（取り違えリスクがあるため却下）

### [DECIDED] ディレクトリ構造は最小3つ
state/ logs/ reviews/ のみ。追加は必要時。
- 投票: ChatGPT賛成 / Gemini強く賛成 / 🦞賛成
- 却下案: 8ディレクトリ構造（管理コストが高く、LLMの推論コストも増えるため却下）

### [DECIDED] レビュー形式はPASS/FAIL
S/A/B重大度は不採用。PASS/FAIL -> FIX形式。
- 投票: ChatGPT賛成 / Gemini強く賛成 / 🦞賛成
- 却下案: S/A/B重大度（判定基準が揺らぎやすく、パース処理が複雑になるため却下）

### [DECIDED] Thread分離は不採用
1チャット完結。論理分離はファイルベースで実現。
- 投票: ChatGPT賛成 / Gemini賛成 / 🦞賛成
- 却下案: 設計/実装/例外解析で別チャット（DJの手動切替が必要で自動化に逆行するため却下）

### [DECIDED] モデル切替はJarvis側のみ
claude.ai上の🦞はモデル固定。Jarvis CLIのみ--modelで切替。
- 投票: ChatGPT賛成 / Gemini賛成 / 🦞賛成
- 却下案: claude.ai上でのモデル切替（DJの手動操作が必要なため却下）

### [DECIDED] チェックポイントは同一チャット内リセット
新チャット移行は200K危険域の最終手段のみ。
- 投票: ChatGPT賛成 / Gemini賛成 / 🦞賛成
- 却下案: ラウンドごとの新チャット移行（DJの手動操作が必要なため却下）

### [DECIDED] ERRSIG体系は不採用
exit code + stderr最後5行 + ログ参照IDで十分。
- 投票: ChatGPT賛成 / Gemini賛成 / 🦞賛成
- 却下案: E042式エラーコード体系（未知エラーに弱く管理コストが高いため却下）

### [DECIDED] TaskPlanは既存Orchestrator形式
新スキーマを定義しない。差分フィールドのみ追加。
- 投票: ChatGPT賛成 / Gemini必須と評価 / 🦞賛成
- 却下案: 独自TaskPlan JSONスキーマ（二重定義リスクのため却下）

### [DECIDED] Extended Thinkingは実測後に判断
常時ON/OFFを決め打ちしない。
- 投票: ChatGPT賛成 / Gemini賛成 / 🦞賛成

### [DECIDED] poll_job.sh自己継続方式
bash_tool実行時間上限に依存しない設計。スクリプト出力に「次に実行すべきコマンド」を含める。
- 投票: ChatGPT提案 → Gemini改善 → 🦞採用
- 却下案: bash_tool内17分whileループ（bash_tool上限が短い場合に死ぬため却下）
- 却下案: Gateway long-poll方式（bash_toolタイムアウト不整合リスクのため却下）

---

## 2. 外部ファイル構造

```
~/claude-telegram-bot/autonomous/
  state/
    M1.md              # 唯一の真実（状態ファイル）
    CHECKPOINTS.md      # チェックポイント履歴（追記）
  logs/
    L-0001.txt          # ジョブログ
  reviews/
    R-gpt-0001.md       # ChatGPTレビュー結果
    R-gem-0001.md       # Geminiレビュー結果
```

追加ディレクトリ（必要時のみ）: designs/ taskplans/ patches/ reports/

---

## 3. 状態ファイル（state/M1.md）

最大200 words。常に上書き。冗長説明禁止。

```
STATUS: PASS|FAIL|RUNNING
GOAL: <1行>
CONSTRAINTS:
- <最大3行>
CURRENT:
  TASK_ID: <T-xxxx or NONE>
  LOGREF: <L-xxxx or NONE>
OPEN_K: <K1,K2,K3 or NONE>
ROUND: n/4
LAST_ACTION: <1行>
NEXT_ACTION: <1行>
```

---

## 4. Phase 1: 設計（多段レビューループ）

### フロー
```
DJ「○○を作りたい」
  → 🦞 設計書をM1ファイルに書く
  → 🦞 exec bridge → ChatGPTにレビュー依頼 → 結果をreviews/に保存
  → 🦞 exec bridge → grep FAIL reviews/R-gpt-xxxx.md（数行だけコンテキストに入る）
  → 🦞 FAIL項目があれば設計書を更新（exec bridgeでsed/patch）
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

## 5. Phase 2: 実装（Jarvis委譲 + 例外時のみ🦞介入）

### フロー
```
DJ「GO」
  → 🦞 TaskPlan作成（既存Orchestrator形式）
  → 🦞 exec.sh --fire でJarvisに投入 → task_id取得
  → 🦞 poll_job.sh task_id で待機
  → 結果に応じて分岐
```

**EXIT:0（成功）:**
```
  → 🦞 DJに報告（PASS: 1行サマリー）
```

**EXIT:1（失敗）:**
```
  → 🦞 LAST5を分析、修正パッチ生成
  → 🦞 exec.sh --fire で修正投入
  → 🦞 poll_job.sh で再待機
  → ROUND++（最大4）
```

**EXIT:2（まだ実行中）:**
```
  → 🦞 出力のACTIONコマンドをそのまま実行（自動再入）
```

**🦞セッション切れ:**
```
  → 🤖 Jarvisは最後まで作業を続行（中断しない）
  → 🤖 完了/失敗をTelegram通知
  → DJ 次にclaude.aiを開いた時
  → 🦞 exec.sh --check task_id で結果回収
  → state/M1.md + task_idで途中から再開
```

### 絶対ルール
1. --fireで投げたジョブは🦞の生死に関係なくJarvisが最後まで実行する
2. 🦞はJarvisの全ログを見ない。LAST5（stderr最後5行）のみ
3. 🦞が落ちてもM1.md + task_idで再開可能

---

## 6. poll_job.sh 仕様

### 入力
```
./poll_job.sh <task_id> [poll_interval] [max_seconds]
```
- task_id: 必須
- poll_interval: デフォルト15秒
- max_seconds: デフォルト270秒（bash_tool上限5分想定、30秒マージン）

### 出力フォーマット（固定）

**成功:**
```
EXIT:0
STATUS:DONE
NEXT:NONE
SUM:All tests passed
```

**実行中（自動継続）:**
```
EXIT:2
STATUS:RUNNING
NEXT:ACTION ./poll_job.sh <task_id>
SUM:Still running
```

**失敗:**
```
EXIT:1
STATUS:FAIL
NEXT:PATCH
SUM:Tests failed
LAST5:
<stderr last 5 lines>
LOGREF:logs/L-xxxx.txt
```

**ジョブ不在:**
```
EXIT:99
STATUS:NOT_FOUND
NEXT:NONE
SUM:Job does not exist
```

### 動作
1. 開始時刻を記録
2. ループ: exec.sh --check task_id
   - done → 結果を整形、exit 0
   - processing/pending → sleep poll_interval、ループ継続
   - 経過時間 > max_seconds → RUNNING出力（ACTION付き）、exit 0
3. 全ての出力をexit 0で返す（bash_toolにエラーと誤認させない）

### 設計判断
- max_seconds 270秒は仮値。bash_tool実測後に調整
- poll_interval 15秒: Gateway HTTP GET 1回で軽量
- SUM 1行のみ: トークン節約。全文はLOGREFで参照

---

## 7. チェックポイント（同一チャット内リセット）

### 目的
履歴肥大を防ぎ、状態を再宣言して古い文脈依存を断つ。

### 書式（最大200 words）
```
CHECKPOINT:
M1 synced.
ROUND: n/4
TASK: T-xxxx
NEXT: <1行>
```

### ルール
- state/CHECKPOINTS.mdに追記
- 新チャットは原則作らない
- 200K危険域のみ最終手段として新チャット移行
- 新チャットでもM1.md + CHECKPOINTS.mdだけで復帰可能

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
| Phase 1 | poll_job.sh実装 + bash_tool実測 | 次に着手 |
| Phase 2 | Jarvisジョブ1つを自動完走させる | Phase 1完了後 |
| Phase 3 | Phase 1レビューループの自動化 | Phase 2完了後 |
| Phase 4 | 全体結合（DJ「GO」→完了報告まで自動） | Phase 3完了後 |

### Phase 1 着手条件
- この仕様書がM1に保存されていること

### MVP完了基準
- poll_job.shが固定フォーマットで動く
- 1つのJarvisジョブが自動で完走する
- 🦞が200 words以内で状態更新できる
- ROUND制御が機能する

---

## 10. 実装前に計測すべき値

| 項目 | 計測方法 | 影響 |
|---|---|---|
| bash_tool実行時間上限 | sleep 300で実測 | poll_job.shのmax_seconds決定 |
| 1ターン内bash_tool呼び出し回数上限 | poll_job.sh再入を繰り返して実測 | 待機可能な最大時間の決定 |

---

*ディベート参加者: ChatGPT / Gemini / クロッピー🦞*
*全決定事項に3者合意済み*

---

## 11. 自動復帰（Auto-Kick）

### 定義
🦞が同一チャット内で応答停止した時、外部から自動入力して再開させる仕組み。新チャットではない。

### Before（今）


### After


### 利点
- 新チャット不要 → コンテキスト消失なし
- DJ介入ゼロ
- M1.md読み直し不要（同一セッション）

### 実装フェーズ
Phase 1完了後に着手（poll_job.sh + M1.md運用が先）

### 実装方針（未確定）
- 検知: Jarvisがclaude.aiの応答タイミングを監視
- キック: osascript or Chrome拡張でDOMに文字入力+送信
- リスク: UI変更で壊れる → 壊れたら直す（自動化優先）
