/**
 * Gateway DB Service - D1 query via Memory Gateway
 * Grammy Bot → HTTP → Memory Gateway → D1
 */

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
    const res = await fetch(`${GATEWAY_URL}/v1/db/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": GATEWAY_KEY,
      },
      body: JSON.stringify({ sql, params: params || [] }),
    });

    if (!res.ok) {
      console.error("[GatewayDB] HTTP error:", res.status, await res.text());
      return null;
    }

    const data: any = await res.json();
    if (!data.success) {
      console.error("[GatewayDB] Query failed:", data);
      return null;
    }

    return { results: data.results || [], meta: data.meta };
  } catch (error) {
    console.error("[GatewayDB] Error:", error);
    return null;
  }
}
