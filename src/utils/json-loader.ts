/**
 * Safe JSON file loader with error handling.
 * Replaces scattered JSON.parse(readFileSync(...)) patterns.
 */

import { readFileSync, existsSync } from "fs";

/**
 * Load and parse a JSON file safely.
 * @param path - Absolute path to JSON file
 * @param fallback - Value to return if file is missing or invalid. If omitted, throws on error.
 * @returns Parsed JSON content or fallback
 */
export function loadJsonFile<T>(path: string, fallback?: T): T {
  try {
    if (!existsSync(path)) {
      if (arguments.length >= 2) return fallback as T;
      throw new Error(`JSON file not found: ${path}`);
    }
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    if (arguments.length >= 2) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[json-loader] Parse error for ${path}:`, (error as Error).message);
      }
      return fallback as T;
    }
    throw error;
  }
}
