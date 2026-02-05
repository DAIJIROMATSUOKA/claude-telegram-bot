/**
 * Redaction Filter Test Suite
 * Phase B: S0-S1 - Safe Render + Redaction
 */

import { describe, test, expect } from 'bun:test';
import {
  redactSensitiveData,
  redactJSON,
  isSensitiveKey,
  redactObjectKeys,
} from '../utils/redaction-filter.js';

describe('Redaction Filter', () => {
  // ==========================================================================
  // API Key Redaction
  // ==========================================================================

  test('should redact OpenAI API key', () => {
    const input = 'My key is sk-1234567890abcdefghij for testing';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[OPENAI_KEY]');
    expect(result.sanitized).not.toContain('sk-1234567890abcdefghij');
    expect(result.redactionCount).toBe(1);
    expect(result.redactedPatterns).toContain('OpenAI_API_Key');
  });

  test('should redact Anthropic API key', () => {
    const input = 'Using sk-ant-1234567890abcdefghij-xyz for Claude';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[ANTHROPIC_KEY]');
    expect(result.sanitized).not.toContain('sk-ant-');
    expect(result.redactionCount).toBe(1);
    expect(result.redactedPatterns).toContain('Anthropic_API_Key');
  });

  test('should redact Google API key', () => {
    const input = 'Google key: AIzaSyD1234567890abcdefghijklmnopqrstuvwxyz';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[GOOGLE_KEY]');
    expect(result.sanitized).not.toContain('AIza');
    expect(result.redactionCount).toBe(1);
    expect(result.redactedPatterns).toContain('Google_API_Key');
  });

  test('should redact GitHub token', () => {
    const input = 'Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[GITHUB_TOKEN]');
    expect(result.sanitized).not.toContain('ghp_');
    expect(result.redactionCount).toBe(1);
    expect(result.redactedPatterns).toContain('GitHub_Token');
  });

  test('should redact Slack token', () => {
    const input = 'Slack: xoxb-1234567890-1234567890-123456789012345678901234';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[SLACK_TOKEN]');
    expect(result.sanitized).not.toContain('xoxb-');
    expect(result.redactionCount).toBe(1);
    expect(result.redactedPatterns).toContain('Slack_Token');
  });

  test('should redact Bearer token', () => {
    const input = 'Authorization: Bearer abc123def456ghi789jkl012mno345';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('Bearer [REDACTED]');
    expect(result.sanitized).not.toContain('abc123def456');
    expect(result.redactionCount).toBe(1);
    expect(result.redactedPatterns).toContain('Bearer_Token');
  });

  test('should redact JWT token', () => {
    const input = 'JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[JWT_TOKEN]');
    expect(result.sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(result.redactionCount).toBe(1);
    expect(result.redactedPatterns).toContain('JWT_Token');
  });

  // ==========================================================================
  // Personal Information Redaction
  // ==========================================================================

  test('should redact email addresses', () => {
    const input = 'Contact: john.doe@example.com or support@company.co.jp';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[EMAIL]');
    expect(result.sanitized).not.toContain('john.doe@example.com');
    expect(result.sanitized).not.toContain('support@company.co.jp');
    expect(result.redactionCount).toBe(2);
    expect(result.redactedPatterns).toContain('Email');
  });

  test('should redact Japanese phone numbers', () => {
    const input = 'Call: 03-1234-5678 or 080-1234-5678';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[PHONE]');
    expect(result.sanitized).not.toContain('03-1234-5678');
    expect(result.sanitized).not.toContain('080-1234-5678');
    expect(result.redactionCount).toBe(2);
    expect(result.redactedPatterns).toContain('Phone_JP');
  });

  test('should redact international phone numbers', () => {
    const input = 'Phone: +81-80-1234-5678';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[PHONE]');
    expect(result.sanitized).not.toContain('+81-80-1234-5678');
    expect(result.redactionCount).toBeGreaterThanOrEqual(1);
  });

  test('should redact credit card numbers', () => {
    const input = 'Card: 1234-5678-9012-3456';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[CARD_NUMBER]');
    expect(result.sanitized).not.toContain('1234-5678-9012-3456');
    expect(result.redactionCount).toBe(1);
    expect(result.redactedPatterns).toContain('Credit_Card');
  });

  // ==========================================================================
  // URL Redaction
  // ==========================================================================

  test('should keep allowed domain URLs', () => {
    const input = 'Check https://github.com/user/repo';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('https://github.com/user/repo');
    expect(result.redactionCount).toBe(0);
  });

  test('should redact external URLs', () => {
    const input = 'Visit https://malicious-site.com/path';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[EXTERNAL_URL]');
    expect(result.sanitized).not.toContain('malicious-site.com');
    expect(result.redactionCount).toBe(1);
    expect(result.redactedPatterns).toContain('URL');
  });

  test('should handle mixed URLs', () => {
    const input = 'Safe: https://docs.google.com/doc and unsafe: https://bad.example.com';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('https://docs.google.com/doc');
    expect(result.sanitized).toContain('[EXTERNAL_URL]');
    expect(result.sanitized).not.toContain('bad.example.com');
  });

  // ==========================================================================
  // JSON Redaction
  // ==========================================================================

  test('should redact JSON with sensitive data', () => {
    const obj = {
      username: 'john',
      apiKey: 'sk-1234567890abcdefghij',
      email: 'john@example.com',
    };
    const result = redactJSON(obj);

    expect(result.apiKey).toBe('[OPENAI_KEY]');
    expect(result.email).toBe('[EMAIL]');
    expect(result.username).toBe('john');
  });

  // ==========================================================================
  // Object Key Redaction
  // ==========================================================================

  test('should identify sensitive keys', () => {
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('apiKey')).toBe(true);
    expect(isSensitiveKey('secret_token')).toBe(true);
    expect(isSensitiveKey('access_token')).toBe(true);
    expect(isSensitiveKey('username')).toBe(false);
    expect(isSensitiveKey('userId')).toBe(false);
  });

  test('should redact object with sensitive keys', () => {
    const obj = {
      username: 'john',
      password: 'secret123',
      apiKey: 'sk-123',
      email: 'john@example.com',
    };
    const result = redactObjectKeys(obj);

    expect(result.username).toBe('john');
    expect(result.password).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.email).toBe('john@example.com');
  });

  test('should redact nested objects', () => {
    const obj = {
      user: {
        name: 'john',
        password: 'secret',
        apiToken: 'abc123',
      },
    };
    const result = redactObjectKeys(obj);

    expect(result.user).toBeDefined();
    expect(result.user.name).toBe('john');
    expect(result.user.password).toBe('[REDACTED]');
    expect(result.user.apiToken).toBe('[REDACTED]');
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  test('should handle empty string', () => {
    const result = redactSensitiveData('');
    expect(result.sanitized).toBe('');
    expect(result.redactionCount).toBe(0);
  });

  test('should handle text with no sensitive data', () => {
    const input = 'This is a normal message with no secrets';
    const result = redactSensitiveData(input);
    expect(result.sanitized).toBe(input);
    expect(result.redactionCount).toBe(0);
  });

  test('should handle multiple patterns in one string', () => {
    const input = 'API key sk-1234567890abcdefghijklmnopqr, email test@example.com, phone 080-1234-5678';
    const result = redactSensitiveData(input);

    expect(result.sanitized).toContain('[OPENAI_KEY]');
    expect(result.sanitized).toContain('[EMAIL]');
    expect(result.sanitized).toContain('[PHONE]');
    expect(result.redactionCount).toBe(3);
    expect(result.redactedPatterns.length).toBeGreaterThanOrEqual(3);
  });

  // ==========================================================================
  // Preserve Length Option
  // ==========================================================================

  test('should preserve length when option is enabled', () => {
    const input = 'Key: sk-1234567890abcdefghij';
    const result = redactSensitiveData(input, { preserveLength: true });

    const originalKeyLength = 'sk-1234567890abcdefghij'.length;
    const maskedKey = result.sanitized.match(/\*+/)?.[0];
    expect(maskedKey?.length).toBe(originalKeyLength);
  });
});

describe('Redaction Filter - Summary', () => {
  test('Phase B acceptance criteria', () => {
    // ✅ Secrets masked (using realistic lengths)
    const secretTest = redactSensitiveData(
      'sk-1234567890abcdefghijklmnopqr, xoxb-1234567890-1234567890-123456789012345678901234, AIzaSyD1234567890abcdefghijklmnopqrstuvwxyz, ghp_1234567890abcdefghijklmnopqrstuvwxyz'
    );
    expect(secretTest.redactionCount).toBeGreaterThanOrEqual(4);

    // ✅ Email/Phone masked
    const piiTest = redactSensitiveData('test@example.com, 080-1234-5678');
    expect(piiTest.redactionCount).toBeGreaterThanOrEqual(2);

    // ✅ Allowed URLs preserved
    const urlTest = redactSensitiveData('https://github.com/user/repo');
    expect(urlTest.sanitized).toContain('github.com');

    // ✅ External URLs redacted
    const externalTest = redactSensitiveData('https://malicious.com/path');
    expect(externalTest.sanitized).toContain('[EXTERNAL_URL]');

    console.log('✅ Phase B: Redaction Filter - All tests passed');
  });
});
