/**
 * Unit tests for auto-review.ts
 */

import { mock, describe, test, expect, beforeEach, beforeAll } from 'bun:test';

// Global state for mocks - use object to maintain reference
const mockState = {
  fakeDiff: `src/foo.ts | 10 +++
---
+const x = 1;
-const x = 2;` + 'x'.repeat(50),
  geminiResponse: { content: 'LGTM', error: null as string | null },
  codexResponse: { content: 'LGTM', error: null as string | null },
};

// Mock ai-router
mock.module('../handlers/ai-router', () => ({
  callGeminiAPI: () => Promise.resolve({ ...mockState.geminiResponse }),
  callCodexCLI: () => Promise.resolve({ ...mockState.codexResponse }),
}));

// Mock promisify to return a function that returns our fake diff
mock.module('util', () => ({
  promisify: () => () => Promise.resolve({ stdout: mockState.fakeDiff, stderr: '' }),
}));

// Store imported functions - will be populated in beforeAll
let detectCodeChanges: (response: string) => boolean;
let autoReviewWithGemini: (response: string) => Promise<string | null>;

describe('auto-review', () => {
  beforeAll(async () => {
    // Dynamic import AFTER mock.module setup
    const mod = await import('../utils/auto-review');
    detectCodeChanges = mod.detectCodeChanges;
    autoReviewWithGemini = mod.autoReviewWithGemini;
  });

  beforeEach(() => {
    // Reset mock state
    mockState.fakeDiff = `src/foo.ts | 10 +++
---
+const x = 1;
-const x = 2;` + 'x'.repeat(50);
    mockState.geminiResponse = { content: 'LGTM', error: null };
    mockState.codexResponse = { content: 'LGTM', error: null };
  });

  describe('detectCodeChanges', () => {
    test('returns true for "Edit file foo.ts"', () => {
      expect(detectCodeChanges('Edit file foo.ts')).toBe(true);
    });

    test('returns true for messages containing triple-backtick typescript code blocks', () => {
      const message = `Here is some code:
\`\`\`typescript
const x = 1;
\`\`\``;
      expect(detectCodeChanges(message)).toBe(true);
    });

    test('returns false for plain text', () => {
      expect(detectCodeChanges('This is just plain text without any code changes')).toBe(false);
    });
  });

  describe('autoReviewWithGemini', () => {
    test('returns null when no code changes detected', async () => {
      const result = await autoReviewWithGemini('This is plain text');
      expect(result).toBeNull();
    });

    test('returns null when Gemini says LGTM', async () => {
      mockState.geminiResponse = { content: 'LGTM', error: null };
      const result = await autoReviewWithGemini('Edit file foo.ts');
      expect(result).toBeNull();
    });

    test('returns review string when Gemini finds issues', async () => {
      mockState.geminiResponse = { content: 'Bug: null check missing', error: null };
      const result = await autoReviewWithGemini('Edit file foo.ts');
      expect(result).toContain('Bug: null check missing');
      expect(result).toContain('💎 ジェミーレビュー');
    });

    test('handles Gemini errors gracefully', async () => {
      mockState.geminiResponse = { error: 'fail', content: '' };
      const result = await autoReviewWithGemini('Edit file foo.ts');
      expect(result).toBeNull();
    });

    test('includes Chappy review for large diffs', async () => {
      // Set large diff (1500+ chars)
      mockState.fakeDiff = `src/foo.ts | 100 ++++++
---
+const x = 1;
-const x = 2;` + 'x'.repeat(1500);

      // Mock Gemini to return an issue
      mockState.geminiResponse = { content: 'Security: SQL injection risk', error: null };

      // Mock Codex to return an issue
      mockState.codexResponse = { content: 'Logic: Missing error handling', error: null };

      const result = await autoReviewWithGemini('Edit file foo.ts');

      expect(result).not.toBeNull();
      expect(result).toContain('💎 ジェミーレビュー');
      expect(result).toContain('Security: SQL injection risk');
      expect(result).toContain('🧠 チャッピーレビュー');
      expect(result).toContain('Logic: Missing error handling');
    });
  });
});
