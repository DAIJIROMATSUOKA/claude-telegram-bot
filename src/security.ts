/**
 * Security module for Claude Telegram Bot.
 *
 * Rate limiting, path validation, command safety.
 */

import { resolve, normalize } from "path";
import { realpathSync } from "fs";
import type { RateLimitBucket } from "./types";
import {
  ALLOWED_PATHS,
  BLOCKED_PATTERNS,
  RATE_LIMIT_ENABLED,
  RATE_LIMIT_REQUESTS,
  RATE_LIMIT_WINDOW,
  TEMP_PATHS,
} from "./config";

// ============== Rate Limiter ==============

class RateLimiter {
  private buckets = new Map<number, RateLimitBucket>();
  private maxTokens: number;
  private refillRate: number; // tokens per second

  constructor() {
    this.maxTokens = RATE_LIMIT_REQUESTS;
    this.refillRate = RATE_LIMIT_REQUESTS / RATE_LIMIT_WINDOW;
  }

  check(userId: number): [allowed: boolean, retryAfter?: number] {
    if (!RATE_LIMIT_ENABLED) {
      return [true];
    }

    const now = Date.now();
    let bucket = this.buckets.get(userId);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastUpdate: now };
      this.buckets.set(userId, bucket);
    }

    // Refill tokens based on time elapsed
    const elapsed = (now - bucket.lastUpdate) / 1000;
    bucket.tokens = Math.min(
      this.maxTokens,
      bucket.tokens + elapsed * this.refillRate
    );
    bucket.lastUpdate = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return [true];
    }

    // Calculate time until next token
    const retryAfter = (1 - bucket.tokens) / this.refillRate;
    return [false, retryAfter];
  }

  getStatus(userId: number): {
    tokens: number;
    max: number;
    refillRate: number;
  } {
    const bucket = this.buckets.get(userId);
    return {
      tokens: bucket?.tokens ?? this.maxTokens,
      max: this.maxTokens,
      refillRate: this.refillRate,
    };
  }
}

export const rateLimiter = new RateLimiter();

// ============== Path Validation ==============

export function isPathAllowed(path: string): boolean {
  try {
    // Expand ~ and resolve to absolute path
    const expanded = path.replace(/^~/, process.env.HOME || "");
    const normalized = normalize(expanded);

    // Try to resolve symlinks (may fail if path doesn't exist yet)
    let resolved: string;
    try {
      resolved = realpathSync(normalized);
    } catch {
      resolved = resolve(normalized);
    }

    // Always allow temp paths (for bot's own files)
    for (const tempPath of TEMP_PATHS) {
      if (resolved.startsWith(tempPath)) {
        return true;
      }
    }

    // Check against allowed paths using proper containment
    for (const allowed of ALLOWED_PATHS) {
      const allowedResolved = resolve(allowed);
      if (
        resolved === allowedResolved ||
        resolved.startsWith(allowedResolved + "/")
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

// ============== Command Safety ==============

/**
 * コマンド内のバイナリ名を正規化する。
 * /usr/bin/rm → rm, /bin/bash → bash 等
 */
function normalizeCommand(command: string): string {
  // フルパスのバイナリ名を短縮名に正規化
  return command.replace(
    /(?:\/usr\/local\/bin\/|\/usr\/bin\/|\/bin\/|\/opt\/homebrew\/bin\/|\/sbin\/)(\w+)/g,
    '$1'
  );
}

export function checkCommandSafety(
  command: string
): [safe: boolean, reason: string] {
  // 1. コマンドを正規化してバイパスを防ぐ
  const normalized = normalizeCommand(command);
  const lowerCommand = normalized.toLowerCase();

  // 2. 改行・制御文字を含むコマンドはブロック（インジェクション防止）
  if (/[\x00-\x08\x0e-\x1f]/.test(command)) {
    return [false, "Command contains control characters"];
  }

  // 3. ブロックパターンチェック（正規化後のコマンドに対して）
  for (const pattern of BLOCKED_PATTERNS) {
    if (lowerCommand.includes(pattern.toLowerCase())) {
      return [false, `Blocked pattern: ${pattern}`];
    }
  }

  // 4. 危険なコマンドの追加チェック（正規表現ベース）
  const dangerousPatterns: Array<[RegExp, string]> = [
    // chmod でスクリプトを実行可能にする
    [/chmod\s+[+0-7]*[xuX]/, "chmod with execute permission"],
    // curl/wget でスクリプトをパイプ実行
    [/(?:curl|wget)\s.*\|\s*(?:bash|sh|zsh)/, "Pipe download to shell"],
    // eval は原則ブロック
    [/\beval\s/, "eval command"],
    // Python/Node でのシェルコマンドインジェクション
    [/(?:python|node|ruby|perl)\s+-e\s/, "Inline script execution"],
    // 環境変数の上書きで危険なもの
    [/\bexport\s+(?:PATH|LD_PRELOAD|DYLD_)/, "Dangerous environment variable override"],
    // ファイルディスクリプタリダイレクトで上書き
    [/>\s*\/(?:etc|usr|System|Library)\//, "Write to system directory"],
  ];

  for (const [pattern, reason] of dangerousPatterns) {
    if (pattern.test(normalized)) {
      return [false, `Blocked: ${reason}`];
    }
  }

  // 5. rm コマンド — パス検証（正規化済みコマンドで）
  if (lowerCommand.includes("rm ")) {
    try {
      const rmMatch = normalized.match(/rm\s+(.+)/i);
      if (rmMatch) {
        const args = rmMatch[1]!.split(/\s+/);
        for (const arg of args) {
          if (arg.startsWith("-") || arg.length <= 1) continue;
          if (!isPathAllowed(arg)) {
            return [false, `rm target outside allowed paths: ${arg}`];
          }
        }
      }
    } catch {
      return [false, "Could not parse rm command for safety check"];
    }
  }

  return [true, ""];
}

// ============== Authorization ==============

export function isAuthorized(
  userId: number | undefined,
  allowedUsers: number[]
): boolean {
  if (!userId) return false;
  if (allowedUsers.length === 0) return false;
  return allowedUsers.includes(userId);
}
