/**
 * Contact Log — Log customer contacts to D1 via Memory Gateway
 */

import { gatewayQuery } from "../services/gateway-db";

/**
 * Log a customer contact event to D1.
 */
export async function logContact(
  source: string,
  customerId: string,
  direction: "inbound" | "outbound"
): Promise<boolean> {
  const timestamp = new Date().toISOString();

  const result = await gatewayQuery(
    `INSERT INTO contact_log (source, customer_id, direction, timestamp) VALUES (?, ?, ?, ?)`,
    [source, customerId, direction, timestamp]
  );

  if (!result) {
    console.error("[ContactLog] Failed to log contact:", { source, customerId, direction });
    return false;
  }

  return true;
}

/**
 * Ensure contact_log table exists in D1.
 */
async function ensureContactLogTable(): Promise<void> {
  await gatewayQuery(
    `CREATE TABLE IF NOT EXISTS contact_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
      timestamp TEXT NOT NULL
    )`
  );
}
