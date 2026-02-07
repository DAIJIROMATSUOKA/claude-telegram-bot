#!/usr/bin/env python3
"""
Memory Gateway Worker patch
- Add task_queue D1 table
- Add /v1/exec/submit, /v1/exec/poll, /v1/exec/complete, /v1/exec/result endpoints
"""

import os

GATEWAY_DIR = os.path.expanduser("~/memory-gateway")
INDEX_FILE = os.path.join(GATEWAY_DIR, "src", "index-v1.ts")
EXEC_HANDLER_FILE = os.path.join(GATEWAY_DIR, "src", "exec-handlers.ts")
MIGRATION_FILE = os.path.join(GATEWAY_DIR, "migrations", "0002_task_queue.sql")

# ========== 1. D1 Migration ==========
os.makedirs(os.path.join(GATEWAY_DIR, "migrations"), exist_ok=True)

migration_sql = """-- Task Queue for Croppy-Jarvis remote execution
CREATE TABLE IF NOT EXISTS task_queue (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  command TEXT NOT NULL,
  cwd TEXT DEFAULT '~',
  timeout_seconds INTEGER DEFAULT 300,
  result_stdout TEXT,
  result_stderr TEXT,
  result_exit_code INTEGER,
  source TEXT NOT NULL DEFAULT 'croppy'
);

CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status);
CREATE INDEX IF NOT EXISTS idx_task_queue_created ON task_queue(created_at);
"""

with open(MIGRATION_FILE, "w") as f:
    f.write(migration_sql)
print(f"[OK] Migration: {MIGRATION_FILE}")

# ========== 2. exec-handlers.ts ==========
exec_handlers = r"""/**
 * Remote Execution Handlers
 * Croppy submits commands -> Jarvis polls & executes -> results returned
 */

import { successResponse, errorResponse } from './utils';

interface StorageEnv {
  DB: any;
}

function generateId(): string {
  return 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

/**
 * POST /v1/exec/submit - Submit a command for execution
 * Body: { command: string, cwd?: string, timeout_seconds?: number, source?: string }
 */
export async function handleExecSubmit(request: Request, env: StorageEnv): Promise<Response> {
  try {
    const body: any = await request.json();
    const { command, cwd, timeout_seconds, source } = body;

    if (!command) {
      return errorResponse('Missing command', 'INVALID_REQUEST', 400);
    }

    const id = generateId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO task_queue (id, created_at, status, command, cwd, timeout_seconds, source)
       VALUES (?, ?, 'pending', ?, ?, ?, ?)`
    ).bind(
      id,
      now,
      command,
      cwd || '~',
      timeout_seconds || 300,
      source || 'croppy'
    ).run();

    return successResponse({ ok: true, task_id: id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse('Submit failed: ' + msg, 'SUBMIT_ERROR', 500);
  }
}

/**
 * GET /v1/exec/poll - Jarvis polls for pending tasks
 * Returns oldest pending task and marks it as 'running'
 */
export async function handleExecPoll(env: StorageEnv): Promise<Response> {
  try {
    // Get oldest pending task
    const result = await env.DB.prepare(
      `SELECT id, command, cwd, timeout_seconds, source, created_at
       FROM task_queue
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1`
    ).first();

    if (!result) {
      return successResponse({ ok: true, task: null });
    }

    // Mark as running
    await env.DB.prepare(
      `UPDATE task_queue SET status = 'running', updated_at = ? WHERE id = ?`
    ).bind(new Date().toISOString(), result.id).run();

    return successResponse({ ok: true, task: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse('Poll failed: ' + msg, 'POLL_ERROR', 500);
  }
}

/**
 * POST /v1/exec/complete - Jarvis reports task completion
 * Body: { task_id: string, exit_code: number, stdout: string, stderr: string }
 */
export async function handleExecComplete(request: Request, env: StorageEnv): Promise<Response> {
  try {
    const body: any = await request.json();
    const { task_id, exit_code, stdout, stderr } = body;

    if (!task_id) {
      return errorResponse('Missing task_id', 'INVALID_REQUEST', 400);
    }

    await env.DB.prepare(
      `UPDATE task_queue
       SET status = 'done',
           result_exit_code = ?,
           result_stdout = ?,
           result_stderr = ?,
           updated_at = ?
       WHERE id = ?`
    ).bind(
      exit_code ?? -1,
      (stdout || '').substring(0, 100000),
      (stderr || '').substring(0, 100000),
      new Date().toISOString(),
      task_id
    ).run();

    return successResponse({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse('Complete failed: ' + msg, 'COMPLETE_ERROR', 500);
  }
}

/**
 * GET /v1/exec/result/:task_id - Get task result
 */
export async function handleExecResult(taskId: string, env: StorageEnv): Promise<Response> {
  try {
    const result = await env.DB.prepare(
      `SELECT id, status, command, cwd, result_stdout, result_stderr, result_exit_code, created_at, updated_at
       FROM task_queue
       WHERE id = ?`
    ).bind(taskId).first();

    if (!result) {
      return errorResponse('Task not found', 'NOT_FOUND', 404);
    }

    return successResponse({ ok: true, task: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse('Result fetch failed: ' + msg, 'RESULT_ERROR', 500);
  }
}

/**
 * POST /v1/exec/run - Synchronous execution (submit + wait for result)
 * Body: { command: string, cwd?: string, timeout_seconds?: number }
 * Polls every 2 seconds until done or timeout (max 25 seconds for CF Worker limit)
 */
export async function handleExecRun(request: Request, env: StorageEnv): Promise<Response> {
  try {
    const body: any = await request.json();
    const { command, cwd, timeout_seconds } = body;

    if (!command) {
      return errorResponse('Missing command', 'INVALID_REQUEST', 400);
    }

    // Submit task
    const id = generateId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO task_queue (id, created_at, status, command, cwd, timeout_seconds, source)
       VALUES (?, ?, 'pending', ?, ?, ?, 'croppy')`
    ).bind(id, now, command, cwd || '~', timeout_seconds || 300).run();

    // Poll for result (max 25 seconds - CF Worker CPU time limit)
    const maxWait = 25000;
    const pollInterval = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const result = await env.DB.prepare(
        `SELECT status, result_stdout, result_stderr, result_exit_code
         FROM task_queue WHERE id = ?`
      ).bind(id).first();

      if (result && result.status === 'done') {
        return successResponse({
          ok: true,
          task_id: id,
          exit_code: result.result_exit_code,
          stdout: result.result_stdout,
          stderr: result.result_stderr,
        });
      }
    }

    // Timeout - return task_id for manual polling
    return successResponse({
      ok: true,
      task_id: id,
      status: 'timeout',
      message: 'Task still running. Poll /v1/exec/result/' + id,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse('Run failed: ' + msg, 'RUN_ERROR', 500);
  }
}
"""

with open(EXEC_HANDLER_FILE, "w") as f:
    f.write(exec_handlers)
print(f"[OK] Exec handlers: {EXEC_HANDLER_FILE}")

# ========== 3. Patch index-v1.ts ==========
with open(INDEX_FILE, "r") as f:
    content = f.read()

# Add import
import_line = "import { runJanitor } from './janitor';"
new_import = """import { runJanitor } from './janitor';
import {
  handleExecSubmit,
  handleExecPoll,
  handleExecComplete,
  handleExecResult,
  handleExecRun,
} from './exec-handlers';"""

if "exec-handlers" not in content:
    content = content.replace(import_line, new_import)
    print("[OK] Added exec-handlers import")
else:
    print("[SKIP] exec-handlers import already exists")

# Add routes before 404
route_marker = "// ==================== 404 Not Found ===================="
exec_routes = """// ==================== Remote Execution API ====================

    // POST /v1/exec/submit - Submit command for execution
    if (pathname === '/v1/exec/submit' && request.method === 'POST') {
      return handleExecSubmit(request, env);
    }

    // GET /v1/exec/poll - Jarvis polls for pending tasks
    if (pathname === '/v1/exec/poll' && request.method === 'GET') {
      return handleExecPoll(env);
    }

    // POST /v1/exec/complete - Jarvis reports completion
    if (pathname === '/v1/exec/complete' && request.method === 'POST') {
      return handleExecComplete(request, env);
    }

    // GET /v1/exec/result/:task_id - Get task result
    const execResultMatch = pathname.match(/^\\/v1\\/exec\\/result\\/([^/]+)$/);
    if (execResultMatch && request.method === 'GET') {
      return handleExecResult(execResultMatch[1], env);
    }

    // POST /v1/exec/run - Synchronous submit + wait
    if (pathname === '/v1/exec/run' && request.method === 'POST') {
      return handleExecRun(request, env);
    }

    // ==================== 404 Not Found ===================="""

if "/v1/exec/submit" not in content:
    content = content.replace(route_marker, exec_routes)
    print("[OK] Added exec routes")
else:
    print("[SKIP] exec routes already exist")

with open(INDEX_FILE, "w") as f:
    f.write(content)
print(f"[OK] Patched: {INDEX_FILE}")

print("\n=== DONE ===")
print("Next steps:")
print("1. cd ~/memory-gateway")
print("2. wrangler d1 execute memory_gateway --remote --file=migrations/0002_task_queue.sql")
print("3. wrangler deploy")
