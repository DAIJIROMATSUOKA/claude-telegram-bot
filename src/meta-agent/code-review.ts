// Code Review Engine
// Analyzes src/ code to find duplicate code, inefficiencies, error handling gaps

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { ulid } from 'ulid';
import { getDb } from './db.js';
import { callClaudeCLI } from '../handlers/ai-router.js';
import type { CodeReviewSuggestion, MetaAgentLog } from './types.js';

const REVIEW_PROMPT = `You are a code reviewer analyzing a TypeScript file.

Identify issues in these categories:
1. **Duplicate Code**: Repeated logic that could be refactored
2. **Inefficiency**: Slow algorithms, unnecessary loops, blocking operations
3. **Error Handling**: Missing try-catch, uncaught promises, unhandled edge cases
4. **Security**: Potential vulnerabilities (SQL injection, XSS, etc.)
5. **Maintainability**: Complex functions, poor naming, missing comments

For each issue, provide:
- issue_type (e.g., 'duplicate_code', 'inefficiency', 'error_handling')
- severity ('low', 'medium', 'high', 'critical')
- line_number (approximate)
- description (concise explanation)
- suggested_fix (optional code snippet)

Return JSON array:
[
  {
    "issue_type": "error_handling",
    "severity": "high",
    "line_number": 42,
    "description": "Async function without try-catch",
    "suggested_fix": "Wrap with try-catch block"
  }
]

File to review:
\`\`\`typescript
{{FILE_CONTENT}}
\`\`\`

Return ONLY the JSON array, no other text.`;

/**
 * Perform code review on all files in src/
 */
export async function performCodeReview(srcDir: string = './src'): Promise<CodeReviewSuggestion[]> {
  const db = getDb();
  const startTime = Date.now();

  // Log start
  const logId = ulid();
  db.prepare(`
    INSERT INTO meta_agent_log (log_id, action_type, action_status, started_at)
    VALUES (?, 'code_review', 'started', datetime('now'))
  `).run(logId);

  try {
    // Get all TypeScript files in src/ (excluding tests, node_modules)
    const files = getAllTypeScriptFiles(srcDir).filter((file) => {
      const relativePath = relative(srcDir, file);
      return (
        !relativePath.includes('node_modules') &&
        !relativePath.includes('.test.') &&
        !relativePath.includes('tests/')
      );
    });

    console.log(`🔍 Reviewing ${files.length} files...`);

    const allSuggestions: CodeReviewSuggestion[] = [];

    for (const filePath of files) {
      const relativePath = relative(process.cwd(), filePath);
      console.log(`   Reviewing: ${relativePath}`);

      try {
        const suggestions = await reviewFile(filePath, relativePath);
        allSuggestions.push(...suggestions);
      } catch (error) {
        console.error(`   ⚠️  Failed to review ${relativePath}:`, error);
      }
    }

    // Update log
    const duration = Date.now() - startTime;
    db.prepare(`
      UPDATE meta_agent_log
      SET action_status = 'completed', completed_at = datetime('now'), duration_ms = ?, result_summary = ?
      WHERE log_id = ?
    `).run(duration, `Code review complete: ${allSuggestions.length} suggestions`, logId);

    console.log(`✅ Code review complete: ${allSuggestions.length} suggestions`);
    return allSuggestions;
  } catch (error) {
    // Log failure
    db.prepare(`
      UPDATE meta_agent_log
      SET action_status = 'failed', completed_at = datetime('now'), error_message = ?
      WHERE log_id = ?
    `).run(error instanceof Error ? error.message : String(error), logId);

    throw error;
  }
}

/**
 * Review a single file using Claude CLI
 */
async function reviewFile(filePath: string, relativePath: string): Promise<CodeReviewSuggestion[]> {
  const db = getDb();
  const fileContent = readFileSync(filePath, 'utf-8');

  // Skip very large files (>50KB)
  if (fileContent.length > 50_000) {
    console.log(`   ⚠️  Skipping large file: ${relativePath}`);
    return [];
  }

  const prompt = REVIEW_PROMPT.replace('{{FILE_CONTENT}}', fileContent);

  try {
    // Call Claude CLI for code review
    const response = await callClaudeCLI(prompt, {
      conversationName: `code-review-${Date.now()}`,
      maxTokens: 4096,
    });

    // Parse JSON response
    let issues: any[] = [];
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        issues = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.warn(`   ⚠️  Failed to parse JSON from response: ${relativePath}`);
      return [];
    }

    // Convert to CodeReviewSuggestion objects
    const suggestions: CodeReviewSuggestion[] = issues.map((issue) => {
      const suggestionId = ulid();
      const suggestion: CodeReviewSuggestion = {
        suggestion_id: suggestionId,
        file_path: relativePath,
        line_number: issue.line_number || null,
        issue_type: issue.issue_type || 'unknown',
        severity: issue.severity || 'medium',
        description: issue.description || 'No description',
        suggested_fix: issue.suggested_fix || null,
        status: 'pending',
        reviewed_at: new Date().toISOString(),
        metadata: JSON.stringify({ source: 'claude-cli' }),
      };

      // Save to DB
      db.prepare(`
        INSERT INTO code_review_suggestions
        (suggestion_id, file_path, line_number, issue_type, severity, description, suggested_fix, status, reviewed_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        suggestion.suggestion_id,
        suggestion.file_path,
        suggestion.line_number,
        suggestion.issue_type,
        suggestion.severity,
        suggestion.description,
        suggestion.suggested_fix,
        suggestion.status,
        suggestion.reviewed_at,
        suggestion.metadata
      );

      return suggestion;
    });

    return suggestions;
  } catch (error) {
    console.error(`   ⚠️  Error reviewing file: ${relativePath}`, error);
    return [];
  }
}

/**
 * Get all TypeScript files recursively
 */
function getAllTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Get pending suggestions (not yet reviewed by user)
 */
export function getPendingSuggestions(): CodeReviewSuggestion[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM code_review_suggestions
    WHERE status = 'pending'
    ORDER BY severity DESC, reviewed_at DESC
  `).all() as CodeReviewSuggestion[];
}

/**
 * Update suggestion status
 */
export function updateSuggestionStatus(
  suggestionId: string,
  status: 'approved' | 'rejected' | 'applied',
  userFeedback?: string
) {
  const db = getDb();
  db.prepare(`
    UPDATE code_review_suggestions
    SET status = ?, user_feedback = ?, resolved_at = datetime('now')
    WHERE suggestion_id = ?
  `).run(status, userFeedback || null, suggestionId);
}
