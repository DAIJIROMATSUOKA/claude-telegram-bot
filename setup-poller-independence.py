#!/usr/bin/env python3
"""
Setup: Task Poller Independence + Media Queue Patch
1. Apply media queue patch (SIGTERM fix)
2. Create independent task-poller (src/bin/task-poller.ts)
3. Create launchd plist
4. Remove startTaskPoller() from index.ts
"""
import os, re, sys, uuid, subprocess

HOME = os.path.expanduser('~')
REPO = os.path.join(HOME, 'claude-telegram-bot')
BUN = '/opt/homebrew/bin/bun'

# Verify paths
if not os.path.isdir(REPO):
    print(f'ERROR: Repo not found at {REPO}')
    sys.exit(1)

# Find bun
if not os.path.isfile(BUN):
    result = subprocess.run(['which', 'bun'], capture_output=True, text=True)
    if result.returncode == 0:
        BUN = result.stdout.strip()
    else:
        print('ERROR: bun not found')
        sys.exit(1)

print(f'Repo: {REPO}')
print(f'Bun: {BUN}')
print()

errors = []

# ============================================================
# PART 1: Media Queue Patch (SIGTERM fix)
# ============================================================
print('=' * 60)
print('PART 1: Media Queue Patch')
print('=' * 60)

MC_FILE = os.path.join(REPO, 'src/handlers/media-commands.ts')

if not os.path.isfile(MC_FILE):
    print(f'SKIP: {MC_FILE} not found')
    errors.append('media-commands.ts not found')
else:
    with open(MC_FILE, 'r') as f:
        mc_content = f.read()

    if 'withMediaQueue' in mc_content:
        print('SKIP: Queue already applied')
    else:
        mc_lines = mc_content.split('\n')

        # Find last import line
        last_import_idx = -1
        for i, line in enumerate(mc_lines):
            if line.startswith('import '):
                last_import_idx = i

        if last_import_idx == -1:
            print('ERROR: No import lines found')
            errors.append('No import lines in media-commands.ts')
        else:
            print(f'  Last import at line {last_import_idx + 1}')

            QUEUE_CODE = """
// Media processing queue - prevents concurrent ComfyUI jobs causing timeout
let _mediaQueueChain: Promise<void> = Promise.resolve();

function withMediaQueue<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _mediaQueueChain;
  let unlock: () => void;
  _mediaQueueChain = new Promise(r => unlock = r);
  return prev.catch(() => {}).then(async () => {
    try {
      return await fn();
    } finally {
      unlock!();
    }
  });
}"""
            mc_lines.insert(last_import_idx + 1, QUEUE_CODE)
            mc_content = '\n'.join(mc_lines)

            # Wrap runAiMedia calls
            wrap_count = 0
            def do_replace(match):
                global wrap_count
                wrap_count += 1
                return f'{match.group(1)}withMediaQueue(() => runAiMedia{match.group(2)}){match.group(3)}'

            mc_content = re.sub(
                r'(= await )runAiMedia(\([^)]*\))(;)',
                do_replace,
                mc_content
            )

            print(f'  Wrapped {wrap_count} runAiMedia calls')

            if wrap_count < 1:
                print('ERROR: No runAiMedia calls found to wrap')
                errors.append('No runAiMedia calls wrapped')
            else:
                # Verify balanced parens
                ok = True
                for i, line in enumerate(mc_content.split('\n')):
                    if 'withMediaQueue' in line and 'function' not in line and '//' not in line:
                        opens = line.count('(')
                        closes = line.count(')')
                        if opens != closes:
                            print(f'  ERROR: Unbalanced parens line {i+1}')
                            ok = False
                        else:
                            print(f'  OK: {line.strip()[:70]}')

                if ok:
                    with open(MC_FILE, 'w') as f:
                        f.write(mc_content)
                    print('  DONE: Queue patch applied')
                else:
                    errors.append('Unbalanced parens in queue patch')

print()

# ============================================================
# PART 2: Independent Task Poller
# ============================================================
print('=' * 60)
print('PART 2: Independent Task Poller')
print('=' * 60)

BIN_DIR = os.path.join(REPO, 'src/bin')
os.makedirs(BIN_DIR, exist_ok=True)

POLLER_FILE = os.path.join(BIN_DIR, 'task-poller.ts')

POLLER_CODE = r'''/**
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
import { writeFileSync, readFileSync, unlinkSync, existsSync, renameSync } from 'fs';

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

// === Command Execution ===
async function executeCommand(
  command: string,
  cwd: string,
  timeoutSeconds: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const resolvedCwd = cwd.replace(/^~/, process.env.HOME || '/Users/daijiromatsuokam1');

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: resolvedCwd,
      timeout: timeoutSeconds * 1000,
      maxBuffer: 10 * 1024 * 1024,
      shell: '/bin/zsh',
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
      },
    });

    return {
      stdout: (stdout || '').substring(0, MAX_OUTPUT),
      stderr: (stderr || '').substring(0, MAX_OUTPUT),
      exitCode: 0,
    };
  } catch (error: any) {
    return {
      stdout: (error.stdout || '').substring(0, MAX_OUTPUT),
      stderr: (error.stderr || error.message || '').substring(0, MAX_OUTPUT),
      exitCode: error.code || 1,
    };
  }
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
'''.lstrip()

with open(POLLER_FILE, 'w') as f:
    f.write(POLLER_CODE)
print(f'  Created: {POLLER_FILE}')
print('  DONE')
print()

# ============================================================
# PART 3: LaunchAgent plist
# ============================================================
print('=' * 60)
print('PART 3: LaunchAgent plist')
print('=' * 60)

PLIST_DIR = os.path.join(HOME, 'Library/LaunchAgents')
PLIST_FILE = os.path.join(PLIST_DIR, 'com.jarvis.task-poller.plist')
LOG_DIR = os.path.join(HOME, 'Library/Logs')
USER = os.environ.get('USER', 'daijiromatsuokam1')

PLIST_CONTENT = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jarvis.task-poller</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>ThrottleInterval</key>
  <integer>20</integer>

  <key>ExitTimeOut</key>
  <integer>10</integer>

  <key>WorkingDirectory</key>
  <string>{REPO}</string>

  <key>ProgramArguments</key>
  <array>
    <string>{BUN}</string>
    <string>run</string>
    <string>{REPO}/src/bin/task-poller.ts</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>{HOME}</string>
  </dict>

  <key>StandardOutPath</key>
  <string>{LOG_DIR}/jarvis-task-poller.out.log</string>
  <key>StandardErrorPath</key>
  <string>{LOG_DIR}/jarvis-task-poller.err.log</string>
</dict>
</plist>
'''

with open(PLIST_FILE, 'w') as f:
    f.write(PLIST_CONTENT)
print(f'  Created: {PLIST_FILE}')
print('  DONE')
print()

# ============================================================
# PART 4: Remove startTaskPoller() from index.ts
# ============================================================
print('=' * 60)
print('PART 4: Remove startTaskPoller from index.ts')
print('=' * 60)

INDEX_FILE = os.path.join(REPO, 'src/index.ts')

if not os.path.isfile(INDEX_FILE):
    print(f'ERROR: {INDEX_FILE} not found')
    errors.append('index.ts not found')
else:
    with open(INDEX_FILE, 'r') as f:
        idx_content = f.read()

    changes = 0

    # Remove import of startTaskPoller
    new_content = re.sub(
        r"import\s*\{[^}]*startTaskPoller[^}]*\}\s*from\s*['\"]\.\.\/task-poller['\"];?\n?",
        '',
        idx_content
    )
    if new_content != idx_content:
        changes += 1
        print('  Removed: import { startTaskPoller }')
        idx_content = new_content

    # Also try simpler import pattern
    new_content = re.sub(
        r"import.*startTaskPoller.*from.*task-poller.*\n?",
        '',
        idx_content
    )
    if new_content != idx_content:
        changes += 1
        print('  Removed: startTaskPoller import (alt pattern)')
        idx_content = new_content

    # Remove startTaskPoller() call
    new_content = re.sub(
        r"\s*startTaskPoller\(\);?\s*\n?",
        '\n',
        idx_content
    )
    if new_content != idx_content:
        changes += 1
        print('  Removed: startTaskPoller() call')
        idx_content = new_content

    if changes > 0:
        with open(INDEX_FILE, 'w') as f:
            f.write(idx_content)
        print(f'  DONE: {changes} changes')
    else:
        print('  SKIP: startTaskPoller not found in index.ts (already removed?)')

print()

# ============================================================
# SUMMARY
# ============================================================
print('=' * 60)
print('SUMMARY')
print('=' * 60)

if errors:
    print(f'ERRORS ({len(errors)}):')
    for e in errors:
        print(f'  - {e}')
    print()

print('Next steps:')
print(f'  1. Restart Jarvis:')
print(f'     launchctl kickstart -k gui/$(id -u)/com.jarvis.telegram-bot')
print()
print(f'  2. Start independent poller:')
print(f'     launchctl bootstrap gui/$(id -u) {PLIST_FILE}')
print()
print(f'  3. Verify both running:')
print(f'     launchctl list | grep jarvis')
print()
print(f'  4. Check poller logs:')
print(f'     tail -5 ~/Library/Logs/jarvis-task-poller.out.log')
print()
print(f'  ALL IN ONE (copy-paste):')
print(f'     launchctl kickstart -k gui/$(id -u)/com.jarvis.telegram-bot && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jarvis.task-poller.plist && sleep 3 && launchctl list | grep jarvis && tail -5 ~/Library/Logs/jarvis-task-poller.out.log')
