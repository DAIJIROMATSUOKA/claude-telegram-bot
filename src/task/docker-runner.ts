/**
 * Jarvis Docker Test Runner
 *
 * Runs bun test inside a Docker sandbox with:
 * - --network=none (no internet)
 * - --read-only root filesystem
 * - --cap-drop=ALL (no capabilities)
 * - --security-opt=no-new-privileges
 * - Non-root user (1000:1000)
 * - src/ mounted read-only, sandbox/ mounted read-write
 *
 * Debate: Croppy × GPT, 4 rounds CONVERGED (2026-02-14)
 * Spec: docs/docker-sandbox-spec.md
 */

import { execSync } from "node:child_process";

const DOCKER_IMAGE = "jarvis-test-runner:latest";
const TEST_TIMEOUT_MS = 120_000; // 2 min for Docker test execution

// Secret patterns to redact from stdout/stderr
const SECRET_REDACTION_PATTERNS: RegExp[] = [
  /sk-ant-[a-zA-Z0-9_-]+/g,
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /TELEGRAM_BOT_TOKEN=[^\s]+/g,
  /eyJ[a-zA-Z0-9_-]{50,}/g,          // JWT
  /[a-zA-Z0-9+/]{100,}={0,2}/g,      // long base64
];

/**
 * Redact secrets from output before saving to logs
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_REDACTION_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Check if Docker is available and the test runner image exists
 */
export function checkDockerAvailable(): {
  available: boolean;
  reason?: string;
} {
  // 1. Docker daemon running?
  try {
    execSync("docker info > /dev/null 2>&1", { timeout: 10_000 });
  } catch {
    return { available: false, reason: "Docker daemon not running" };
  }

  // 2. Test runner image exists?
  try {
    const out = execSync(`docker images -q ${DOCKER_IMAGE} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    if (!out) {
      return {
        available: false,
        reason: `Image ${DOCKER_IMAGE} not found. Run: docker build -f Dockerfile.test-runner -t jarvis-test-runner .`,
      };
    }
  } catch {
    return { available: false, reason: "Failed to check Docker images" };
  }

  return { available: true };
}

/**
 * Build the Docker test runner image
 */
export function buildDockerImage(repoPath: string): boolean {
  try {
    console.log("[Docker] Building test runner image...");
    execSync(
      `docker build -f Dockerfile.test-runner -t ${DOCKER_IMAGE} .`,
      {
        cwd: repoPath,
        timeout: 120_000,
        stdio: "pipe",
      },
    );
    console.log("[Docker] Image built successfully");
    return true;
  } catch (err: any) {
    console.error("[Docker] Image build failed:", err.message);
    return false;
  }
}

/**
 * Run a test command inside Docker sandbox
 *
 * @param testCommand - The test command (e.g., "bun test ./src/task/retry.test.ts")
 * @param worktreePath - Git worktree path (src/ will be mounted RO)
 * @param sandboxPath - Path to sandbox dir with generated code (mounted RW)
 * @returns { passed, output } - Test result
 */
export function runTestInDocker(
  testCommand: string,
  worktreePath: string,
  sandboxPath?: string,
): { passed: boolean; output: string } {
  // Build docker run command
  const args: string[] = [
    "docker", "run", "--rm",
    // Network isolation
    "--network=none",
    // Resource limits
    "--memory=2g", "--cpus=2", "--pids-limit=256",
    // Security hardening
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    // Read-only root + tmpfs for temp files
    "--read-only",
    "--tmpfs", "/tmp:rw,noexec,size=500m",
    // HOME for bun cache
    "-e", "HOME=/tmp",
    // Mount src/ read-only (NO .env, .git, node_modules)
    "-v", `${worktreePath}/src:/app/src:ro`,
    // Mount config files individually (RO)
    "-v", `${worktreePath}/tsconfig.json:/app/tsconfig.json:ro`,
    "-v", `${worktreePath}/package.json:/app/package.json:ro`,
  ];

  // Mount sandbox if provided (for generated test files)
  if (sandboxPath) {
    args.push("-v", `${sandboxPath}:/app/sandbox:rw`);
  }

  // User
  args.push("--user", "1000:1000");

  // Image
  args.push(DOCKER_IMAGE);

  // Transform test command to work inside container
  // e.g., "bun test ./src/task/retry.test.ts" → same but runs in /app
  args.push("sh", "-c", testCommand);

  const cmd = args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ");

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: TEST_TIMEOUT_MS,
      env: { ...process.env },
    });
    const redacted = redactSecrets(output.slice(0, 80_000));
    return { passed: true, output: redacted };
  } catch (err: any) {
    const rawOutput = (err.stdout || "") + "\n" + (err.stderr || err.message || "");
    const redacted = redactSecrets(rawOutput.slice(0, 80_000));
    return { passed: false, output: redacted };
  }
}
