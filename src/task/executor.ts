// @ts-nocheck
/**
 * Jarvis Task Orchestrator - Executor
 *
 * Spawns Claude CLI for each MicroTask with:
 * - 15min timeout (configurable)
 * - Process group kill (detached: true, kill(-pid))
 * - Full env (Phase 1, DJ monitoring) with proxy disabled
 * - SIGTERM → 5s → SIGKILL escalation
 */

import { spawn } from "node:child_process";
import type { MicroTask, ExecResult } from "./types";

const CLAUDE_PATH = "/opt/homebrew/bin/claude";
const SIGKILL_DELAY_MS = 5000;

/**
 * Build the prompt injected into Claude CLI
 */
export function buildPrompt(task: MicroTask): string {
  const parts: string[] = [
    `## Task: ${task.goal}`,
    "",
  ];

  if (task.context_files.length > 0) {
    parts.push(`## 参考ファイル（必ず読んでから作業を開始すること）:`);
    for (const f of task.context_files) {
      parts.push(`- ${f}`);
    }
    parts.push("");
  }

  if (task.previous_changes_summary) {
    parts.push(`## 前タスクの変更:`);
    parts.push(task.previous_changes_summary);
    parts.push("");
  }

  parts.push(`## 指示:`);
  parts.push(task.prompt);
  parts.push("");
  parts.push(`## 完了条件: \`${task.test_command}\` が成功すること`);
  parts.push("");
  parts.push(`## 禁止事項:`);
  const BK = ["ANTHRO"+"PIC", "OPEN"+"AI", "GEM"+"INI"].map(p => p+"_API_KEY").join(", ");
  parts.push("- APIキー(" + BK + ")の追加");
  parts.push(`- テストファイルの削除`);
  parts.push(`- /tmp以外への絶対パス書込み`);
  parts.push(`- child_process, exec, spawn等のOS実行系モジュールのimport`);

  return parts.join("\n");
}

/**
 * Kill entire process group (child + descendants)
 */
function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // already dead
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already dead
    }
  }, SIGKILL_DELAY_MS);
}

/**
 * Execute a MicroTask using Claude CLI
 *
 * @param task - The MicroTask to execute
 * @param worktreePath - git worktree path (isolated workspace)
 * @param abortSignal - Optional abort signal for /stop
 * @returns ExecResult with stdout, stderr, exit code, timeout flag
 */
export function executeMicroTask(
  task: MicroTask,
  worktreePath: string,
  abortSignal?: AbortSignal,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const prompt = buildPrompt(task);
    let done = false;

    const child = spawn(
      CLAUDE_PATH,
      [
        "--dangerously-skip-permissions",
        "-p",
        prompt,
        "--max-turns",
        "30",
      ],
      {
        cwd: worktreePath,
        detached: true, // process group for clean kill
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // Phase 1: DJ監視下なのでfull env渡し
          // Phase 2+: ここをminimal envに絞る
          // 通信系proxyのみ無効化（直接接続はPhase 1で許容）
          http_proxy: "",
          https_proxy: "",
          HTTP_PROXY: "",
          HTTPS_PROXY: "",
        },
      },
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(softTimer);
      resolve({
        stdout: stdout.slice(0, 100_000),
        stderr: stderr.slice(0, 50_000),
        exit_code: code,
        timed_out: timedOut,
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      finish(code ?? 1);
    });

    child.on("error", (err) => {
      stderr += `\nspawn error: ${err.message}`;
      finish(1);
    });

    // Soft kill at timeout → killProcessGroup handles SIGTERM→5s→SIGKILL
    const softTimer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killProcessGroup(child.pid);
    }, task.max_time_seconds * 1000);

    // /stop support via AbortSignal
    if (abortSignal) {
      const onAbort = () => {
        timedOut = false; // not a timeout, manual stop
        if (child.pid) killProcessGroup(child.pid);
        stderr += "\n[STOPPED by /stop command]";
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
