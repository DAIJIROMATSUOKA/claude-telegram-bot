/**
 * Inbox callback dispatcher — routes callback_data to individual handlers.
 */

import type { Context } from "grammy";
import { logger } from "../../utils/logger";
import type { CallbackContext } from "./callback-handlers";
import {
  handleArchiveCallback,
  handleTrashCallback,
  handleDelCallback,
  handleDelmemoCallback,
  handleTodoCallback,
  handleSnz1hCallback,
  handleSnz3hCallback,
  handleSnzamCallback,
} from "./callback-handlers";

type CallbackHandler = (cc: CallbackContext) => Promise<void>;

const callbackHandlers: Record<string, CallbackHandler> = {
  archive: handleArchiveCallback,
  trash: handleTrashCallback,
  del: handleDelCallback,
  delmemo: handleDelmemoCallback,
  todo: handleTodoCallback,
  snz1h: handleSnz1hCallback,
  snz3h: handleSnz3hCallback,
  snzam: handleSnzamCallback,
};

/**
 * Dispatch an inbox callback to the appropriate handler.
 * Returns the handler function for direct actions, or uses the strategy map for batch actions.
 */
export function dispatchInboxCallback(
  action: string,
): CallbackHandler | null {
  return callbackHandlers[action] || null;
}

export type { CallbackContext };
