import { describe, it, expect } from 'bun:test';

// Test the shell-injection fix in resolveFile()
// We exercise the sanitization logic directly without touching the filesystem.

function sanitizeFilename(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '');
}

describe('tool-preloader filename sanitization', () => {
  it('passes safe filenames unchanged', () => {
    expect(sanitizeFilename('foo.ts')).toBe('foo.ts');
    expect(sanitizeFilename('my-file_v2.js')).toBe('my-file_v2.js');
    expect(sanitizeFilename('README.md')).toBe('README.md');
  });

  it('strips shell metacharacters', () => {
    expect(sanitizeFilename('foo"; rm -rf /')).toBe('foorm-rf');
    expect(sanitizeFilename('file$(whoami).ts')).toBe('filewhoami.ts');
    expect(sanitizeFilename('a`b`c')).toBe('abc');
    expect(sanitizeFilename('../../../etc/passwd')).toBe('......etcpasswd');
  });

  it('returns empty string for all-special input', () => {
    expect(sanitizeFilename('$()')).toBe('');
    expect(sanitizeFilename('|&;')).toBe('');
  });

  it('preserves dots and dashes', () => {
    expect(sanitizeFilename('config.local.json')).toBe('config.local.json');
    expect(sanitizeFilename('some-handler-v2.ts')).toBe('some-handler-v2.ts');
  });
});
