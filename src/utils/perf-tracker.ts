/**
 * perf-tracker.ts — Handler execution timing tracker
 *
 * Usage:
 *   await trackHandler("handleText", () => handleText(ctx));
 *
 * /perf command shows top 10 slowest handlers.
 */

interface HandlerStats {
  count: number;
  totalMs: number;
  maxMs: number;
}

const stats = new Map<string, HandlerStats>();

/**
 * Wrap a handler call with timing. Returns the handler's result.
 */
export async function trackHandler<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const elapsed = Date.now() - start;
    const s = stats.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
    s.count += 1;
    s.totalMs += elapsed;
    s.maxMs = Math.max(s.maxMs, elapsed);
    stats.set(name, s);
  }
}

/**
 * Return top N slowest handlers sorted by average response time.
 */
export function getTopSlowHandlers(n = 10): Array<{
  name: string;
  avg: number;
  max: number;
  count: number;
}> {
  return Array.from(stats.entries())
    .map(([name, s]) => ({
      name,
      avg: Math.round(s.totalMs / s.count),
      max: s.maxMs,
      count: s.count,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, n);
}

/**
 * Format perf stats as a human-readable string for Telegram.
 */
export function formatPerfStats(): string {
  const rows = getTopSlowHandlers(10);
  if (rows.length === 0) return "No handler data yet.";

  const lines = ["📊 <b>Handler Performance (top 10 by avg ms)</b>", ""];
  for (const r of rows) {
    lines.push(`<code>${r.name.padEnd(24)}</code> avg <b>${r.avg}ms</b> max ${r.max}ms (${r.count}x)`);
  }
  return lines.join("\n");
}
