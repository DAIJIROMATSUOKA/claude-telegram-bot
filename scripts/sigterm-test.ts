#!/usr/bin/env bun
/**
 * sigterm-test.ts
 * ===============
 * Bun spawn の挙動テスト。
 * media-commands.ts と同じ child_process.spawn パターンを再現し、
 * exit code / signal / 実行時間を記録する。
 *
 * Usage: bun run scripts/sigterm-test.ts
 */

import { spawn } from "child_process";

interface TestResult {
  command: string;
  exitCode: number | null;
  signal: string | null;
  elapsedMs: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

async function runTest(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<TestResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const proc = spawn(cmd, args, {
      env: {
        ...process.env,
        AI_MEDIA_WORKDIR: "/tmp/ai-media",
      },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // 2-stage kill: SIGTERM first, SIGKILL 5s later (same as media-commands.ts)
    const softTimer = setTimeout(() => {
      timedOut = true;
      console.log(`  [${cmd} ${args.join(" ")}] TIMEOUT – sending SIGTERM`);
      try { proc.kill("SIGTERM"); } catch {}
    }, timeoutMs);
    const hardTimer = setTimeout(() => {
      console.log(`  [${cmd} ${args.join(" ")}] SIGTERM ignored – sending SIGKILL`);
      try { proc.kill("SIGKILL"); } catch {}
    }, timeoutMs + 5_000);

    proc.on("close", (code: number | null, signal: string | null) => {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      const elapsed = Date.now() - start;
      resolve({
        command: `${cmd} ${args.join(" ")}`,
        exitCode: code,
        signal,
        elapsedMs: elapsed,
        timedOut,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    proc.on("error", (err: Error) => {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      const elapsed = Date.now() - start;
      resolve({
        command: `${cmd} ${args.join(" ")}`,
        exitCode: -1,
        signal: null,
        elapsedMs: elapsed,
        timedOut: false,
        stdout: "",
        stderr: err.message,
      });
    });
  });
}

async function main() {
  console.log("=== Bun spawn 挙動テスト ===");
  console.log(`Bun version: ${Bun.version}`);
  console.log(`Node compat: ${process.version}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log();

  const tests: Array<{
    label: string;
    cmd: string;
    args: string[];
    timeoutMs: number;
  }> = [
    {
      label: "Test 1: sleep 5 (正常終了, timeout=10s)",
      cmd: "sleep",
      args: ["5"],
      timeoutMs: 10_000,
    },
    {
      label: "Test 2: sleep 30 (タイムアウト強制, timeout=3s)",
      cmd: "sleep",
      args: ["30"],
      timeoutMs: 3_000,
    },
    {
      label: "Test 3: sleep 120 (タイムアウト強制, timeout=3s)",
      cmd: "sleep",
      args: ["120"],
      timeoutMs: 3_000,
    },
    {
      label: "Test 4: bash -c 'echo hello && sleep 2 && echo done' (shell付き正常終了)",
      cmd: "bash",
      args: ["-c", "echo hello && sleep 2 && echo done"],
      timeoutMs: 10_000,
    },
    {
      label: "Test 5: bash -c 'trap \"\" SIGTERM; sleep 30' (SIGTERM無視→SIGKILL)",
      cmd: "bash",
      args: ["-c", 'trap "" SIGTERM; sleep 30'],
      timeoutMs: 3_000,
    },
  ];

  const results: TestResult[] = [];

  for (const t of tests) {
    console.log(`--- ${t.label} ---`);
    const result = await runTest(t.cmd, t.args, t.timeoutMs);
    results.push(result);
    console.log(`  exit=${result.exitCode} signal=${result.signal} elapsed=${result.elapsedMs}ms timedOut=${result.timedOut}`);
    if (result.stdout) console.log(`  stdout: ${result.stdout}`);
    if (result.stderr) console.log(`  stderr: ${result.stderr}`);
    console.log();
  }

  // Output summary as JSON for easy parsing
  console.log("=== JSON Summary ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
