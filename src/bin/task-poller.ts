/**
 * Independent Task Poller - Runs as standalone launchd service
 * Polls Memory Gateway for remote execution tasks from Croppy (claude.ai)
 *
 * Design (ChatGPT-reviewed, CONVERGED):
 * - Lockfile with PID + timestamp + token (prevents dual startup)
 * - Safe-mode: consecutive failures -> exit(0) (launchd won't restart)
 * - SIGTERM handler: cleanup -> exit(0) (graceful stop)
 * - Crash: exit(1) -> launchd restarts (KeepAlive SuccessfulExit=false)
 * - AbortController on all fetch calls
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, unlinkSync, existsSync, renameSync, readdirSync } from 'fs';

const execAsync = promisify(exec);

// === Config ===
const GATEWAY_URL = process.env.MEMORY_GATEWAY_URL || 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';
const POLL_INTERVAL_MS = 3000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_OUTPUT = 80000;
const LOCK_PATH = '/tmp/com.jarvis.task-poller.lock';
const ERROR_BURST_LIMIT = 10;
const ERROR_BURST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// === State ===
let running = true;
let isExecuting = false;
const instanceToken = Math.random().toString(36).substring(2);
const errorTimestamps: number[] = [];

// === Logging ===
function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [Task Poller] ${msg}`);
}

function logError(msg: string): void {
  const ts = new Date().toISOString();
  console.error(`[${ts}] [Task Poller] ERROR: ${msg}`);
}

// === Lockfile ===
function acquireLock(): boolean {
  if (existsSync(LOCK_PATH)) {
    try {
      const lockData = readFileSync(LOCK_PATH, 'utf-8').trim().split('\n');
      const pid = parseInt(lockData[0], 10);
      if (pid && pid !== process.pid) {
        // Check if PID is alive
        try {
          process.kill(pid, 0);
          // Process alive - check it's actually a poller (via token)
          log(`Lock held by PID ${pid} (alive). Exiting.`);
          return false;
        } catch {
          // PID dead, stale lock
          log(`Stale lock from dead PID ${pid}. Taking over.`);
        }
      }
    } catch {
      log('Corrupt lock file. Taking over.');
    }
  }

  // Write lock atomically
  const tmpLock = LOCK_PATH + '.tmp';
  const lockContent = `${process.pid}\n${Date.now()}\n${instanceToken}`;
  writeFileSync(tmpLock, lockContent);
  renameSync(tmpLock, LOCK_PATH);
  log(`Lock acquired (PID ${process.pid}, token ${instanceToken})`);
  return true;
}

function releaseLock(): void {
  try {
    if (existsSync(LOCK_PATH)) {
      const content = readFileSync(LOCK_PATH, 'utf-8');
      if (content.includes(instanceToken)) {
        unlinkSync(LOCK_PATH);
        log('Lock released');
      }
    }
  } catch {
    // Best effort
  }
}

// === Safe Mode ===
function recordError(): void {
  const now = Date.now();
  errorTimestamps.push(now);
  // Trim old entries
  const cutoff = now - ERROR_BURST_WINDOW_MS;
  while (errorTimestamps.length > 0 && errorTimestamps[0] < cutoff) {
    errorTimestamps.shift();
  }
}

function shouldEnterSafeMode(): boolean {
  return errorTimestamps.length >= ERROR_BURST_LIMIT;
}

// === Fetch with timeout ===
async function fetchWithTimeout(url: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}


// === Sleep Utility ===
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === Command Execution ===
async function executeCommand(
  command: string,
  cwd: string,
  timeoutSeconds: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const resolvedCwd = cwd.replace(/^~/, process.env.HOME || '/Users/daijiromatsuokam1');

  const MAX_RETRIES = 3;
  const BACKOFF_BASE_MS = 200;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Fallback to /bin/sh on retry 2+
    const shell = attempt >= 2 ? '/bin/sh' : '/bin/zsh';

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: resolvedCwd,
        timeout: timeoutSeconds * 1000,
        maxBuffer: 10 * 1024 * 1024,
        shell,
        env: {
          ...process.env,
          PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
        },
      });

      if (attempt > 0) {
        log(`ENOENT recovered: attempt=${attempt} shell=${shell}`);
      }

      return {
        stdout: (stdout || '').substring(0, MAX_OUTPUT),
        stderr: (stderr || '').substring(0, MAX_OUTPUT),
        exitCode: 0,
      };
    } catch (error: any) {
      const isEnoent = error.code === 'ENOENT' ||
                       (error.message && error.message.includes('ENOENT'));

      if (isEnoent && attempt < MAX_RETRIES) {
        // Diagnostic: what's really happening?
        const cwdOk = existsSync(resolvedCwd);
        const zshOk = existsSync('/bin/zsh');
        let fdCount = -1;
        try { fdCount = readdirSync('/dev/fd').length; } catch {}
        log(`ENOENT retry ${attempt + 1}/${MAX_RETRIES}: shell=${shell} cwd=${resolvedCwd} cwd_ok=${cwdOk} zsh_ok=${zshOk} fd=${fdCount} errno=${error.errno} syscall=${error.syscall} path=${error.path}`);

        // Exponential backoff with jitter (200ms -> 500ms -> 1250ms)
        const delay = BACKOFF_BASE_MS * Math.pow(2.5, attempt) * (0.7 + Math.random() * 0.6);
        await sleep(delay);
        continue;
      }

      // Final failure or non-ENOENT error
      if (isEnoent) {
        logError(`ENOENT persisted after ${MAX_RETRIES} retries. errno=${error.errno} syscall=${error.syscall} path=${error.path}`);
      }

      return {
        stdout: (error.stdout || '').substring(0, MAX_OUTPUT),
        stderr: (error.stderr || error.message || '').substring(0, MAX_OUTPUT),
        exitCode: error.code || 1,
      };
    }
  }

  return { stdout: '', stderr: 'unreachable', exitCode: 1 };
}

// === Poll and Execute ===
async function pollAndExecute(): Promise<void> {
  if (isExecuting) return;
  isExecuting = true;

  try {
    const pollRes = await fetchWithTimeout(`${GATEWAY_URL}/v1/exec/poll`);
    const pollData: any = await pollRes.json();

    if (!pollData.ok || !pollData.task) {
      return; // No pending tasks
    }

    const task = pollData.task;
    log(`Executing: ${task.id} | ${task.command.substring(0, 80)}...`);

    const result = await executeCommand(
      task.command,
      task.cwd,
      task.timeout_seconds || 300
    );

    log(`Done: ${task.id} | exit=${result.exitCode} | stdout=${result.stdout.length}B`);

    await fetchWithTimeout(`${GATEWAY_URL}/v1/exec/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: task.id,
        exit_code: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('aborted') || msg.includes('AbortError')) {
      logError('Gateway fetch timeout (network issue, not crashing)');
    } else {
      logError(msg);
    }
    recordError();

    if (shouldEnterSafeMode()) {
      logError(`SAFE MODE: ${ERROR_BURST_LIMIT} errors in ${ERROR_BURST_WINDOW_MS / 60000}min. Stopping.`);
      running = false;
      releaseLock();
      process.exit(0); // exit(0) = launchd won't restart (SuccessfulExit=false)
    }
  } finally {
    isExecuting = false;
  }
}

// === Main Loop ===
async function main(): Promise<void> {
  log('Starting independent task poller...');

  // Acquire lock
  if (!acquireLock()) {
    process.exit(0); // Another instance running, don't restart
  }

  // SIGTERM/SIGINT handler
  const shutdown = (signal: string) => {
    log(`Received ${signal}. Shutting down gracefully.`);
    running = false;
    releaseLock();
    process.exit(0); // Graceful = don't restart
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Uncaught exception handler
  process.on('uncaughtException', (err) => {
    logError(`Uncaught exception: ${err.message}`);
    releaseLock();
    process.exit(1); // Crash = launchd restarts
  });

  log(`Polling ${GATEWAY_URL} every ${POLL_INTERVAL_MS}ms`);

  // Main loop
  while (running) {
    await pollAndExecute();
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  releaseLock();
}

main().catch((err) => {
  logError(`Fatal: ${err.message}`);
  releaseLock();
  process.exit(1); // Crash = launchd restarts
});
