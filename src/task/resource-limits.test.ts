// @ts-nocheck
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  checkFileCount,
  checkLineChanges,
  checkExecutionTime,
  checkAllLimits,
  type ResourceCheckResult,
  type ResourceCheckParams,
} from './resource-limits';

describe('checkFileCount', () => {
  test('0 files → pass', () => {
    const result = checkFileCount([], 10);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(0);
    expect(result.limit).toBe(10);
    expect(result.check).toBe('file_count');
    expect(result.violation).toBeUndefined();
  });

  test('below limit → pass', () => {
    const files = ['a.ts', 'b.ts', 'c.ts'];
    const result = checkFileCount(files, 10);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(3);
  });

  test('exactly at limit → pass', () => {
    const files = ['a.ts', 'b.ts', 'c.ts'];
    const result = checkFileCount(files, 3);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(3);
    expect(result.limit).toBe(3);
  });

  test('exceeds limit → fail with violation', () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];
    const result = checkFileCount(files, 3);
    expect(result.passed).toBe(false);
    expect(result.actual).toBe(5);
    expect(result.limit).toBe(3);
    expect(result.violation).toContain('Exceeded by 2 file(s)');
    expect(result.violation).toContain('a.ts');
    expect(result.violation).toContain('e.ts');
  });
});

describe('checkLineChanges', () => {
  test('empty diff → pass with 0 lines', () => {
    const result = checkLineChanges('', 500);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(0);
    expect(result.check).toBe('line_changes');
  });

  test('small diff → pass', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
-const d = 4;
`;
    const result = checkLineChanges(diff, 500);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(2); // 1 addition + 1 deletion
  });

  test('large diff → fail', () => {
    // Generate a diff with many changes
    const additions = Array(300).fill('+new line').join('\n');
    const deletions = Array(250).fill('-old line').join('\n');
    const diff = `--- a/file.ts
+++ b/file.ts
${additions}
${deletions}`;

    const result = checkLineChanges(diff, 500);
    expect(result.passed).toBe(false);
    expect(result.actual).toBe(550); // 300 + 250
    expect(result.violation).toContain('550 lines changed');
    expect(result.violation).toContain('300 added');
    expect(result.violation).toContain('250 deleted');
  });

  test('does not count +++ and --- headers', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-old
+new
--- another/ignored.ts
+++ another/ignored.ts
`;
    // Only -old and +new should be counted, not the header lines
    const result = checkLineChanges(diff, 500);
    expect(result.actual).toBe(2);
    expect(result.passed).toBe(true);
  });

  test('multi-file diff counts all changes', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
+line1
+line2
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
-removed1
-removed2
-removed3
`;
    const result = checkLineChanges(diff, 10);
    expect(result.actual).toBe(5); // 2 additions + 3 deletions
    expect(result.passed).toBe(true);
  });

  test('additions only (no deletions) → counts correctly', () => {
    const diff = `diff --git a/new-feature.ts b/new-feature.ts
--- /dev/null
+++ b/new-feature.ts
+export function newFeature() {
+  return 'hello';
+}
+export const VALUE = 42;
`;
    const result = checkLineChanges(diff, 500);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(4); // 4 additions, 0 deletions
    expect(result.check).toBe('line_changes');
  });
});

describe('checkExecutionTime', () => {
  test('just started → pass', () => {
    const startTime = Date.now();
    const result = checkExecutionTime(startTime, 900);
    expect(result.passed).toBe(true);
    expect(result.actual).toBeLessThanOrEqual(1);
    expect(result.check).toBe('execution_time');
  });

  test('within limit → pass', () => {
    const startTime = Date.now() - 60_000; // 60 seconds ago
    const result = checkExecutionTime(startTime, 900);
    expect(result.passed).toBe(true);
    expect(result.actual).toBeGreaterThanOrEqual(59);
    expect(result.actual).toBeLessThanOrEqual(61);
  });

  test('exceeds limit → fail', () => {
    const startTime = Date.now() - 1000_000; // 1000 seconds ago
    const result = checkExecutionTime(startTime, 900);
    expect(result.passed).toBe(false);
    expect(result.actual).toBeGreaterThanOrEqual(999);
    expect(result.violation).toContain('exceeded limit of 900s');
  });

  test('exactly at limit → pass', () => {
    const startTime = Date.now() - 900_000; // exactly 900 seconds ago
    const result = checkExecutionTime(startTime, 900);
    expect(result.passed).toBe(true);
    expect(result.actual).toBe(900);
  });
});

describe('checkAllLimits', () => {
  test('all checks pass', () => {
    const params: ResourceCheckParams = {
      changedFiles: ['a.ts', 'b.ts'],
      diffOutput: '+new line\n-old line',
      startTime: Date.now(),
      limits: {
        maxFiles: 10,
        maxLineChanges: 500,
        maxSeconds: 900,
      },
    };

    const results = checkAllLimits(params);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.passed)).toBe(true);

    expect(results[0].check).toBe('file_count');
    expect(results[1].check).toBe('line_changes');
    expect(results[2].check).toBe('execution_time');
  });

  test('one check fails', () => {
    const params: ResourceCheckParams = {
      changedFiles: Array(15).fill('file.ts'),
      diffOutput: '+new',
      startTime: Date.now(),
      limits: {
        maxFiles: 10,
        maxLineChanges: 500,
        maxSeconds: 900,
      },
    };

    const results = checkAllLimits(params);
    expect(results[0].passed).toBe(false); // file_count
    expect(results[1].passed).toBe(true);  // line_changes
    expect(results[2].passed).toBe(true);  // execution_time
  });

  test('all checks fail', () => {
    const largeLines = Array(600).fill('+line').join('\n');
    const params: ResourceCheckParams = {
      changedFiles: Array(15).fill('file.ts'),
      diffOutput: largeLines,
      startTime: Date.now() - 1000_000,
      limits: {
        maxFiles: 10,
        maxLineChanges: 500,
        maxSeconds: 900,
      },
    };

    const results = checkAllLimits(params);
    expect(results.every(r => !r.passed)).toBe(true);
    expect(results[0].violation).toContain('Exceeded by 5');
    expect(results[1].violation).toContain('600 lines');
    expect(results[2].violation).toContain('exceeded limit');
  });

  test('custom strict limits (maxFiles=1, maxLineChanges=10) enforced', () => {
    const params: ResourceCheckParams = {
      changedFiles: ['only-one.ts', 'second.ts'],
      diffOutput: Array(15).fill('+line').join('\n'),
      startTime: Date.now(),
      limits: {
        maxFiles: 1,
        maxLineChanges: 10,
        maxSeconds: 900,
      },
    };

    const results = checkAllLimits(params);
    expect(results).toHaveLength(3);

    // file_count: 2 files > 1 → fail
    expect(results[0].check).toBe('file_count');
    expect(results[0].passed).toBe(false);
    expect(results[0].actual).toBe(2);
    expect(results[0].limit).toBe(1);
    expect(results[0].violation).toContain('Exceeded by 1');

    // line_changes: 15 lines > 10 → fail
    expect(results[1].check).toBe('line_changes');
    expect(results[1].passed).toBe(false);
    expect(results[1].actual).toBe(15);
    expect(results[1].limit).toBe(10);

    // execution_time: just started → pass
    expect(results[2].check).toBe('execution_time');
    expect(results[2].passed).toBe(true);
  });
});
