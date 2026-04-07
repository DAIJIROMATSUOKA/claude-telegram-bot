/**
 * logger.ts — Structured JSON line logger (no external deps)
 *
 * Output format: {"ts":"ISO","level":"info","module":"inbox","msg":"...","data":{}}
 */

interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  module: string;
  msg: string;
  data?: unknown;
}

function emit(level: "info" | "warn" | "error", module: string, msg: string, extra?: unknown): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, module, msg };
  if (extra !== undefined) {
    entry.data = extra instanceof Error
      ? { message: extra.message, stack: extra.stack }
      : extra;
  }
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(module: string, msg: string, data?: unknown): void {
    emit("info", module, msg, data);
  },
  warn(module: string, msg: string, data?: unknown): void {
    emit("warn", module, msg, data);
  },
  error(module: string, msg: string, error?: unknown): void {
    emit("error", module, msg, error);
  },
};

export function createLogger(module: string) {
  return {
    info(msg: unknown, ...args: unknown[]): void {
      emit("info", module, String(msg), args.length === 1 ? args[0] : args.length > 1 ? args : undefined);
    },
    warn(msg: unknown, ...args: unknown[]): void {
      emit("warn", module, String(msg), args.length === 1 ? args[0] : args.length > 1 ? args : undefined);
    },
    error(msg: unknown, ...args: unknown[]): void {
      emit("error", module, String(msg), args.length === 1 ? args[0] : args.length > 1 ? args : undefined);
    },
  };
}
