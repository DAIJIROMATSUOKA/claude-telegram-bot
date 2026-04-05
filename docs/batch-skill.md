# /batch Skill — Built-in Claude Code Batch Processing

## What Is /batch?

Claude Code has a built-in `/batch` skill that decomposes work into 5-30 independent units and spawns parallel agents in isolated git worktrees. Each agent works on its own copy of the repo, avoiding conflicts.

## How It Works

1. User invokes `/batch` with a task description
2. Claude decomposes the task into independent work units
3. Each unit is assigned to a parallel agent in a separate git worktree
4. Agents execute independently, each making their own changes
5. Results are merged back into the main branch
6. Summary report is generated

## Comparison with Our Custom Batch Runner

| Feature | /batch (built-in) | batch-runner-v3.sh (custom) |
|---------|-------------------|----------------------------|
| Parallelism | Git worktrees (true parallel) | Sequential (one at a time) |
| Isolation | Full repo copy per agent | Shared repo |
| Conflict handling | Merge at end | N/A (sequential) |
| Task decomposition | Automatic | Manual (separate .txt files) |
| Timeout | Per-agent | Per-batch (120 min) |
| PID management | Internal | PID file lock |
| Telegram notify | No | Yes (start + complete) |
| Skip completed | No | Yes (git log check) |
| SIGTERM survival | Internal | setsid + nohup |
| Headless mode | Requires interactive | Fully headless |

## When to Use Which

### Use /batch when:
- Task is naturally decomposable into independent units
- Running interactively in Claude Code
- Want automatic task decomposition
- Changes won't conflict with each other

### Use batch-runner-v3.sh when:
- Running headless via exec bridge or cron
- Need Telegram notifications
- Need PID lock to prevent duplicate runs
- Need to resume/skip completed batches
- Need SIGTERM survival (LaunchAgent context)

## Custom Batch Worker Agent

`.claude/agents/batch-worker.md` defines a strict subagent for batch tasks:
- Test after every change
- No .claude/ writes
- --no-verify for commits
- Minimal, focused changes

## Integration

Both systems can coexist:
- `/batch` for interactive decomposition during dev sessions
- `batch-runner-v3.sh` for automated nightly/scheduled batch execution
