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

// ============== Media ==============

import { join } from "path";
import { existsSync } from "fs";

/** AI media generation script path */
export const AI_MEDIA_SCRIPT = join(process.env.HOME || "~", "claude-telegram-bot", "scripts", "ai-media.py");

/** Python path — prefer mflux venv if available */
const MFLUX_VENV_PYTHON = join(process.env.HOME || "~", "ai-tools", "mflux-env", "bin", "python3");
export const PYTHON = existsSync(MFLUX_VENV_PYTHON) ? MFLUX_VENV_PYTHON : "python3";

/** Image generation timeout (25 min) */
export const TIMEOUT_IMAGE = 25 * 60 * 1000;

/** Video generation timeout (45 min) */
export const TIMEOUT_VIDEO = 45 * 60 * 1000;

// ============== Embedding ==============

/** Embedding server URL */
export const EMBED_SERVER = process.env.EMBED_SERVER_URL || 'http://127.0.0.1:19823';

/** Embedding server timeout (ms) */
export const EMBED_TIMEOUT = 5000;

// ============== Script Paths ==============

const HOME = process.env.HOME || "~";

/** Scripts directory */
export const SCRIPTS_DIR = `${HOME}/claude-telegram-bot/scripts`;

/** Croppy tab manager script */
export const CROPPY_TAB_MANAGER = `${SCRIPTS_DIR}/croppy-tab-manager.sh`;

/** Nightshift toggle script */
export const CROPPY_NIGHTSHIFT = `${SCRIPTS_DIR}/nightshift.sh`;

/** Croppy supervisor script */
export const CROPPY_SUPERVISOR = `${SCRIPTS_DIR}/croppy-supervisor.sh`;

/** Project tab router script */
export const PROJECT_TAB_ROUTER = `${SCRIPTS_DIR}/project-tab-router.sh`;

/** Tab relay script */
export const TAB_RELAY = `${SCRIPTS_DIR}/tab-relay.sh`;

/** Orchestrator audit directory */
export const ORCHESTRATOR_AUDIT_DIR = `${HOME}/.jarvis/orchestrator`;

/** Orchestrator audit file */
export const ORCHESTRATOR_AUDIT_FILE = `${ORCHESTRATOR_AUDIT_DIR}/audit.jsonl`;

// ============== Memory GC ==============

/** Maximum learned memories to keep */
export const MAX_LEARNED_MEMORIES = 50;

/** Days before learned memories expire */
export const LEARNED_MEMORY_EXPIRE_DAYS = 90;

/** Minimum confidence for learned memories */
export const LEARNED_MEMORY_MIN_CONFIDENCE = 0.8;

/** Days before session summaries expire */
export const SESSION_SUMMARY_EXPIRE_DAYS = 30;

/** Number of recent session summaries to always keep */
export const SESSION_SUMMARY_KEEP_RECENT = 5;
