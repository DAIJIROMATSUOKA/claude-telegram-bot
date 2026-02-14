# Task Orchestrator Completion Roadmap

## Current: Phase 2a DONE (test generation, 6/6 stable)

## Phase 2b: Real task validation
Goal: Prove Orchestrator works beyond test generation
Tasks:
- Run refactoring tasks (extract function, rename, reorganize)
- Run bug fix tasks (known minor issues)
- Run documentation generation tasks
- Identify failure patterns and limitations
Success: 3 consecutive night runs with real tasks at 5+/6

## Phase 3: stdout redaction
Goal: Prevent secret leakage in task output
Tasks:
- Implement secret filter in executor output capture
- Mask patterns: API keys, tokens, passwords, .env values
- Streaming output size limit (prevent memory exhaustion)
- Add redaction tests
Success: All known secret patterns masked in stdout/stderr

## Phase 4: Docker hardening
Goal: Minimize container attack surface
Tasks:
- Run as non-root user inside container
- Verify cap-drop=ALL + no-new-privileges
- HOME=/tmp operation verification
- Optional: seccomp profile
Success: All 204+ tests still pass with hardened container

## Phase 5: Nightly automation
Goal: DJ says what to do -> Croppy schedules -> runs overnight -> DJ reviews in morning
Tasks:
- Cron/launchd scheduled execution (e.g. 23:00 start)
- Auto git commit on success (worktree -> branch -> PR-ready)
- Morning summary to Telegram (results + diff stats)
- Failure recovery: auto-retry once, then notify DJ
Success: Full overnight cycle with zero DJ intervention

## Phase 6: Self-improvement loop
Goal: Orchestrator improves its own test coverage and code quality
Tasks:
- Auto-detect untested functions -> generate TaskPlan
- Code quality scan -> auto-fix lint issues
- Dependency update checks (without npm install - report only)
Success: Weekly autonomous improvement runs

## DONE condition
Phase 5 complete = Orchestrator is production-ready
Phase 6 = bonus (self-sustaining)
