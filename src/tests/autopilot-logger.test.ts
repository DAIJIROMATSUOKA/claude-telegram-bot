/**
 * Unit tests for AutopilotLogger
 */

import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  AutopilotLogger,
  createLogger,
  defaultLogger,
  type LogLevel,
  type LogContext,
} from '../utils/autopilot-logger';

describe('AutopilotLogger', () => {
  let consoleSpy: {
    debug: ReturnType<typeof spyOn>;
    info: ReturnType<typeof spyOn>;
    warn: ReturnType<typeof spyOn>;
    error: ReturnType<typeof spyOn>;
  };

  beforeEach(() => {
    // Spy on console methods
    consoleSpy = {
      debug: spyOn(console, 'debug').mockImplementation(() => {}),
      info: spyOn(console, 'info').mockImplementation(() => {}),
      warn: spyOn(console, 'warn').mockImplementation(() => {}),
      error: spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    // Restore console methods
    consoleSpy.debug.mockRestore();
    consoleSpy.info.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
    // Clean up environment
    delete process.env.AUTOPILOT_LOG_LEVEL;
  });

  describe('createLogger', () => {
    test('returns AutopilotLogger instance', () => {
      const logger = createLogger({});
      expect(logger).toBeInstanceOf(AutopilotLogger);
    });

    test('creates logger with context', () => {
      const logger = createLogger({ task_id: 'test-123', plugin: 'test-plugin' });
      expect(logger).toBeInstanceOf(AutopilotLogger);
    });
  });

  describe('defaultLogger', () => {
    test('is an AutopilotLogger instance', () => {
      expect(defaultLogger).toBeInstanceOf(AutopilotLogger);
    });
  });

  describe('logging methods', () => {
    test('info logs with correct level', () => {
      const logger = createLogger({});
      logger.info('Test info message');

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain('[INFO ]');
      expect(loggedMessage).toContain('Test info message');
    });

    test('warn logs with correct level', () => {
      const logger = createLogger({});
      logger.warn('Test warn message');

      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.warn.mock.calls[0][0];
      expect(loggedMessage).toContain('[WARN ]');
      expect(loggedMessage).toContain('Test warn message');
    });

    test('error logs with correct level', () => {
      const logger = createLogger({});
      logger.error('Test error message');

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.error.mock.calls[0][0];
      expect(loggedMessage).toContain('[ERROR]');
      expect(loggedMessage).toContain('Test error message');
    });

    test('debug logs with correct level when enabled', () => {
      process.env.AUTOPILOT_LOG_LEVEL = 'debug';
      const logger = createLogger({});
      logger.debug('Test debug message');

      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.debug.mock.calls[0][0];
      expect(loggedMessage).toContain('[DEBUG]');
      expect(loggedMessage).toContain('Test debug message');
    });
  });

  describe('log entry structure', () => {
    test('includes timestamp in HH:MM:SS format', () => {
      const logger = createLogger({});
      logger.info('Test message');

      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      // Format: [HH:MM:SS]
      expect(loggedMessage).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    });

    test('includes level in log output', () => {
      const logger = createLogger({});
      logger.info('Test message');

      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain('[INFO ]');
    });

    test('includes message in log output', () => {
      const logger = createLogger({});
      const testMessage = 'This is a test message';
      logger.info(testMessage);

      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain(testMessage);
    });

    test('includes context in log output', () => {
      const logger = createLogger({ task_id: 'task-456', plugin: 'test-plugin' });
      logger.info('Test with context');

      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain('task=task-456');
      expect(loggedMessage).toContain('plugin=test-plugin');
    });

    test('includes phase in context', () => {
      const logger = createLogger({ phase: 'execution' });
      logger.info('Phase test');

      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain('phase=execution');
    });

    test('includes confidence in context', () => {
      const logger = createLogger({ confidence: 0.85 });
      logger.info('Confidence test');

      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain('confidence=0.85');
    });

    test('includes decision in context', () => {
      const logger = createLogger({ decision: 'approve' });
      logger.info('Decision test');

      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain('decision=approve');
    });
  });

  describe('log level filtering', () => {
    test('filters out debug logs by default (minLevel=info)', () => {
      const logger = createLogger({});
      logger.debug('Should not appear');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    test('shows debug logs when AUTOPILOT_LOG_LEVEL=debug', () => {
      process.env.AUTOPILOT_LOG_LEVEL = 'debug';
      const logger = createLogger({});
      logger.debug('Should appear');

      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
    });

    test('filters out info and debug when AUTOPILOT_LOG_LEVEL=warn', () => {
      process.env.AUTOPILOT_LOG_LEVEL = 'warn';
      const logger = createLogger({});

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });

    test('only shows error when AUTOPILOT_LOG_LEVEL=error', () => {
      process.env.AUTOPILOT_LOG_LEVEL = 'error';
      const logger = createLogger({});

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('child logger', () => {
    test('creates child logger with merged context', () => {
      const parent = createLogger({ task_id: 'parent-task' });
      const child = parent.child({ plugin: 'child-plugin' });

      expect(child).toBeInstanceOf(AutopilotLogger);
      child.info('Child message');

      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain('task=parent-task');
      expect(loggedMessage).toContain('plugin=child-plugin');
    });

    test('child inherits parent minLevel', () => {
      process.env.AUTOPILOT_LOG_LEVEL = 'warn';
      const parent = createLogger({});
      const child = parent.child({ plugin: 'test' });

      child.info('Should not appear');
      child.warn('Should appear');

      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('setContext', () => {
    test('updates logger context', () => {
      const logger = createLogger({ task_id: 'initial' });
      logger.setContext({ plugin: 'new-plugin' });
      logger.info('Test');

      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain('task=initial');
      expect(loggedMessage).toContain('plugin=new-plugin');
    });

    test('merges with existing context', () => {
      const logger = createLogger({ task_id: 'task-1', plugin: 'plugin-1' });
      logger.setContext({ plugin: 'plugin-2', phase: 'test' });
      logger.info('Test');

      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain('task=task-1');
      expect(loggedMessage).toContain('plugin=plugin-2');
      expect(loggedMessage).toContain('phase=test');
    });
  });

  describe('error logging', () => {
    test('logs error with Error object', () => {
      const logger = createLogger({});
      const error = new Error('Test error');
      logger.error('Operation failed', error);

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.error.mock.calls[0][0];
      expect(loggedMessage).toContain('Operation failed');
    });

    test('logs error with string', () => {
      const logger = createLogger({});
      logger.error('Operation failed', 'String error message');

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });

    test('logs error without error object', () => {
      const logger = createLogger({});
      logger.error('Simple error');

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('time function', () => {
    test('logs duration when timer ends', async () => {
      const logger = createLogger({});
      const end = logger.time('Operation');

      // Small delay to ensure measurable duration
      await new Promise((resolve) => setTimeout(resolve, 10));
      end();

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain('Operation completed');
      expect(loggedMessage).toMatch(/duration=\d+ms/);
    });
  });

  describe('toJSON', () => {
    test('returns valid JSON string', () => {
      const logger = createLogger({ task_id: 'json-test' });
      const json = logger.toJSON('info', 'Test message', { extra: 'data' });

      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('level', 'info');
      expect(parsed).toHaveProperty('message', 'Test message');
      expect(parsed.context).toHaveProperty('task_id', 'json-test');
      expect(parsed).toHaveProperty('extra', 'data');
    });

    test('includes ISO timestamp', () => {
      const logger = createLogger({});
      const json = logger.toJSON('info', 'Test');
      const parsed = JSON.parse(json);

      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('edge cases', () => {
    test('handles empty message', () => {
      const logger = createLogger({});
      logger.info('');

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    });

    test('handles long message', () => {
      const logger = createLogger({});
      const longMessage = 'A'.repeat(10000);
      logger.info(longMessage);

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain(longMessage);
    });

    test('handles special characters in message', () => {
      const logger = createLogger({});
      const specialMessage = 'Test with special chars: 日本語 🚀 <script>alert("xss")</script> \n\t';
      logger.info(specialMessage);

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      expect(loggedMessage).toContain(specialMessage);
    });

    test('handles special characters in context', () => {
      const logger = createLogger({ task_id: 'task-with-特殊文字-🔥' });
      logger.info('Test');

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    });

    test('handles undefined meta', () => {
      const logger = createLogger({});
      logger.info('Test', undefined);

      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    });

    test('handles empty context', () => {
      const logger = createLogger({});
      logger.info('No context message');

      const loggedMessage = consoleSpy.info.mock.calls[0][0];
      // Should not have context braces if no context
      expect(loggedMessage).not.toMatch(/\{.*=.*\}/);
    });

    test('handles multiple rapid logs', () => {
      const logger = createLogger({});
      for (let i = 0; i < 100; i++) {
        logger.info(`Message ${i}`);
      }

      expect(consoleSpy.info).toHaveBeenCalledTimes(100);
    });

    test('handles invalid log level in environment gracefully', () => {
      process.env.AUTOPILOT_LOG_LEVEL = 'invalid_level';
      const logger = createLogger({});

      // Should fall back to default 'info' level
      logger.debug('Should not appear');
      logger.info('Should appear');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    });
  });
});
