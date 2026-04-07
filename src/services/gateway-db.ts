/**
 * Gateway DB Service - D1 query via Memory Gateway
 * Grammy Bot → HTTP → Memory Gateway → D1
 */

import { createLogger } from "../utils/logger";
const log = createLogger("gateway-db");

import { gatewayRateLimiter } from "../utils/rate-limiter";
import { withRetry } from "../utils/retry";

const GATEWAY_URL = process.env.GATEWAY_URL || "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev";
const GATEWAY_KEY = process.env.GATEWAY_API_KEY || "";

/**
 * Execute a D1 query via Memory Gateway
 */
export async function gatewayQuery(
  sql: string,
  params?: any[]
): Promise<{ results: any[]; meta?: any } | null> {
  try {
    await gatewayRateLimiter.acquire("query");
    return await withRetry(async () => {
      const res = await fetch(`${GATEWAY_URL}/v1/db/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": GATEWAY_KEY,
        },
        body: JSON.stringify({ sql, params: params || [] }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      const data: any = await res.json();
      if (!data.success) {
        throw new Error(`Query failed: ${JSON.stringify(data)}`);
      }

      return { results: data.results || [], meta: data.meta };
    });
  } catch (error) {
    log.error("[GatewayDB] Error:", error);
    return null;
  }
}
