import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const GATEWAY_URL = 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';
const POLL_INTERVAL = 3000;
const MAX_OUTPUT = 80000;

let isPolling = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

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
        PATH: '/opt/homebrew/bin:/usr/local/bin:' + (process.env.PATH || ''),
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

async function pollAndExecute(): Promise<void> {
  if (isPolling) return;
  isPolling = true;
  try {
    const pollRes = await fetch(GATEWAY_URL + '/v1/exec/poll');
    const pollData: any = await pollRes.json();
    if (!pollData.ok || !pollData.task) return;
    const task = pollData.task;
    console.log('[Task Poller] Executing: ' + task.id + ' | ' + task.command.substring(0, 80) + '...');
    const result = await executeCommand(task.command, task.cwd, task.timeout_seconds || 300);
    console.log('[Task Poller] Done: ' + task.id + ' | exit=' + result.exitCode + ' | stdout=' + result.stdout.length + 'B');
    await fetch(GATEWAY_URL + '/v1/exec/complete', {
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
    console.error('[Task Poller] Error:', error instanceof Error ? error.message : error);
  } finally {
    isPolling = false;
  }
}

export function startTaskPoller(): void {
  if (pollTimer) {
    console.log('[Task Poller] Already running');
    return;
  }
  console.log('[Task Poller] Started (interval: ' + POLL_INTERVAL + 'ms)');
  pollTimer = setInterval(pollAndExecute, POLL_INTERVAL);
  pollAndExecute();
}

export function stopTaskPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[Task Poller] Stopped');
  }
}
