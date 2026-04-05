/**
 * Command handlers for Claude Telegram Bot.
 * Thin re-export for backward compatibility — implementations in commands/ directory.
 */

export {
  handleStart,
  handleNew,
  handleStop,
  handleStatus,
  handleResume,
  handleRestart,
  handleRetry,
  handleStats,
  incrementMessageCount,
  handleTaskStart,
  handleTaskStop,
  handleTaskPause,
  handleTodoist,
  handleFocus,
  handleAlarm,
  handleReminder,
  handleRecall,
  handleCroppyDispatch,
  handleHelp,
  handleHelpCategoryCallback,
  handleHelpBackCallback,
} from "./commands/index";
