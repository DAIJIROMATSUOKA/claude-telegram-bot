/**
 * Autopilot Context Manager v2.2
 *
 * Responsible for:
 * - Loading memory snapshots (always)
 * - Running queries (when needed)
 * - Appending new memories
 * - Pinned memory support (v2.2)
 * - Query-based context gathering (v2.2)
 * - Token budget management (v2.2)
 *
 * Strategy: Snapshot常時 + Query必要時のみ + Pinned優先
 */

import type { AutopilotContext } from './engine';
import type { MemoryAppendRequest, MemoryQueryParams } from './types';

export interface ContextOptions {
  scope?: string;
  scopePrefix?: string;
  includeQuery?: boolean;
  queryParams?: MemoryQueryParams;
  maxItems?: number;
  // v2.2 additions
  includePinned?: boolean;      // Include pinned memories
  queryKeywords?: string[];      // Keywords for query-based context
  tokenBudget?: number;          // Max tokens for context (default: 4000)
}

export interface TokenBudgetResult {
  snapshot: string;
  pinnedMemories: any[];
  queryResults: any[];
  estimatedTokens: number;
  truncated: boolean;
}

export class ContextManager {
  private gatewayUrl: string;
  private readonly CHARS_PER_TOKEN = 4; // Rough estimate: 1 token ≈ 4 characters

  constructor(gatewayUrl: string) {
    this.gatewayUrl = gatewayUrl;
  }

  /**
   * Get autopilot context (Snapshot + optional Query + Pinned + Token Budget)
   */
  async getContext(options: ContextOptions = {}): Promise<AutopilotContext> {
    const {
      scope = 'shared/global',
      scopePrefix,
      includeQuery = false,
      queryParams,
      maxItems = 50,
      includePinned = true,      // v2.2: default to true
      queryKeywords = [],         // v2.2: keyword-based context
      tokenBudget = 4000,         // v2.2: default 4k tokens
    } = options;

    // v2.2: Use token budget management
    if (tokenBudget > 0) {
      return this.getContextWithBudget({
        scope: scope ?? '',
        scopePrefix: scopePrefix ?? '',
        maxItems,
        includePinned,
        queryKeywords,
        includeQuery,
        queryParams,
        tokenBudget,
      });
    }

    // Legacy behavior (no token budget)
    // Always load snapshot
    const snapshot = await this.getSnapshot({
      scope: scopePrefix ? undefined : scope,
      scope_prefix: scopePrefix,
      max_items: maxItems,
    });

    // Load task history from autopilot_log scope
    const taskHistory = await this.getTaskHistory();

    const context: AutopilotContext = {
      snapshot,
      task_history: taskHistory,
    };

    // v2.2: Include pinned memories
    if (includePinned) {
      const pinnedMemories = await this.getPinnedMemories(scopePrefix || scope);
      if (pinnedMemories.length > 0) {
        context.query_results = pinnedMemories;
      }
    }

    // Optionally run query
    if (includeQuery && queryParams) {
      const queryResults = await this.query(queryParams);
      context.query_results = [...(context.query_results || []), ...queryResults];
    }

    // v2.2: Query by keywords
    if (queryKeywords.length > 0) {
      const keywordResults = await this.queryByKeywords(queryKeywords, scopePrefix || scope);
      context.query_results = [...(context.query_results || []), ...keywordResults];
    }

    return context;
  }

  /**
   * Get memory snapshot (markdown format for LLM injection)
   */
  async getSnapshot(params: {
    scope?: string;
    scope_prefix?: string;
    max_items?: number;
  }): Promise<string> {
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('format', 'prompt'); // Request markdown format

      if (params.scope) {
        queryParams.set('scope', params.scope);
      }

      if (params.scope_prefix) {
        queryParams.set('scope_prefix', params.scope_prefix);
      }

      if (params.max_items) {
        queryParams.set('max_items', params.max_items.toString());
      }

      const url = `${this.gatewayUrl}/v1/memory/snapshot?${queryParams}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Snapshot request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;

      // Return markdown snapshot
      return data.snapshot || '';
    } catch (error) {
      console.error('[ContextManager] Error fetching snapshot:', error);
      return ''; // Return empty snapshot on error
    }
  }

  /**
   * Query memory events with filters
   */
  async query(params: MemoryQueryParams): Promise<any[]> {
    try {
      const queryParams = new URLSearchParams();

      if (params.scope) queryParams.set('scope', params.scope);
      if (params.scope_prefix) queryParams.set('scope_prefix', params.scope_prefix);
      if (params.type) queryParams.set('type', params.type);
      if (params.pinned !== undefined) queryParams.set('pinned', params.pinned.toString());
      if (params.since) queryParams.set('since', params.since);
      if (params.until) queryParams.set('until', params.until);
      if (params.q) queryParams.set('q', params.q);
      if (params.limit) queryParams.set('limit', params.limit.toString());
      if (params.cursor) queryParams.set('cursor', params.cursor);

      // Add multiple scopes
      if (params.scopes) {
        params.scopes.forEach((scope) => queryParams.append('scopes', scope));
      }

      // Add multiple tags
      if (params.tags) {
        params.tags.forEach((tag) => queryParams.append('tags', tag));
      }

      const url = `${this.gatewayUrl}/v1/memory/query?${queryParams}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Query request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      return data.items || [];
    } catch (error) {
      console.error('[ContextManager] Error querying memory:', error);
      return []; // Return empty array on error
    }
  }

  /**
   * Append new memory event
   */
  async appendMemory(request: MemoryAppendRequest): Promise<void> {
    try {
      const url = `${this.gatewayUrl}/v1/memory/append`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json() as any;
        throw new Error(
          `Append request failed: ${response.status} ${errorData.error?.message || response.statusText}`
        );
      }

      console.log('[ContextManager] Memory appended successfully');
    } catch (error) {
      console.error('[ContextManager] Error appending memory:', error);
      throw error; // Re-throw to let caller handle
    }
  }

  /**
   * Get autopilot task history from memory
   */
  private async getTaskHistory(): Promise<any[]> {
    try {
      const items = await this.query({
        scope: 'shared/autopilot_log',
        type: 'execution_log',
        limit: 10,
      });

      return items.map((item) => ({
        id: item.id,
        title: item.title,
        created_at: item.created_at,
        content: item.content,
      }));
    } catch (error) {
      console.error('[ContextManager] Error fetching task history:', error);
      return [];
    }
  }

  /**
   * Check if task was recently executed (last 24h)
   */
  async wasRecentlyExecuted(taskType: string, taskTitle: string): Promise<boolean> {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const items = await this.query({
        scope: 'shared/autopilot_log',
        type: 'execution_log',
        since: yesterday.toISOString(),
        q: `${taskType} ${taskTitle}`,
        limit: 1,
      });

      return items.length > 0;
    } catch (error) {
      console.error('[ContextManager] Error checking recent execution:', error);
      return false;
    }
  }

  /**
   * v2.2: Get pinned memories (high importance items)
   */
  async getPinnedMemories(scopePrefix: string = 'shared'): Promise<any[]> {
    try {
      const items = await this.query({
        scope_prefix: scopePrefix,
        pinned: true,
        limit: 20, // Max 20 pinned items
      });

      console.log(`[ContextManager] Found ${items.length} pinned memories`);
      return items;
    } catch (error) {
      console.error('[ContextManager] Error fetching pinned memories:', error);
      return [];
    }
  }

  /**
   * v2.2: Query by keywords (full-text search)
   */
  async queryByKeywords(keywords: string[], scopePrefix: string = 'shared'): Promise<any[]> {
    try {
      if (keywords.length === 0) return [];

      const query = keywords.join(' '); // Join keywords with space

      const items = await this.query({
        scope_prefix: scopePrefix,
        q: query,
        limit: 10, // Max 10 keyword results
      });

      console.log(`[ContextManager] Found ${items.length} items for keywords: ${keywords.join(', ')}`);
      return items;
    } catch (error) {
      console.error('[ContextManager] Error querying by keywords:', error);
      return [];
    }
  }

  /**
   * v2.2: Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }

  /**
   * v2.2: Get context with token budget management
   */
  private async getContextWithBudget(options: Required<Omit<ContextOptions, 'includeQuery' | 'queryParams'>> & {
    includeQuery?: boolean;
    queryParams?: MemoryQueryParams;
  }): Promise<AutopilotContext> {
    const {
      scope,
      scopePrefix,
      maxItems,
      includePinned,
      queryKeywords,
      includeQuery,
      queryParams,
      tokenBudget,
    } = options;

    let remainingBudget = tokenBudget;
    const context: AutopilotContext = {
      snapshot: '',
      task_history: [],
      query_results: [],
    };

    // Priority 1: Pinned memories (always include if enabled)
    if (includePinned && remainingBudget > 0) {
      const pinnedMemories = await this.getPinnedMemories(scopePrefix || scope);
      const pinnedText = JSON.stringify(pinnedMemories);
      const pinnedTokens = this.estimateTokens(pinnedText);

      if (pinnedTokens <= remainingBudget) {
        context.query_results = pinnedMemories;
        remainingBudget -= pinnedTokens;
        console.log(`[ContextManager] Added ${pinnedMemories.length} pinned memories (${pinnedTokens} tokens)`);
      } else {
        console.warn(`[ContextManager] Pinned memories exceed budget (${pinnedTokens} > ${remainingBudget})`);
      }
    }

    // Priority 2: Task history
    if (remainingBudget > 0) {
      const taskHistory = await this.getTaskHistory();
      const historyText = JSON.stringify(taskHistory);
      const historyTokens = this.estimateTokens(historyText);

      if (historyTokens <= remainingBudget) {
        context.task_history = taskHistory;
        remainingBudget -= historyTokens;
        console.log(`[ContextManager] Added ${taskHistory.length} task history items (${historyTokens} tokens)`);
      } else {
        // Truncate task history to fit budget
        const maxHistoryItems = Math.floor((taskHistory.length * remainingBudget) / historyTokens);
        context.task_history = taskHistory.slice(0, Math.max(1, maxHistoryItems));
        const truncatedTokens = this.estimateTokens(JSON.stringify(context.task_history));
        remainingBudget -= truncatedTokens;
        console.log(`[ContextManager] Truncated task history to ${context.task_history.length} items (${truncatedTokens} tokens)`);
      }
    }

    // Priority 3: Keyword query results
    if (queryKeywords.length > 0 && remainingBudget > 0) {
      const keywordResults = await this.queryByKeywords(queryKeywords, scopePrefix || scope);
      const keywordText = JSON.stringify(keywordResults);
      const keywordTokens = this.estimateTokens(keywordText);

      if (keywordTokens <= remainingBudget) {
        context.query_results = [...(context.query_results || []), ...keywordResults];
        remainingBudget -= keywordTokens;
        console.log(`[ContextManager] Added ${keywordResults.length} keyword results (${keywordTokens} tokens)`);
      } else {
        console.warn(`[ContextManager] Keyword results exceed budget (${keywordTokens} > ${remainingBudget})`);
      }
    }

    // Priority 4: Custom query results
    if (includeQuery && queryParams && remainingBudget > 0) {
      const queryResults = await this.query(queryParams);
      const queryText = JSON.stringify(queryResults);
      const queryTokens = this.estimateTokens(queryText);

      if (queryTokens <= remainingBudget) {
        context.query_results = [...(context.query_results || []), ...queryResults];
        remainingBudget -= queryTokens;
        console.log(`[ContextManager] Added ${queryResults.length} query results (${queryTokens} tokens)`);
      } else {
        console.warn(`[ContextManager] Query results exceed budget (${queryTokens} > ${remainingBudget})`);
      }
    }

    // Priority 5: Snapshot (lowest priority - fills remaining budget)
    if (remainingBudget > 0) {
      const snapshot = await this.getSnapshot({
        scope: scopePrefix ? undefined : scope,
        scope_prefix: scopePrefix,
        max_items: maxItems,
      });

      const snapshotTokens = this.estimateTokens(snapshot);

      if (snapshotTokens <= remainingBudget) {
        context.snapshot = snapshot;
        remainingBudget -= snapshotTokens;
        console.log(`[ContextManager] Added snapshot (${snapshotTokens} tokens)`);
      } else {
        // Truncate snapshot to fit remaining budget
        const maxChars = remainingBudget * this.CHARS_PER_TOKEN;
        context.snapshot = snapshot.slice(0, maxChars) + '\n\n[... truncated due to token budget ...]';
        const truncatedTokens = this.estimateTokens(context.snapshot);
        remainingBudget -= truncatedTokens;
        console.log(`[ContextManager] Truncated snapshot (${truncatedTokens} tokens)`);
      }
    }

    const usedTokens = tokenBudget - remainingBudget;
    console.log(`[ContextManager] Context assembled: ${usedTokens}/${tokenBudget} tokens used`);

    return context;
  }
}
