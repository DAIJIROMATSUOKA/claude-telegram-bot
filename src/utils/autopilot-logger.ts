/**
 * Autopilot Structured Logger
 *
 * Provides structured logging for Autopilot Engine with:
 * - JSON-formatted logs
 * - Log levels (debug, info, warn, error)
 * - Context preservation (task_id, plugin, phase)
 * - Performance metrics
 *
 * Phase: 5 (Priority 2 Improvements)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  task_id?: string;
  plugin?: string;
  phase?: string;
  confidence?: number;
  impact?: string;
  decision?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  duration_ms?: number;
  error?: {
    message: string;
    stack?: string;
  };
}

/**
 * Autopilot Logger
 *
 * Structured logging with context preservation.
 */
export class AutopilotLogger {
  private context: LogContext = {};
  private minLevel: LogLevel = 'info';

  constructor(initialContext?: LogContext) {
    if (initialContext) {
      this.context = { ...initialContext };
    }

    // Set log level from environment
    const envLevel = process.env.AUTOPILOT_LOG_LEVEL as LogLevel;
    if (envLevel && ['debug', 'info', 'warn', 'error'].includes(envLevel)) {
      this.minLevel = envLevel;
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): AutopilotLogger {
    const childLogger = new AutopilotLogger({
      ...this.context,
      ...context,
    });
    childLogger.minLevel = this.minLevel;
    return childLogger;
  }

  /**
   * Update context for this logger
   */
  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Debug log (development only)
   */
  debug(message: string, meta?: any): void {
    this.log('debug', message, meta);
  }

  /**
   * Info log (normal operation)
   */
  info(message: string, meta?: any): void {
    this.log('info', message, meta);
  }

  /**
   * Warning log (potential issues)
   */
  warn(message: string, meta?: any): void {
    this.log('warn', message, meta);
  }

  /**
   * Error log (failures)
   */
  error(message: string, error?: Error | string, meta?: any): void {
    const errorMeta = {
      ...meta,
      error: this.formatError(error),
    };
    this.log('error', message, errorMeta);
  }

  /**
   * Log with performance timing
   */
  time(label: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.info(`${label} completed`, { duration_ms: duration });
    };
  }

  /**
   * Log an entry
   */
  private log(level: LogLevel, message: string, meta?: any): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.context },
      ...meta,
    };

    const formatted = this.format(entry);
    this.output(level, formatted);
  }

  /**
   * Check if log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const levelIndex = levels.indexOf(level);
    const minLevelIndex = levels.indexOf(this.minLevel);
    return levelIndex >= minLevelIndex;
  }

  /**
   * Format log entry
   */
  private format(entry: LogEntry): string {
    // Console format: [timestamp] [level] message {context}
    const timestamp = entry.timestamp.substring(11, 19); // HH:MM:SS
    const level = entry.level.toUpperCase().padEnd(5);
    const context = this.formatContext(entry);

    return `[${timestamp}] [${level}] ${entry.message}${context}`;
  }

  /**
   * Format context for display
   */
  private formatContext(entry: LogEntry): string {
    const parts: string[] = [];

    if (entry.context?.task_id) {
      parts.push(`task=${entry.context.task_id}`);
    }
    if (entry.context?.plugin) {
      parts.push(`plugin=${entry.context.plugin}`);
    }
    if (entry.context?.phase) {
      parts.push(`phase=${entry.context.phase}`);
    }
    if (entry.duration_ms !== undefined) {
      parts.push(`duration=${entry.duration_ms}ms`);
    }
    if (entry.context?.confidence !== undefined) {
      parts.push(`confidence=${entry.context.confidence.toFixed(2)}`);
    }
    if (entry.context?.decision) {
      parts.push(`decision=${entry.context.decision}`);
    }

    return parts.length > 0 ? ` {${parts.join(', ')}}` : '';
  }

  /**
   * Format error object
   */
  private formatError(error?: Error | string): { message: string; stack?: string } | undefined {
    if (!error) return undefined;

    if (typeof error === 'string') {
      return { message: error };
    }

    return {
      message: error.message,
      stack: error.stack,
    };
  }

  /**
   * Output log to console
   */
  private output(level: LogLevel, message: string): void {
    switch (level) {
      case 'debug':
        console.debug(message);
        break;
      case 'info':
        console.info(message);
        break;
      case 'warn':
        console.warn(message);
        break;
      case 'error':
        console.error(message);
        break;
    }
  }

  /**
   * Create a JSON log entry (for file logging)
   */
  toJSON(level: LogLevel, message: string, meta?: any): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.context },
      ...meta,
    };

    return JSON.stringify(entry);
  }
}

/**
 * Default logger instance
 */
export const defaultLogger = new AutopilotLogger({ component: 'autopilot' });

/**
 * Create a logger with context
 */
export function createLogger(context: LogContext): AutopilotLogger {
  return new AutopilotLogger(context);
}
