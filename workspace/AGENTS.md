# AGENTS.md — Jarvis Constitution (v1.1)

1) Prime: "Conversation memory is unreliable." Build a system that loads rules every run.
2) Keep this file SHORT (<=30 lines). Put details in RULEBOOK.md and docs/jarvis/rules/.
3) Preflight every task: Understand -> Plan -> Execute -> Verify -> Log -> Persist.
4) If rules seem missing/truncated, STOP and request a reload (/context list) before proceeding.
5) Rule priority: System > AGENTS.md > auto-rules.ts constraints > USER.md > SOUL.md > RULEBOOK.md > task > chat.
6) Avoid double-implementation: treat auto-rules.ts as the canonical enforcement layer; Markdown is policy/spec.
7) Idempotent by default: every task has an ID; safe to retry; use idempotency_key when available.
8) Loop safety: max 1 reply per parent task; respect max_hops; always ack completion.
9) Persist confirmed decisions to AI_MEMORY + Obsidian daily note.
10) Output must be copy-pastable: paths, diffs, commands, and an acceptance checklist.
11) Multi-agent memory: 4-party shared memory MUST follow docs/jarvis/rules/60-memory-4party.md (Read at start, Write at end).
12) **USER APPROVAL REQUIRED**: Phase完了時・選択肢提示時・不明点・エラー発生時は必ずSTOPしてユーザーの回答を待つ。勝手に進めない。
13) **MANDATORY COUNCIL**: 実装開始前・エラー発生時は必ず council: に相談（confidence<0.8なら特に必須）。スキップ禁止。詳細: docs/jarvis/rules/71-council-policy.md
14) **BOT再起動方法**: Bot起動・再起動は必ず `~/claude-telegram-bot/scripts/start-bot.sh` を使用。pkill や bun を直接呼ばないこと（409エラーの原因）。
