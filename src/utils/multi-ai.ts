/**
 * Multi-AI Backend Wrappers (従量課金ゼロ)
 *
 * Claude  → CLI経由 (Max subscription 固定)
 * Gemini  → CLI経由 (Google AI Pro 固定)
 * ChatGPT → macOS Shortcuts経由 (Pro subscription 固定)
 *
 * 全てspawn経由。従量課金APIキーは一切使わない。
 */

import { spawn } from "node:child_process";
import { CLAUDE_MODEL } from "../constants";

export interface AIResponse {
  output: string;
  backend: string;
  emoji: string;
  latency_ms: number;
  error?: string;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

function spawnCLI(
  cmd: string,
  args: string[],
  input: string | null,
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let done = false;

    const child = spawn(cmd, args, {
      stdio: [input != null ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(hardTimer);
      clearTimeout(softTimer);
      resolve({ stdout: stdout.trim(), stderr, code, timedOut });
    };

    // Soft kill (SIGTERM) at timeout
    const softTimer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
    }, timeoutMs);

    // Hard kill (SIGKILL) 5s after soft
    const hardTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs + 5_000);

    if (input != null) {
      try {
        child.stdin!.write(input);
        child.stdin!.end();
      } catch {}
    }

    child.stdout!.on("data", (c: Buffer) => { stdout += c.toString(); });
    child.stderr!.on("data", (c: Buffer) => { stderr += c.toString(); });
    child.on("close", (code) => finish(code ?? 1));
    child.on("error", () => finish(1));
  });
}

/**
 * Claude CLI (Max subscription)
 * spawn("claude", ["-p", "-"]) + stdin — shell不使用で安全、"-"始まりのプロンプトも問題なし
 */
export async function askClaude(prompt: string, timeoutMs = 600_000): Promise<AIResponse> {
  const start = Date.now();
  const r = await spawnCLI("claude", ["--model", CLAUDE_MODEL, "-p", "-"], prompt, timeoutMs);
  return {
    output: (r.code === 0 || r.stdout) ? r.stdout : "",
    backend: "claude",
    emoji: "\u{1F9E0}",  // 🧠
    latency_ms: Date.now() - start,
    error: (r.code !== 0 && !r.stdout) ? (r.timedOut ? "timeout" : "exit " + r.code) : undefined,
  };
}

/**
 * Gemini CLI (Google AI Pro subscription)
 * stderrのpunycode warningは無視
 */
export async function askGemini(prompt: string, timeoutMs = 600_000): Promise<AIResponse> {
  const start = Date.now();
  const r = await spawnCLI("gemini", ["--model", "gemini-3.1-pro"], prompt, timeoutMs);
  return {
    output: (r.code === 0 || r.stdout) ? r.stdout : "",
    backend: "gemini",
    emoji: "\u{1F52E}",  // 🔮
    latency_ms: Date.now() - start,
    error: (r.code !== 0 && !r.stdout) ? (r.timedOut ? "timeout" : "exit " + r.code) : undefined,
  };
}

/**
 * ChatGPT via macOS Shortcuts (Pro subscription)
 * promptはstdin経由で渡す
 */
export async function askChatGPT(prompt: string, timeoutMs = 600_000): Promise<AIResponse> {
  const start = Date.now();
  const r = await spawnCLI("shortcuts", ["run", "Ask ChatGPT"], prompt, timeoutMs);
  return {
    output: (r.code === 0 || r.stdout) ? r.stdout : "",
    backend: "chatgpt",
    emoji: "\u{1F4AC}",  // 💬
    latency_ms: Date.now() - start,
    error: (r.code !== 0 && !r.stdout) ? (r.timedOut ? "timeout" : "exit " + r.code) : undefined,
  };
}

/**
 * 3AI並列実行（失敗したAIはスキップ）
 */
export async function askAll(prompt: string, timeoutMs = 600_000): Promise<AIResponse[]> {
  const results = await Promise.allSettled([
    askClaude(prompt, timeoutMs),
    askGemini(prompt, timeoutMs),
    askChatGPT(prompt, timeoutMs),
  ]);
  return results
    .filter((r): r is PromiseFulfilledResult<AIResponse> => r.status === "fulfilled")
    .map((r) => r.value);
}

/**
 * 利用可能なAIを確認
 */
export async function checkAvailability(): Promise<{ name: string; available: boolean }[]> {
  const test = "Reply with just OK";
  const checks = await Promise.allSettled([
    askClaude(test, 15_000),
    askGemini(test, 15_000),
    askChatGPT(test, 15_000),
  ]);
  const names = ["claude", "gemini", "chatgpt"];
  return checks.map((r, i) => ({
    name: names[i]!,
    available: r.status === "fulfilled" && !r.value.error,
  }));
}
