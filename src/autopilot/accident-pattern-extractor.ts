/**
 * Accident Pattern Extractor - Phase 3: Autopilot CI
 *
 * Purpose: Extract accident patterns from Telegram conversation logs
 * Converts past incidents into structured accident patterns for Golden Test generation
 *
 * Sources:
 * - Telegram conversation logs (error messages, user reports)
 * - Memory Gateway (past incidents, rollback events)
 * - Policy Engine violations (near-misses)
 */

import type { AccidentPattern } from './golden-test-types';

export interface ConversationLog {
  message_id: number;
  chat_id: number;
  user_message: string;
  bot_response: string;
  timestamp: string;
  contained_error: boolean;
  error_keywords?: string[];
}

export interface AccidentIndicators {
  error_keywords: string[];
  rollback_keywords: string[];
  severity_keywords: {
    critical: string[];
    high: string[];
    medium: string[];
    low: string[];
  };
  blast_radius_keywords: {
    system: string[];
    project: string[];
    directory: string[];
    file: string[];
  };
}

export class AccidentPatternExtractor {
  private readonly MEMORY_GATEWAY_URL: string;

  // Accident indicators (keywords that suggest an incident occurred)
  private indicators: AccidentIndicators = {
    error_keywords: [
      'error',
      'failed',
      'crash',
      'exception',
      'unexpected',
      'wrong',
      'deleted',
      'lost',
      'corrupted',
      'overwritten',
      '事故',
      '失敗',
      'エラー',
      '問題',
    ],
    rollback_keywords: [
      'rollback',
      'undo',
      'revert',
      'restore',
      'recover',
      '戻す',
      '復元',
      '取り消し',
    ],
    severity_keywords: {
      critical: [
        'data loss',
        'production down',
        'security breach',
        'データ消失',
        '本番停止',
      ],
      high: [
        'broken',
        'not working',
        'serious',
        '壊れた',
        '動かない',
        '深刻',
      ],
      medium: [
        'issue',
        'problem',
        'incorrect',
        '問題',
        '不正',
      ],
      low: [
        'minor',
        'cosmetic',
        'typo',
        '軽微',
        'タイポ',
      ],
    },
    blast_radius_keywords: {
      system: [
        'entire system',
        'all users',
        'global',
        'システム全体',
        '全ユーザー',
      ],
      project: [
        'whole project',
        'entire codebase',
        'プロジェクト全体',
        'コードベース全体',
      ],
      directory: [
        'directory',
        'folder',
        'multiple files',
        'ディレクトリ',
        '複数ファイル',
      ],
      file: [
        'single file',
        'one file',
        '1ファイル',
        '単一ファイル',
      ],
    },
  };

  constructor(memoryGatewayUrl: string) {
    this.MEMORY_GATEWAY_URL = memoryGatewayUrl;
  }

  /**
   * Extract accident patterns from conversation logs
   */
  async extractFromConversationLogs(
    logs: ConversationLog[]
  ): Promise<AccidentPattern[]> {
    console.log(`[AccidentPatternExtractor] Analyzing ${logs.length} conversation logs`);

    const patterns: AccidentPattern[] = [];

    for (const log of logs) {
      // Check if log contains accident indicators
      if (!this.containsAccidentIndicators(log)) {
        continue;
      }

      // Extract pattern from log
      const pattern = await this.extractPattern(log);
      if (pattern) {
        patterns.push(pattern);
      }
    }

    // Deduplicate and merge similar patterns
    const deduplicated = this.deduplicatePatterns(patterns);

    console.log(
      `[AccidentPatternExtractor] Extracted ${deduplicated.length} unique accident patterns`
    );

    return deduplicated;
  }

  /**
   * Extract accident patterns from Memory Gateway (past incidents)
   */
  async extractFromMemoryGateway(): Promise<AccidentPattern[]> {
    console.log('[AccidentPatternExtractor] Querying Memory Gateway for past incidents');

    try {
      // Query for incidents, errors, rollbacks
      const response = await fetch(
        `${this.MEMORY_GATEWAY_URL}/v1/memory/query?` +
          `tags=error,incident,rollback,accident&` +
          `limit=100`
      );

      if (!response.ok) {
        console.error('[AccidentPatternExtractor] Failed to query Memory Gateway');
        return [];
      }

      const data = await response.json();
      const items = data.items || [];

      console.log(`[AccidentPatternExtractor] Found ${items.length} incident records`);

      const patterns: AccidentPattern[] = [];

      for (const item of items) {
        const pattern = this.parseIncidentRecord(item);
        if (pattern) {
          patterns.push(pattern);
        }
      }

      return patterns;
    } catch (error) {
      console.error('[AccidentPatternExtractor] Error querying Memory Gateway:', error);
      return [];
    }
  }

  /**
   * Check if conversation log contains accident indicators
   */
  private containsAccidentIndicators(log: ConversationLog): boolean {
    const text = `${log.user_message} ${log.bot_response}`.toLowerCase();

    // Check for error keywords
    for (const keyword of this.indicators.error_keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return true;
      }
    }

    // Check for rollback keywords
    for (const keyword of this.indicators.rollback_keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract accident pattern from single conversation log
   */
  private async extractPattern(log: ConversationLog): Promise<AccidentPattern | null> {
    const text = `${log.user_message} ${log.bot_response}`;

    // Determine severity
    const severity = this.determineSeverity(text);

    // Determine blast radius
    const blastRadius = this.determineBlastRadius(text);

    // Extract title (first sentence of user message)
    const title = this.extractTitle(log.user_message);

    // Extract description
    const description = this.extractDescription(text);

    // Extract root cause
    const rootCause = this.extractRootCause(text);

    // Extract trigger conditions
    const triggerConditions = this.extractTriggerConditions(text);

    const pattern: AccidentPattern = {
      pattern_id: `pattern_${log.message_id}_${Date.now()}`,
      title,
      description,
      severity,
      blast_radius: blastRadius,
      first_occurred_at: log.timestamp,
      last_occurred_at: log.timestamp,
      occurrence_count: 1,
      root_cause: rootCause,
      trigger_conditions: triggerConditions,
      conversation_ids: [log.message_id.toString()],
      extracted_from: 'telegram_log',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return pattern;
  }

  /**
   * Determine severity from text
   */
  private determineSeverity(
    text: string
  ): 'low' | 'medium' | 'high' | 'critical' {
    const lowerText = text.toLowerCase();

    // Check critical keywords
    for (const keyword of this.indicators.severity_keywords.critical) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'critical';
      }
    }

    // Check high keywords
    for (const keyword of this.indicators.severity_keywords.high) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'high';
      }
    }

    // Check medium keywords
    for (const keyword of this.indicators.severity_keywords.medium) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'medium';
      }
    }

    // Default to medium (conservative)
    return 'medium';
  }

  /**
   * Determine blast radius from text
   */
  private determineBlastRadius(
    text: string
  ): 'file' | 'directory' | 'project' | 'system' {
    const lowerText = text.toLowerCase();

    // Check system keywords
    for (const keyword of this.indicators.blast_radius_keywords.system) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'system';
      }
    }

    // Check project keywords
    for (const keyword of this.indicators.blast_radius_keywords.project) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'project';
      }
    }

    // Check directory keywords
    for (const keyword of this.indicators.blast_radius_keywords.directory) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'directory';
      }
    }

    // Default to directory (conservative)
    return 'directory';
  }

  /**
   * Extract title from user message
   */
  private extractTitle(message: string): string {
    // Get first sentence (up to first period, exclamation, or question mark)
    const match = message.match(/^[^.!?]+[.!?]/);
    if (match) {
      return match[0].trim();
    }

    // If no sentence end, take first 50 characters
    return message.substring(0, 50).trim() + (message.length > 50 ? '...' : '');
  }

  /**
   * Extract description from text
   */
  private extractDescription(text: string): string {
    // Take first 200 characters as description
    return text.substring(0, 200).trim() + (text.length > 200 ? '...' : '');
  }

  /**
   * Extract root cause from text
   */
  private extractRootCause(text: string): string {
    // Look for common root cause patterns
    const patterns = [
      /because (.+?)[\.\n]/i,
      /due to (.+?)[\.\n]/i,
      /caused by (.+?)[\.\n]/i,
      /原因.*?は(.+?)[\.\n]/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    // Default: Generic root cause
    return 'Root cause not explicitly stated in conversation';
  }

  /**
   * Extract trigger conditions from text
   */
  private extractTriggerConditions(text: string): string[] {
    const conditions: string[] = [];

    // Look for conditional patterns
    const patterns = [
      /when (.+?)[\.\n,]/gi,
      /if (.+?)[\.\n,]/gi,
      /after (.+?)[\.\n,]/gi,
    ];

    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        conditions.push(match[1].trim());
      }
    }

    // If no conditions found, add generic
    if (conditions.length === 0) {
      conditions.push('Specific trigger conditions not identified');
    }

    return conditions;
  }

  /**
   * Deduplicate and merge similar patterns
   */
  private deduplicatePatterns(patterns: AccidentPattern[]): AccidentPattern[] {
    const deduped = new Map<string, AccidentPattern>();

    for (const pattern of patterns) {
      // Use title as deduplication key (normalize)
      const key = pattern.title.toLowerCase().trim();

      if (deduped.has(key)) {
        // Merge with existing pattern
        const existing = deduped.get(key)!;
        existing.occurrence_count++;
        existing.last_occurred_at = pattern.last_occurred_at;
        existing.conversation_ids.push(...pattern.conversation_ids);
        existing.updated_at = new Date().toISOString();

        // Upgrade severity if new pattern is more severe
        const severities: ('low' | 'medium' | 'high' | 'critical')[] = ['low', 'medium', 'high', 'critical'];
        const existingSeverityIndex = severities.indexOf(existing.severity);
        const newSeverityIndex = severities.indexOf(pattern.severity);
        if (newSeverityIndex > existingSeverityIndex) {
          existing.severity = pattern.severity;
        }

        // Upgrade blast radius if new pattern is wider
        const radii: ('file' | 'directory' | 'project' | 'system')[] = ['file', 'directory', 'project', 'system'];
        const existingRadiusIndex = radii.indexOf(existing.blast_radius);
        const newRadiusIndex = radii.indexOf(pattern.blast_radius);
        if (newRadiusIndex > existingRadiusIndex) {
          existing.blast_radius = pattern.blast_radius;
        }
      } else {
        // Add new pattern
        deduped.set(key, pattern);
      }
    }

    return Array.from(deduped.values());
  }

  /**
   * Parse incident record from Memory Gateway
   */
  private parseIncidentRecord(item: any): AccidentPattern | null {
    try {
      // Try to parse content as JSON
      let data = item;
      if (typeof item.content === 'string') {
        try {
          data = JSON.parse(item.content);
        } catch {
          // Content is not JSON, use item as-is
        }
      }

      // Extract pattern fields
      const pattern: AccidentPattern = {
        pattern_id: data.pattern_id || `pattern_mem_${item.id || Date.now()}`,
        title: data.title || item.title || 'Untitled incident',
        description: data.description || item.content?.substring(0, 200) || 'No description',
        severity: data.severity || 'medium',
        blast_radius: data.blast_radius || 'directory',
        first_occurred_at: data.first_occurred_at || item.timestamp || new Date().toISOString(),
        last_occurred_at: data.last_occurred_at || item.timestamp || new Date().toISOString(),
        occurrence_count: data.occurrence_count || 1,
        root_cause: data.root_cause || 'Unknown root cause',
        trigger_conditions: data.trigger_conditions || ['Unknown trigger'],
        conversation_ids: data.conversation_ids || [],
        extracted_from: 'error_log',
        created_at: item.timestamp || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return pattern;
    } catch (error) {
      console.error('[AccidentPatternExtractor] Failed to parse incident record:', error);
      return null;
    }
  }

  /**
   * Store accident pattern in Memory Gateway
   */
  async storePattern(pattern: AccidentPattern): Promise<void> {
    try {
      await fetch(`${this.MEMORY_GATEWAY_URL}/v1/memory/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: `private/jarvis/accident_patterns`,
          type: 'accident_pattern',
          title: pattern.title,
          content: JSON.stringify(pattern, null, 2),
          tags: [pattern.severity, pattern.blast_radius, 'accident_pattern'],
          importance: pattern.severity === 'critical' ? 9 : pattern.severity === 'high' ? 7 : 5,
          pin: pattern.severity === 'critical',
          source_agent: 'jarvis',
        }),
      });

      console.log(`[AccidentPatternExtractor] Stored pattern ${pattern.pattern_id}`);
    } catch (error) {
      console.error('[AccidentPatternExtractor] Failed to store pattern:', error);
    }
  }
}
