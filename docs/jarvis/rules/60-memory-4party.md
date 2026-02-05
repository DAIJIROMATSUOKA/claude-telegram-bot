# 60-memory-4party.md — 4-AI Shared Memory Protocol (v1.0)

Purpose:
- ChatGPT / Claude / Gemini / OpenClaw の4者が「同じ記憶」を読む/書くための統一プロトコル。
- 共有記憶は "Gateway(D1)" をSSOT（Single Source of Truth）にし、必要に応じて AI_MEMORY と Obsidian に同期する。

Dependencies:
- 00-config.md / 30-memory-ai_memory.md / 40-obsidian.md / 50-gateway-v1.md
- AGENTS.md の forget-proof / idempotent / loop-safety を継承する。

------------------------------------------------------------
0) Non‑negotiables (MUST)
------------------------------------------------------------
MUST-1: 毎run/毎タスクの開始時に、必ず共有メモリを読み込む（Read）。
MUST-2: 終了時に、確定事項だけを共有メモリへ追記する（Write）。
MUST-3: Secrets / tokens / credentials / 個人情報（PII）は保存しない。
MUST-4: 共有メモリは append-only（イベントログ）。上書きはしない。
MUST-5: すべての書き込みは idempotent（重複しても安全）であること。
MUST-6: 「読めない/書けない」状態で推測運用しない。必ず "読めないので再提示/権限/接続を要求" して止める。

------------------------------------------------------------
1) Actors & Identity (SSOT: agent_id)
------------------------------------------------------------
agent_id は必ず以下のいずれか（ASCII小文字）:
- chatgpt
- claude
- gemini
- openclaw

Permissions:
- 読み取り: global / project:* は全員OK
- 書き込み: global / project:* は全員OK（ただし MUST-2 準拠）
- agent:* (private) は本人だけ書ける（Gateway側で強制）
- 他者の agent:* は原則読めない（必要なら "共有に昇格" して global/project に書く）

------------------------------------------------------------
2) Memory Model (2-layer)
------------------------------------------------------------
L1: Shared Event Log (SSOT)
- Gateway(D1) に「メモリイベント」を追記していく（append-only）。

L2: Curated Pins (短い要約)
- Event Log を "memory_janitor" が圧縮して「Pinned memory」を生成。
- Pinned は "人間が読める短文" を最優先（長文化禁止）。

Durable replicas (optional but recommended):
- AI_MEMORY: 確定した重要決定の長期保管（30-memory-ai_memory.md）
- Obsidian: 日次ログ・作業ログ（40-obsidian.md）
NOTE: Replica は SSOT ではない。SSOT は Gateway(D1)。

------------------------------------------------------------
3) What to store / not store
------------------------------------------------------------
Store (OK):
- 確定した意思決定、設定値、ファイルパス、URL(※), ルール、運用手順、既知のバグ、重要な制約
- 「何が変わったか（diff）」と「いつから有効か」
- 後続が迷わない "短い理由" (1行)

Do NOT store (NG):
- APIキー/トークン/パスワード/秘密のURL、個人情報、未確認の推測、雑談ログ全文
- 長文の議論全文（必要なら "要約" のみ）

URL 取り扱い:
- URLを保存する場合は "公開してよい/社内でよい" を明示し、必要最小限。
- 不確実なら URL は保存せず「参照元の名前＋要点」にする。

------------------------------------------------------------
4) Read Protocol (every run)
------------------------------------------------------------
Every run MUST:
R-1: memory snapshot を取得
R-2: pinned -> recent の順に読み、現在の判断基準を確定
R-3: 読み込みが欠落/古い/矛盾なら、作業を止めて修復フローへ

Gateway call (logical):
- GET /v1/memory/snapshot?agent_id={agent_id}&scopes=global,project:{project_slug}&limit_recent=50
Return must include:
- pinned_md (short)
- recent_events (list)
- ruleset_stamp (e.g., JARVIS_RULESET=v1.0)
- snapshot_id (for audit)

If read fails:
- 「共有メモリが読めない」ことを明言し、ユーザーに復旧アクションを要求して停止。
- 例: "Gateway疎通/権限/エンドポイント" の確認を依頼。
- 推測で継続しない（MUST-6）。

------------------------------------------------------------
5) Write Protocol (end of run)
------------------------------------------------------------
Write gating:
W-0: "確定したものだけ" 書く。未確定は書かない（MUST-2）。
W-1: 1タスクで書くのは最大 3〜7件。粒度は「後で効く」単位。
W-2: 既存と重複しそうなら query してから書く（または dedupe_key で衝突回避）。
W-3: 重要な更新は "supersedes" を付けて旧情報を明示的に無効化する（上書きしない）。

Gateway call (logical):
- POST /v1/memory/append
Payload: memory_event (see §6)

After write:
- 返ってきた event_id / status をログに残す。
- 書き込み失敗なら「書けなかった」を明言し、再実行可能な形で内容を提示。

------------------------------------------------------------
6) Memory Event Schema (canonical)
------------------------------------------------------------
Canonical JSON (logical):
{
  "agent_id": "chatgpt|claude|gemini|openclaw",
  "run_id": "string (unique per run)",
  "scope": "global | project:<slug> | agent:<agent_id>",
  "kind": "decision|config|constraint|workflow|fact|bug|todo|log|deprecation",
  "dedupe_key": "stable-ascii-key (<=64 chars)",
  "confidence": "high|med|low",
  "content_md": "human-readable markdown (<=1200 chars recommended)",
  "source": {
    "system": "telegram|cli|web|other",
    "thread_id": "optional",
    "message_id": "optional"
  },
  "supersedes": "event_id (optional)",
  "ttl_days": 0
}

Field notes:
- agent_id: 書き込んだAI（chatgpt / claude / gemini / openclaw）
- run_id: 実行単位（UUID推奨）。デバッグ用。
- scope: グローバル or プロジェクト or エージェント専用。
- kind: 記憶の種類（decision=意思決定, config=設定, constraint=制約, など）
- dedupe_key: 重複検出用の安定キー（例: "telegram_bot_token_location"）
- confidence: 確度（high=確定, med=暫定, low=推測）
- content_md: Markdown形式の内容（1200文字推奨上限）
- source: この記憶の出処（Telegram, CLI, Webなど）
- supersedes: この記憶が無効化する古い event_id
- ttl_days: 保持期間（0=永続, >0=日数後に削除候補）

------------------------------------------------------------
6a) dedupe_key rules
------------------------------------------------------------
dedupe_key は「同じことを二重に書かない」ための安定キー。

Rule:
- ASCII小文字 + 数字 + アンダースコア/ハイフン（`[a-z0-9_-]+`）のみ
- 最大64文字
- 意味的に stable（例: "config:ai_memory_doc_id", "decision:ssot_is_gateway"）
- 同一 scope 内で unique が望ましい（重複時は last-write-wins）

Examples (GOOD):
- "config:telegram_bot_token_location"
- "decision:memory_ssot_2026_02"
- "bug:gateway_auth_401"
- "constraint:no_secrets_in_memory"

Examples (BAD):
- "abc123" (意味不明)
- "CONFIG:FOO" (大文字NG)
- "決定_20260202" (非ASCII NG)
- "this-is-a-very-long-key-that-exceeds-sixty-four-characters-limit-bad" (64文字超過)

Collision strategy:
- 同じ dedupe_key で複数イベントがある場合、最新の event_id が優先
- ただし confidence=high が confidence=low を上書きする時は警告

------------------------------------------------------------
6b) content_md style
------------------------------------------------------------
content_md は「人間が後で読んで迷わない」短文が最優先。

Style guide:
- 1〜5行の短文 + 必要なら箇条書き
- 「誰が」「何を」「なぜ」「いつから」を明記
- 専門用語は避けるか、最小限に
- 長文は NG（1200文字推奨上限）

Good example:
```
TELEGRAM_BOT_TOKEN は ~/claude-telegram-bot/.env に保存（2026-02-02から有効）

理由: セキュリティ向上のため、環境変数で管理。
影響: 以前の .env.local は廃止。
```

Bad example:
```
今日ユーザーとTelegramボットのトークンをどこに置くか議論した結果、色々な選択肢があったけど最終的には環境変数に入れることにしました。理由としては、セキュリティ的に良いというのと、Cloudflare Workersとの連携もあって、それで今後は .env ファイルを使うことになりました。以前は .env.local を使っていましたがこれは廃止します。（長すぎ＋冗長）
```

------------------------------------------------------------
7) Conflict & Consolidation
------------------------------------------------------------
Conflict types:
C-1: 同じdedupe_keyで異なる内容
- Last-write-wins（新しいevent_idが優先）
- ただし confidence=high が confidence=low を上書きする時は警告

C-2: supersedes で無効化された古いevent
- 古いeventは "deprecated" とマークされ、読み込み時は無視

C-3: 読み取り時に矛盾を検知
- memory_janitor が "conflict_resolution" イベントを生成して人間/AIに確認依頼

Consolidation (memory_janitor):
- 定期的に Event Log を圧縮して Pinned memory を更新
- 同一 dedupe_key で複数イベントがある場合、最新のみを Pinned に含める
- ttl_days が過ぎたイベントは削除候補にマーク（人間承認後に削除）

------------------------------------------------------------
8) Security & Redaction (MUST)
------------------------------------------------------------
MUST-S1: Secrets は絶対に保存しない
- APIキー、トークン、パスワード、OAuth secrets
- 例外なし。「一時的に」も NG。

MUST-S2: PII (Personal Identifiable Information) は保存しない
- メールアドレス、電話番号、クレジットカード番号、住所
- ユーザー名は OK（ただし本名でない場合のみ）

MUST-S3: URL の取り扱い
- 公開URLは OK
- 社内URL/プライベートURLは「名前＋要点」に置き換え
- 不明な場合は保存しない

MUST-S4: Redaction（書き込み前チェック）
- AI は書き込み前に content_md をスキャンし、以下をチェック:
  - "token", "key", "password", "secret" が含まれていないか
  - Email regex: `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`
  - Phone regex: `(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}`
- マッチした場合は「書き込まない」＋「ユーザーに警告」

MUST-S5: 読み取り時の検証
- memory_janitor が定期的に Event Log をスキャンし、secrets/PII を検出
- 検出された場合は即座に redact（削除 or マスク）し、audit log に記録

------------------------------------------------------------
9) Minimal Prompt Injection (per agent)
------------------------------------------------------------
各AIのシステムプロンプトに以下を追加（または類似の短文）:

```
JARVIS 4-Party Memory Protocol (v1.0):
- Run開始時: GET /v1/memory/snapshot で共有メモリを読み込む（MUST-1）
- Run終了時: 確定事項のみ POST /v1/memory/append で書き込む（MUST-2）
- Secrets / PII は絶対に保存しない（MUST-3）
- 読み込み失敗時は推測で継続せず、ユーザーに復旧依頼（MUST-6）
- 詳細: ~/claude-telegram-bot/docs/jarvis/rules/60-memory-4party.md
```

Implementation note:
- ChatGPT: Custom Instructions or System Prompt
- Claude: System Prompt (via API or CLI config)
- Gemini: System Instructions
- OpenClaw: config.yaml or equivalent

------------------------------------------------------------
10) Acceptance Checklist
------------------------------------------------------------
Protocol implementation:
- [ ] 各AI（ChatGPT / Claude / Gemini / OpenClaw）のシステムプロンプトに §9 の短文を追加
- [ ] Gateway(D1) に memory_events テーブル作成（event_id, agent_id, scope, kind, dedupe_key, confidence, content_md, source, supersedes, ttl_days, created_at）
- [ ] GET /v1/memory/snapshot エンドポイント実装（pinned_md + recent_events 返却）
- [ ] POST /v1/memory/append エンドポイント実装（dedupe_key 衝突検出 + supersedes 処理）
- [ ] 各AIが run 開始時に snapshot を読み込む（MUST-1）
- [ ] 各AIが run 終了時に確定事項を append（MUST-2）
- [ ] Secrets / PII 検出ロジック実装（MUST-S4）

Operational:
- [ ] memory_janitor スクリプト作成（圧縮・cleanup・conflict検出）
- [ ] /memory コマンド実装（CLI: list / search / cleanup / consolidate）
- [ ] AI_MEMORY との同期スクリプト（定期実行）
- [ ] Obsidian 日次ログへの同期スクリプト（optional）

Testing:
- [ ] 各AIが同一 dedupe_key で書き込んだ時の衝突解決を確認
- [ ] supersedes による無効化が正しく動作するか確認
- [ ] Secrets / PII を含むテキストが拒否されるか確認
- [ ] 読み込み失敗時に各AIが停止するか確認（MUST-6）

------------------------------------------------------------
11) Lifecycle & Cleanup
------------------------------------------------------------
memory_janitor (cron / periodic):
- Event Log を圧縮して Pinned memory を更新
- ttl_days > 0 のイベントを削除候補に
- conflict を検出して resolution イベント生成

Manual cleanup:
- /memory cleanup --older-than=30d --scope=agent:*
- 人間による承認必須（MUST）

Backup:
- Gateway(D1) は定期バックアップ（Cloudflare D1の機能利用）
- AI_MEMORY / Obsidian も独立バックアップ

------------------------------------------------------------
12) Migration & Versioning
------------------------------------------------------------
Ruleset versioning:
- このファイル自体が "JARVIS_RULESET=v1.0" を定義
- 将来 v2.0 が出たら、snapshot に ruleset_stamp を含めて互換性チェック

Schema evolution:
- 新フィールド追加は後方互換（古いAIは無視してOK）
- 破壊的変更は新 scope を作る（例: global_v2）

------------------------------------------------------------
13) Examples
------------------------------------------------------------
Example 1: Claude が Telegram Bot の設定変更を記録
{
  "agent_id": "claude",
  "run_id": "run_2026_02_02_001",
  "scope": "global",
  "kind": "config",
  "dedupe_key": "telegram_bot_token_location",
  "confidence": "high",
  "content_md": "TELEGRAM_BOT_TOKEN は ~/claude-telegram-bot/.env に保存（2026-02-02から有効）",
  "source": {
    "system": "telegram",
    "thread_id": "thr_abc123"
  },
  "supersedes": null,
  "ttl_days": 0
}

Example 2: ChatGPT がバグを記録
{
  "agent_id": "chatgpt",
  "run_id": "run_2026_02_02_002",
  "scope": "project:memory-gateway",
  "kind": "bug",
  "dedupe_key": "gateway_auth_401_issue",
  "confidence": "high",
  "content_md": "Gateway API Key が無効（401エラー）。原因: API Keyの有効期限切れ。対処: 新しいKeyを発行して更新。",
  "source": {
    "system": "cli"
  },
  "supersedes": null,
  "ttl_days": 90
}

Example 3: Gemini が意思決定を記録
{
  "agent_id": "gemini",
  "run_id": "run_2026_02_02_003",
  "scope": "global",
  "kind": "decision",
  "dedupe_key": "memory_protocol_v1",
  "confidence": "high",
  "content_md": "4者共有メモリは Gateway(D1) をSSOTとし、append-onlyで運用（2026-02-02決定）",
  "source": {
    "system": "web"
  },
  "supersedes": null,
  "ttl_days": 0
}

------------------------------------------------------------
14) Implementation Checklist (Legacy - see §10 for full checklist)
------------------------------------------------------------
Gateway side (Workers):
- [ ] POST /v1/memory/append エンドポイント実装
- [ ] GET /v1/memory/snapshot エンドポイント実装
- [ ] D1テーブル設計（memory_events, memory_pins）
- [ ] dedupe_key による重複検出
- [ ] supersedes による無効化処理

AI side (各AI):
- [ ] 毎run開始時に snapshot 取得（MUST-1）
- [ ] 終了時に確定事項を append（MUST-2）
- [ ] Secrets を保存しない（MUST-3）
- [ ] 読み込み失敗時は停止（MUST-6）

Tooling:
- [ ] memory_janitor スクリプト（圧縮・cleanup）
- [ ] /memory コマンド（CLI）
- [ ] Telegram Bot からの memory 操作コマンド

------------------------------------------------------------
15) FAQ
------------------------------------------------------------
Q: AI_MEMORY と Gateway はどう使い分ける？
A: Gateway は「短期〜中期の運用記憶」、AI_MEMORY は「長期の重要決定」。Gateway で確定したものを定期的に AI_MEMORY へ同期。

Q: 4者全員が同時に書き込んだら？
A: Last-write-wins（新しい event_id が優先）。conflict は memory_janitor が検出。

Q: プライベートな記憶は？
A: scope=agent:<agent_id> を使う。他のAIは読めない。

Q: 古い記憶の削除は？
A: ttl_days > 0 で自動削除候補に。ttl_days=0 は永続。手動削除は人間承認必須。

Q: Obsidian との連携は？
A: Obsidian は日次ログとして独立運用。Gateway から定期同期も可（40-obsidian.md参照）。

------------------------------------------------------------
End of 60-memory-4party.md (v1.0)
------------------------------------------------------------
