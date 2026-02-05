/**
 * Tool Pre-Loader
 *
 * work_modeに応じて次の操作を予測し、文脈に含める情報を事前取得
 *
 * Modes:
 * - debugging → ログファイルのパスを先に取得
 * - planning → 関連ドキュメントのリストを先に取得
 * - coding → 最近編集したファイルを先に取得
 * - research → READMEやドキュメントの概要を取得
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { WorkMode } from './context-detector';

export interface PreloadedContext {
  mode: WorkMode;
  suggestions: string[];
  paths: string[];
  summary: string;
}

/**
 * Preload context based on work mode
 */
export function preloadToolContext(mode: WorkMode, workingDir: string): PreloadedContext {
  const result: PreloadedContext = {
    mode,
    suggestions: [],
    paths: [],
    summary: '',
  };

  try {
    switch (mode) {
      case 'debugging':
        result.summary = preloadDebuggingContext(workingDir, result);
        break;

      case 'planning':
        result.summary = preloadPlanningContext(workingDir, result);
        break;

      case 'coding':
        result.summary = preloadCodingContext(workingDir, result);
        break;

      case 'research':
        result.summary = preloadResearchContext(workingDir, result);
        break;

      case 'urgent':
        result.summary = preloadUrgentContext(workingDir, result);
        break;

      default:
        result.summary = 'No preloaded context';
    }
  } catch (error) {
    console.error('[Tool Preloader] Error:', error);
    result.summary = 'Preload failed';
  }

  return result;
}

/**
 * Preload debugging context (logs, error files, test results)
 */
function preloadDebuggingContext(workingDir: string, result: PreloadedContext): string {
  const suggestions: string[] = [];
  const paths: string[] = [];

  // Find log files
  try {
    const logFiles = execSync(
      `find "${workingDir}" -name "*.log" -o -name "stderr.txt" -o -name "stdout.txt" | head -10`,
      { encoding: 'utf-8', timeout: 2000 }
    )
      .trim()
      .split('\n')
      .filter(Boolean);

    if (logFiles.length > 0) {
      paths.push(...logFiles);
      suggestions.push(`Found ${logFiles.length} log files`);
    }
  } catch {}

  // Find test result files
  try {
    const testFiles = execSync(
      `find "${workingDir}" -name "test-results*" -o -name "*.test.log" | head -5`,
      { encoding: 'utf-8', timeout: 2000 }
    )
      .trim()
      .split('\n')
      .filter(Boolean);

    if (testFiles.length > 0) {
      paths.push(...testFiles);
      suggestions.push(`Found ${testFiles.length} test result files`);
    }
  } catch {}

  // Check for common error indicators
  const errorIndicators = ['.bot.pid', 'error.log', 'crash.log'];
  for (const indicator of errorIndicators) {
    const path = join(workingDir, indicator);
    if (existsSync(path)) {
      paths.push(path);
      suggestions.push(`Found ${indicator}`);
    }
  }

  result.suggestions = suggestions;
  result.paths = paths;

  return suggestions.length > 0
    ? `🐛 Debugging context:\n${suggestions.join('\n')}`
    : '🐛 No debug artifacts found';
}

/**
 * Preload planning context (docs, architecture files, roadmaps)
 */
function preloadPlanningContext(workingDir: string, result: PreloadedContext): string {
  const suggestions: string[] = [];
  const paths: string[] = [];

  // Find documentation files
  const docPatterns = ['*.md', 'ARCHITECTURE*', 'ROADMAP*', 'DESIGN*', 'docs/**/*.md'];

  for (const pattern of docPatterns) {
    try {
      const files = execSync(`find "${workingDir}" -name "${pattern}" | head -5`, {
        encoding: 'utf-8',
        timeout: 2000,
      })
        .trim()
        .split('\n')
        .filter(Boolean);

      if (files.length > 0) {
        paths.push(...files);
      }
    } catch {}
  }

  if (paths.length > 0) {
    suggestions.push(`Found ${paths.length} documentation files`);
  }

  // Check for specific planning docs
  const planningDocs = ['CLAUDE.md', 'AGENTS.md', 'README.md', 'TODO.md'];
  for (const doc of planningDocs) {
    const path = join(workingDir, doc);
    if (existsSync(path)) {
      paths.push(path);
      suggestions.push(`Found ${doc}`);
    }
  }

  result.suggestions = suggestions;
  result.paths = paths;

  return suggestions.length > 0
    ? `📋 Planning context:\n${suggestions.join('\n')}`
    : '📋 No planning docs found';
}

/**
 * Preload coding context (recently modified files, git status)
 */
function preloadCodingContext(workingDir: string, result: PreloadedContext): string {
  const suggestions: string[] = [];
  const paths: string[] = [];

  // Get recently modified files (last 24 hours)
  try {
    const recentFiles = execSync(`find "${workingDir}" -name "*.ts" -o -name "*.js" -mtime -1 | head -10`, {
      encoding: 'utf-8',
      timeout: 2000,
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    if (recentFiles.length > 0) {
      paths.push(...recentFiles);
      suggestions.push(`${recentFiles.length} files modified recently`);
    }
  } catch {}

  // Get git status
  try {
    const gitStatus = execSync('git status --short', {
      cwd: workingDir,
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();

    if (gitStatus) {
      const modifiedCount = gitStatus.split('\n').length;
      suggestions.push(`${modifiedCount} files with uncommitted changes`);
    }
  } catch {}

  result.suggestions = suggestions;
  result.paths = paths;

  return suggestions.length > 0
    ? `💻 Coding context:\n${suggestions.join('\n')}`
    : '💻 No recent code changes';
}

/**
 * Preload research context (README, docs, package.json)
 */
function preloadResearchContext(workingDir: string, result: PreloadedContext): string {
  const suggestions: string[] = [];
  const paths: string[] = [];

  // Find README
  const readmeFiles = ['README.md', 'README.txt', 'README'];
  for (const readme of readmeFiles) {
    const path = join(workingDir, readme);
    if (existsSync(path)) {
      paths.push(path);
      suggestions.push(`Found ${readme}`);
      break;
    }
  }

  // Find package.json / dependencies info
  const packageJson = join(workingDir, 'package.json');
  if (existsSync(packageJson)) {
    paths.push(packageJson);
    suggestions.push('Found package.json');
  }

  // Find docs directory
  const docsDir = join(workingDir, 'docs');
  if (existsSync(docsDir)) {
    try {
      const docFiles = readdirSync(docsDir).filter((f) => f.endsWith('.md'));
      if (docFiles.length > 0) {
        paths.push(docsDir);
        suggestions.push(`Found ${docFiles.length} docs in /docs`);
      }
    } catch {}
  }

  result.suggestions = suggestions;
  result.paths = paths;

  return suggestions.length > 0
    ? `🔍 Research context:\n${suggestions.join('\n')}`
    : '🔍 No documentation found';
}

/**
 * Preload urgent context (errors, logs, git diff)
 */
function preloadUrgentContext(workingDir: string, result: PreloadedContext): string {
  const suggestions: string[] = [];
  const paths: string[] = [];

  // Get recent error logs
  try {
    const errorLogs = execSync(`find "${workingDir}" -name "*.log" -mmin -30 | head -5`, {
      encoding: 'utf-8',
      timeout: 2000,
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    if (errorLogs.length > 0) {
      paths.push(...errorLogs);
      suggestions.push(`${errorLogs.length} recent error logs`);
    }
  } catch {}

  // Get git diff (uncommitted changes)
  try {
    const gitDiff = execSync('git diff --stat', {
      cwd: workingDir,
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();

    if (gitDiff) {
      suggestions.push('Uncommitted changes detected');
    }
  } catch {}

  // Check for .bot.pid (running process)
  const pidFile = join(workingDir, '.bot.pid');
  if (existsSync(pidFile)) {
    paths.push(pidFile);
    suggestions.push('Bot process running');
  }

  result.suggestions = suggestions;
  result.paths = paths;

  return suggestions.length > 0
    ? `🚨 Urgent context:\n${suggestions.join('\n')}`
    : '🚨 No urgent issues detected';
}

/**
 * Format preloaded context for prompt injection
 */
export function formatPreloadedContext(context: PreloadedContext): string {
  if (!context.suggestions.length && !context.paths.length) {
    return '';
  }

  let formatted = `\n### Preloaded Context (${context.mode})\n`;
  formatted += context.summary + '\n';

  if (context.paths.length > 0) {
    formatted += `\n関連ファイル:\n`;
    for (const path of context.paths.slice(0, 5)) {
      formatted += `- ${path}\n`;
    }
    if (context.paths.length > 5) {
      formatted += `... 他${context.paths.length - 5}件\n`;
    }
  }

  return formatted;
}
