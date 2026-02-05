# 10-forget-proof.md — Forget-Proof Design

## The 3 failure modes
1) Rules not loaded in this run
2) Rules loaded but truncated/buried
3) Rules loaded but overridden by conflicts

## Solutions
1) Load rules on startup (index.ts init hook)
2) Keep AGENTS.md under 30 lines; use RULEBOOK.md as index
3) Explicit priority in AGENTS.md rule 5

## Checklist before every task
- [ ] Can I see AGENTS.md in my context?
- [ ] Is it complete (10 rules visible)?
- [ ] Do I know where to find module details?
