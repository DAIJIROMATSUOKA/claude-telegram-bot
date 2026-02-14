/**
 * Resource Limits Checker for Task Orchestrator (Phase 2a)
 *
 * Pure functions for validating task execution stays within resource bounds.
 * No external dependencies - only Date.now() for time checks.
 */

// === Types ===

export interface ResourceCheckResult {
  check: 'file_count' | 'line_changes' | 'execution_time';
  passed: boolean;
  actual: number;
  limit: number;
  violation?: string;
}

export interface ResourceCheckParams {
  changedFiles: string[];
  diffOutput: string;
  startTime: number;
  limits: {
    maxFiles: number;        // default 10
    maxLineChanges: number;  // default 500
    maxSeconds: number;      // default 900
  };
}

// === Functions ===

/**
 * Check if changed file count is within limit
 */
export function checkFileCount(
  changedFiles: string[],
  maxFiles: number
): ResourceCheckResult {
  const actual = changedFiles.length;
  const passed = actual <= maxFiles;

  const result: ResourceCheckResult = {
    check: 'file_count',
    passed,
    actual,
    limit: maxFiles,
  };

  if (!passed) {
    const excess = actual - maxFiles;
    result.violation = `Exceeded by ${excess} file(s): ${changedFiles.join(', ')}`;
  }

  return result;
}

/**
 * Parse unified diff output and count added + deleted lines
 * Lines starting with '+' (excluding '+++') are additions
 * Lines starting with '-' (excluding '---') are deletions
 */
export function checkLineChanges(
  diffOutput: string,
  maxLines: number
): ResourceCheckResult {
  const lines = diffOutput.split('\n');
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      // File header lines, skip
      continue;
    }
    if (line.startsWith('+')) {
      additions++;
    } else if (line.startsWith('-')) {
      deletions++;
    }
  }

  const actual = additions + deletions;
  const passed = actual <= maxLines;

  const result: ResourceCheckResult = {
    check: 'line_changes',
    passed,
    actual,
    limit: maxLines,
  };

  if (!passed) {
    result.violation = `${actual} lines changed (${additions} added, ${deletions} deleted), limit is ${maxLines}`;
  }

  return result;
}

/**
 * Check if execution time is within limit
 */
export function checkExecutionTime(
  startTime: number,
  maxSeconds: number
): ResourceCheckResult {
  const elapsedMs = Date.now() - startTime;
  const actual = Math.floor(elapsedMs / 1000);
  const passed = elapsedMs <= maxSeconds * 1000;

  const result: ResourceCheckResult = {
    check: 'execution_time',
    passed,
    actual,
    limit: maxSeconds,
  };

  if (!passed) {
    result.violation = `Execution time ${actual}s exceeded limit of ${maxSeconds}s`;
  }

  return result;
}

/**
 * Run all resource checks and return results array
 */
export function checkAllLimits(params: ResourceCheckParams): ResourceCheckResult[] {
  const { changedFiles, diffOutput, startTime, limits } = params;

  return [
    checkFileCount(changedFiles, limits.maxFiles),
    checkLineChanges(diffOutput, limits.maxLineChanges),
    checkExecutionTime(startTime, limits.maxSeconds),
  ];
}
