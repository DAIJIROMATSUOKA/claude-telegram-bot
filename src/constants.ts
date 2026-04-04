/**
 * Shared constants for the JARVIS Telegram Bot.
 * Centralizes magic numbers and strings used across handlers and services.
 */

// ============== Timeouts ==============

/** Default shell command timeout (30s) */
export const CMD_TIMEOUT_MS = 30_000;

/** Short shell command timeout (5s) — status checks, git queries */
export const CMD_TIMEOUT_SHORT_MS = 5_000;

/** Long shell command timeout (3min) — AI CLI calls */
export const CMD_TIMEOUT_LONG_MS = 180_000;

/** Domain relay timeout (4.5min) */
export const DOMAIN_RELAY_TIMEOUT_MS = 270_000;

/** Worker response wait timeout (3min) */
export const WORKER_RESPONSE_TIMEOUT_MS = 180_000;

/** AI council timeout (3.5min) */
export const COUNCIL_TIMEOUT_MS = 210_000;

// ============== Retry / Limits ==============

/** Auto-delete delay for ephemeral UI messages (ms) */
export const AUTO_DELETE_MS = 3_000;

/** Auto-delete delay for confirmation messages (ms) */
export const CONFIRM_DELETE_MS = 5_000;

/** Maximum scout action execution timeout (2min) */
export const SCOUT_TIMEOUT_MS = 120_000;

// ============== Gateway ==============

/** Default Memory Gateway URL */
export const DEFAULT_GATEWAY_URL =
  "https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev";

// ============== Telegram ==============

/** Telegram message character limit */
export const TG_MESSAGE_LIMIT = 4096;

/** Safe message limit with buffer for HTML formatting */
export const TG_SAFE_LIMIT = 4000;

/** Maximum characters for search result messages */
export const MAX_MSG_LEN = 4000;
