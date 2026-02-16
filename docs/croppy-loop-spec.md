# 🦞 自律ループ仕様書 (Plan D)
**日付:** 2026-02-17
**ステータス:** ディベート完了 → 設計フェーズ
**決定:** 案D採用（全員一致）

**却下案:**
- 案A (exec bridgeループのみ): 🦞死亡時に復帰不可
- 案B (M1オーケストレータ新設): 🦞の通訳・品質管理が失われる
- 案C (ワンショット計画書): ステップ間の検証・方針転換不可

---

## 1. 概要

DJの1行指示から、🦞が自律的にClaude Codeをspawn→検証→再spawnするループ。
🦞が死んでもM1.mdに状態永続化 → Auto-Kick復帰 → ループ再開。

```
DJ「バグ直せ」(1行だけ)
  → 🦞: 計画策定 → M1.mdに書く
  → 🦞: exec bridge --fire (claude -p)
  → 🦞: --check ポーリング (完了待ち)
  → 🦞: 結果読む → 検証 → M1.md更新
  → 🦞: 次ステップspawn or 完了報告
  → (🦞が死んだら → Auto-Kick → M1.md読んで再開)
  → DJ「終わったよ」(Telegram通知)
```

---

## 2. M1.md フォーマット拡張

```markdown
STATUS: RUNNING              # IDLE / RUNNING / WAITING / DONE / FAILED
GOAL: /editのSIGTERMバグを修正
CONSTRAINTS: ai-media.pyのみ変更、media-commands.ts触るな

PLAN:
  TOTAL_STEPS: 3
  CURRENT_STEP: 2
  STEPS:
    1: [DONE] SIGTERMバグ調査 → docs/edit-sigterm-analysis.md
    2: [RUNNING] Fix1-5実装 → ai-media.py
    3: [PENDING] 実戦テスト → /edit --steps 1

CURRENT:
  TASK_ID: task_xxx           # exec bridge task ID (--fire)
  CC_PID: 99356               # Claude Code PID on M1
  SPAWN_TIME: 2026-02-17T05:30:00
  COMMAND: "docs/edit-sigterm-analysis.mdの修正案Fix1-5を全て..."

RESULTS:
  STEP_1:
    EXIT: 0
    COMMIT: a690fb3
    SUMMARY: 分析レポート作成完了。5つの修正案。
    VERIFIED: true
  STEP_2:
    EXIT: (pending)

LAST_ACTION: Step 2 spawned via exec bridge --fire
NEXT_ACTION: --check TASK_ID で完了確認 → 結果検証 → Step 3へ
```

---

## 3. 🦞ループのフロー

### Phase 1: 計画策定
```
DJ「バグ直せ」
🦞:
  1. タスクを分解（調査→実装→テスト）
  2. M1.mdに計画書き込み (STATUS: RUNNING)
  3. DJに「3ステップで進める。放置してて」と報告
```

### Phase 2: ステップ実行ループ
```
while CURRENT_STEP <= TOTAL_STEPS:
  1. 指示文を組み立てる（🦞の通訳力）
  2. exec bridge --fire でClaude Code spawn
  3. M1.mdにTASK_ID, CC_PID, COMMAND記録
  4. --check ポーリング（30秒間隔）
     - 完了待ちの間、/tmp/croppy-stop チェック
  5. 完了検知 → 結果取得
  6. 🦞が結果を検証（品質管理）
     - OK → RESULTS記録、CURRENT_STEP++
     - NG → 修正指示を組み立てて再spawn
  7. M1.md更新
```

### Phase 3: 完了
```
全ステップ完了:
  1. M1.md STATUS: DONE
  2. exec bridge --notify でTelegram通知
  3. git push (必要なら)
```

### Phase 4: 障害復帰 (Auto-Kick後)
```
🦞が死んだ → Auto-Kickで復帰:
  1. M1.md読む
  2. STATUS: RUNNING → ループ再開
  3. CURRENT の TASK_ID を --check
     - まだ動いてる → ポーリング継続
     - 完了してた → 結果検証から再開
     - 失敗してた → 再spawn
  4. NEXT_ACTION を実行
```

---

## 4. 実装に必要な変更

### 変更不要（既存）
- exec bridge (exec.sh, --fire, --check) ✅
- Auto-Kick Watchdog ✅
- M1.md (autonomous/state/) ✅
- Claude Code + nohup pattern ✅
- /tmp/croppy-stop 緊急停止 ✅

### 🦞側の変更（コード不要、手順のみ）
- 🦞がM1.mdを読み書きする手順を確立
- exec bridge経由でM1.mdを更新するワンライナー
- Auto-Kick復帰時に🦞がM1.mdを最初に読む約束

### 任意の改善
- M1.md更新用のヘルパースクリプト（`scripts/update-m1.sh`）
- --check結果をM1.mdに自動追記
- ステップ間のTelegram進捗通知

---

## 5. 🦞の復帰手順（Auto-Kick後）

新チャットで🦞が最初にやること:
```
1. exec bridge → cat autonomous/state/M1.md
2. STATUS確認:
   - IDLE → 「何する？」とDJに聞く（従来通り）
   - RUNNING → ループ再開（Phase 4）
   - WAITING → DJの判断待ち
   - DONE → 「終わってるよ」と報告
   - FAILED → 原因確認→リカバリ
3. NEXT_ACTION を実行
```

---

## 6. 安全装置

| 装置 | 仕組み |
|---|---|
| /tmp/croppy-stop | 🦞ループ即停止（DJ手動） |
| MAX_RETRIES: 3 | 同一ステップ3回失敗 → FAILED、DJ判断待ち |
| MAX_STEPS: 10 | 計画肥大化防止 |
| TIMEOUT: 60min/step | 1ステップ60分超 → 異常停止 |
| M1.md STATUS: WAITING | 🦞が判断できない時はDJに聞く |

---

## 7. テスト計画

### Phase 1テスト（最小）
1. DJが「FEATURE-CATALOGに/codeセクション追加して」と指示
2. 🦞がM1.md書く → Claude Code spawn → 結果検証 → 完了報告
3. 1ステップのループが回ることを確認

### Phase 2テスト（復帰）
1. 2ステップの計画を実行中に🦞のチャットを閉じる
2. Auto-Kick or 新チャットで復帰
3. M1.md読んでループ再開できることを確認

---

## 8. 既存フローとの関係

| フロー | 用途 | 変更 |
|---|---|---|
| DJ → /code (Telegram直通) | 単発タスク | なし |
| DJ → 🦞 → 対話 | 設計・ディベート | なし |
| DJ → 🦞 → 自律ループ (NEW) | 複数ステップの自律作業 | M1.md拡張 |
| DJ → /debate | 3AI評議会 | なし |
