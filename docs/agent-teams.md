# Agent Teams for JARVIS Batch Operations

## Overview

Agent Teams enable Claude Code to decompose tasks and coordinate multiple specialized agents working in parallel. This is enabled via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

## Team Agents

### batch-leader (`.claude/agents/batch-leader.md`)
Team leader that decomposes batch prompts into independent tasks, assigns work to teammates, and coordinates the overall workflow.

### test-runner (`.claude/agents/test-runner.md`)
Focused teammate that runs `bun test` after every code change and fixes failures. Escalates to leader after 3 failed attempts.

### code-reviewer (`.claude/agents/code-reviewer.md`)
Reviews code changes for security, quality, and consistency. Returns PASS/WARN/BLOCK verdict before commits.

## Usage

### In Claude Code CLI (headless)
```bash
# Agent teams are auto-enabled via env var
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
claude -p "decompose and execute this batch..."
```

### In claude-code-spawn.sh
The env var is automatically exported before spawning Claude Code sessions.

### In Batch Runner
```bash
bash scripts/batch-runner-v3.sh /tmp/batch-prompts-v3/
```
The batch runner spawns Claude Code with agent teams enabled.

## Architecture

```
batch-leader (Sonnet)
├── test-runner (Haiku) — runs after every change
├── code-reviewer (Haiku) — reviews before commit
└── [inline sub-agents] — for parallel file operations
```

## Notes
- Agent Teams is experimental — re-evaluate when it exits preview
- For simple tasks, direct execution is faster than team coordination
- Teams shine on large batches with 5+ independent subtasks
