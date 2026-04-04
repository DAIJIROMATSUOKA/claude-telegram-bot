# Daily Plan — 2026-04-05 (Saturday)

**Prepared by:** JARVIS Batch Worker (04:00 JST)
**Test status:** 727 pass / 0 fail / 41 files
**Unpushed commits:** 77 (8 batch commits + prior work)

---

## Overnight Batch Results Summary

5 batch commits completed overnight:

| Batch | Content | Key Changes |
|-------|---------|-------------|
| batch1 | telegram-ux | dashboard, quick, morning, pin, typing, error-format, help-rich, botfather-menu |
| batch2 | business-shortcuts | project, customer, followup, expense, note, photo-sort, meeting, contact-log |
| batch3a | audit-p0p1 | shell-injection fix, fetch-timeout, apikey-validation, map-eviction, unused-deps |
| batch3b | system-hardening | graceful-shutdown, structured-logging, rate-limiter, config-validation, perf-tracking, message-queue, auto-retry, readme |
| batch4 | automation | weekly-digest, changelog, find, recap, notification-bundling, alias, nightly-scheduler, architecture-docs |

**P0 audit items (shell injection, fetch timeouts): FIXED in batch3a.**
**P1 audit items (api key validation, map eviction, unused deps): FIXED in batch3a.**

---

## Morning (3:00–6:00) — Review & Push

### 1. Review & Push 77 Commits ⏱️ 60 min | P0
The biggest blocker. 77 unpushed commits spanning overnight batches + prior work.
- `git log --oneline @{u}..HEAD` — scan all 77 for anything suspicious
- `git diff @{u}..HEAD --stat` — check no .env or secrets leaked
- `git push origin main` once satisfied
- **Dependencies:** None. Do this first.

### 2. Restart Bot + Smoke Test ⏱️ 15 min | P0
After push, deploy the overnight changes:
- `bash scripts/restart-bot.sh`
- Send test messages via Telegram: /dashboard, /quick, /morning, /help
- Test new business commands: /project, /customer, /followup, /expense
- Verify graceful shutdown works: `bash scripts/restart-bot.sh` again
- **Dependencies:** Push complete.

### 3. LINE Digest Real Test ⏱️ 15 min | P1
Still untested. Steps:
- Send a test LINE message to a monitored group
- Verify it arrives in Telegram Inbox
- Test LINE reply via Telegram quote-reply
- Check D1 mapping integrity
- **Dependencies:** Bot restarted.

---

## Work Hours (8:00–17:00) — Business Focus

### 4. Omori Machinery Follow-up Prep ⏱️ 90 min | P0 (Business)
- Review current status of active projects in Access DB
- Prepare any pending quotes or follow-ups
- Check calendar for upcoming meetings (use /cal)
- Draft follow-up emails if needed

### 5. M1317 伊藤ハム Progress Check ⏱️ 30 min | P1 (Business)
- Deadline: 2026-04-15 (10 days)
- Review PLC program status with 内海さん
- Check vision inspection spec (Keyence XG-X)
- Update project status in Access DB

### 6. Customer Work / Quotes ⏱️ 120 min | P1 (Business)
- Process any pending quote requests
- Review inbox for customer replies needing response
- Use new /customer and /contact-log commands for tracking

---

## Evening (19:00–22:00) — Dev Tasks

### 7. Test Coverage: P2 Audit Items ⏱️ 90 min | P2
Remaining from codebase-audit-2026-04-04.md:

| # | Target | Priority | Est. |
|---|--------|----------|------|
| 10 | claude-chat.ts tests | P2 | 20 min |
| 11 | jarvis-memory.ts tests | P2 | 20 min |
| 12 | inbox-triage.ts tests | P2 | 25 min |
| 13 | Extract JSON config loader | P2 | 15 min |
| 14 | Centralize scattered constants | P2 | 15 min |

**Recommendation:** Batch these as overnight Claude Code tasks (see Section below).

### 8. Domain Chat Knowledge Base Review ⏱️ 45 min | P2

**18 domain chats identified.** Status by category:

**Project Domains (6):** m1300, m1311, m1314, m1317, m1319, m1322
- These have case-specific context in chat-routing.yaml
- Action: Verify bootstrap prompts are current, update project statuses

**Technical Domains (4):** fa, vision, icad, access
- Knowledge bases in ~/machinelab-knowledge/
- `plc-ladder/` — patterns.md + journal.ndjson (active forge worker)
- `inspection-vision/` — patterns.md + journal.ndjson (active forge worker)
- `icad/` — patterns.md + schema.yaml + 3056 help files (richest KB)
- `access-db/` — patterns.md + schema.md + mappings.md
- Action: Check forge workers are running, review recent journal entries for unpromoted patterns

**Utility Domains (6):** inbox, secretary, pc, notion, research, debate
- Thinnest knowledge bases — mostly rely on bootstrap prompts
- Action: `pc` and `notion` domains likely need SKILL.md updates from recent sessions

**Nightly Workers (4):** forge-code, forge-plc, forge-vision, forge-research
- Self-improving via journal→patterns promotion
- Action: Verify LaunchAgents are active, check last run timestamps

**Busiest domains (estimate):** inbox > fa > access > icad > vision
**Thinnest knowledge:** pc, notion, research, debate, secretary

### 9. Skill Review ⏱️ 30 min | P2

**9 skills in claude.ai project.** Priority review:

| Skill | SKILL.md Location | Status |
|-------|-------------------|--------|
| cc-runtime | (project-level) | Core — verify trigger accuracy |
| plc-ladder | ~/machinelab-knowledge/plc-ladder/SKILL.md | Active forge → check pattern count |
| inspection-vision | ~/machinelab-knowledge/inspection-vision/SKILL.md | Active forge → check pattern count |
| icad | ~/machinelab-knowledge/icad/SKILL.md | Richest KB (604 lines + 3.9MB help) |
| access-db | ~/machinelab-knowledge/access-db/SKILL.md | Recently updated w/ COM automation |
| notion-site | ~/machinelab-knowledge/notion-site/SKILL.md | Check API endpoints current |
| misumi-procurement | ~/machinelab-knowledge/misumi-procurement/ | Check if patterns.md exists |
| manual-authoring | ~/machinelab-knowledge/manual-authoring/ | Check if patterns.md exists |
| webapp-chat-api | (unknown) | Locate and verify |

**Action:** For each, grep compressed history for recent learnings not yet in SKILL.md.

---

## Quick Wins (< 10 min each)

| Task | Time | Notes |
|------|------|-------|
| `bun test` verify | 1 min | Already passing (727/727) |
| Check LaunchAgent status | 3 min | `launchctl list \| grep jarvis` |
| Verify task-poller alive | 2 min | Check /tmp/task-poller-pid |
| Review /morning output | 3 min | Test new morning briefing feature |
| Test /find command | 3 min | New from batch4 |
| Test /recap command | 3 min | New from batch4 |
| Test /alias command | 3 min | New from batch4 |

---

## Claude Code Overnight Batch Candidates (April 5→6)

These tasks are safe for autonomous execution:

```
# Batch 5: P2 Test Coverage
1. Add tests for claude-chat.ts (mock subprocess, verify routing)
2. Add tests for jarvis-memory.ts (mock gateway, verify CRUD)
3. Add tests for inbox-triage.ts (mock external API, verify classification)

# Batch 6: P2 Code Quality
4. Extract JSON config loader utility (replace 16+ JSON.parse(readFileSync) patterns)
5. Centralize scattered constants into config.ts (media-commands, jarvis-memory, croppy-bridge, orchestrator-chrome, memory-gc)

# Batch 7: P2 Feature Completion
6. Implement croppy-bridge task queue (TODO at line 276)
7. Implement inbox-triage LINE/Gmail reply (TODO at line 788)

# Batch 8: Domain Chat Improvements
8. Update domain chat bootstrap prompts with current project statuses
9. Promote unpromoted journal entries in plc-ladder and inspection-vision
10. Create/update SKILL.md for misumi-procurement and manual-authoring
```

---

## Remaining Audit Items (Post-April 5)

| # | Item | Priority | Status |
|---|------|----------|--------|
| 10-12 | P2 test coverage | P2 | Batch candidate tonight |
| 13-14 | JSON loader + constants | P2 | Batch candidate tonight |
| 15-16 | Croppy queue + inbox reply TODOs | P2 | Batch candidate tonight |
| 17 | Split commands.ts (1236 lines) | P3 | Next week |
| 18 | Split inbox.ts callback (150 lines) | P3 | Next week |
| 19 | Reduce session.ts nesting | P3 | Next week |
| 20 | Convert sync I/O to async (150+ calls) | P3 | Multi-day effort |
| 21 | Normalize .then/.catch to async/await | P4 | Low priority |
| 22 | Replace require() with ES imports | P4 | Low priority |

---

## Infrastructure Notes

- **Python Agent SDK migration:** Not urgent. Current CLI approach works. Revisit when Agent SDK stabilizes.
- **Auto-handoff for PC domain:** Needs chat-routing.yaml URL update after next PC session.
- **WIP items from WIP.md:** Slack→Telegram, deep-night detection, Apple Messages — all P3+, not for today.

---

*Plan generated at 2026-04-05 04:00 JST. Reference: docs/codebase-audit-2026-04-04.md*
