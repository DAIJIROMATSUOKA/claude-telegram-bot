/**
 * JSON config file loader with BOM stripping, mtime-based caching, and error handling.
 * Use for reading JSON files (configs, state files, etc.) instead of
 * raw JSON.parse(readFileSync(...)) patterns.
 */

import { readFileSync, existsSync, statSync } from "fs";

interface CacheEntry {
  data: unknown;
  mtime: number;
}

const cache = new Map<string, CacheEntry>();

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * Load and parse a JSON file with BOM stripping and mtime-based caching.
 * @param path - Absolute path to JSON file
 * @param fallback - Value to return if file is missing or invalid. If omitted, throws on error.
 * @returns Parsed JSON content or fallback
 */
export function loadConfig<T>(path: string, fallback?: T): T {
  try {
    if (!existsSync(path)) {
      if (arguments.length >= 2) return fallback as T;
      throw new Error(`Config file not found: ${path}`);
    }
    const mtime = statSync(path).mtimeMs;
    const cached = cache.get(path);
    if (cached && cached.mtime === mtime) {
      return cached.data as T;
    }
    const content = stripBom(readFileSync(path, "utf-8"));
    const data = JSON.parse(content) as T;
    cache.set(path, { data, mtime });
    return data;
  } catch (error) {
    if (arguments.length >= 2) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[config-loader] Parse error for ${path}:`, (error as Error).message);
      }
      return fallback as T;
    }
    throw error;
  }
}

/** Clear the cache for a specific path (e.g. after writing the file). */
export function invalidateConfig(path: string): void {
  cache.delete(path);
}
