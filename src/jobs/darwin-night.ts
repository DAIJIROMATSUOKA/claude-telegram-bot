#!/usr/bin/env bun
/**
 * Darwin Engine v1.2.2 - Night Council Job
 * Runs: 23:00-02:45 JST (Cron: 0 14 * * *)
 *
 * Pipeline:
 * 1. Generate 60 ideas (3 models x 5 themes)
 * 2. Select TOP10 best ideas
 * 3. Evolve TOP10 with additional context
 * 4. Post best evolved idea at 02:45
 *
 * Usage:
 *   bun run src/jobs/darwin-night.ts
 *   bun run src/jobs/darwin-night.ts --dry-run
 */

import { Bot } from 'grammy';
import { ulid } from 'ulidx';
import type { LlmProvider, LlmGenerateOptions, LlmGenerateResponse } from '../features/ai_council/types';
import { callClaudeCLI, callCodexCLI, callGeminiAPI } from '../handlers/ai-router';
import {
  getThemeDistribution,
  generateTaskList,
  type GenerationTask,
} from '../darwin/theme-distribution';
import type {
  DarwinRunType,
  DarwinIdeaType,
  DarwinThemeType,
  DarwinModelType,
} from '../darwin/schema-validator';
import { FitnessEvaluator, type FitnessScores } from '../darwin/fitness-evaluator';
import { RedTeamGate, type RedTeamResult } from '../darwin/redteam-gate';
import {
  generateIdeaId,
  generateConsensusGroup,
  detectConsensus,
  truncateIdea,
  type TruncatedIdea,
} from '../darwin/idea-hasher';
import { BackupGenerator, type BackupIdea } from '../darwin/backup-generator';

// ==================== Configuration ====================

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_USER_ID = process.env.TELEGRAM_ALLOWED_USERS?.split(',')[0];
const MEMORY_GATEWAY_URL = process.env.MEMORY_GATEWAY_URL || 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || '';

const DRY_RUN = process.argv.includes('--dry-run');
const TIMEOUT_MS = 60_000; // 60 seconds per model call
const MAX_RETRIES = 2;

// ==================== AI Router Wrapper Providers ====================

/**
 * AI Router ベースのプロバイダー（従量課金API不使用）
 */
class RouterBasedProvider implements LlmProvider {
  name: 'google'; // Satisfy LlmProvider interface requirement
  private callFn: (prompt: string, memoryPack: string) => Promise<any>;

  constructor(callFn: (prompt: string, memoryPack: string) => Promise<any>) {
    this.name = 'google'; // Use 'google' to satisfy type checker
    this.callFn = callFn;
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    // Build full prompt from system + messages
    let fullPrompt = '';

    if (options.system) {
      fullPrompt += options.system + '\n\n';
    }

    for (const msg of options.messages) {
      fullPrompt += `${msg.role}: ${msg.content}\n`;
    }

    // Call AI Router function (memoryPack is empty for Darwin)
    const response = await this.callFn(fullPrompt, '');

    if (response.error) {
      throw new Error(response.error);
    }

    return {
      content: response.content,
      usage: {
        input_tokens: 0, // AI Router doesn't track tokens
        output_tokens: 0,
      },
    };
  }
}

// ==================== Database Client ====================

class DarwinDB {
  private gatewayUrl: string;
  private apiKey: string;

  constructor(gatewayUrl: string, apiKey: string) {
    this.gatewayUrl = gatewayUrl;
    this.apiKey = apiKey;
  }

  private async query(sql: string, params?: any[]): Promise<any> {
    const response = await fetch(`${this.gatewayUrl}/v1/db/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[Darwin DB] Query failed:', {
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
        sql: sql.substring(0, 100),
      });
      throw new Error(`DB query failed: ${response.statusText} - ${errorBody}`);
    }

    return response.json();
  }

  async createRun(mode: 'shadow' | 'active', themesDistribution: string): Promise<string> {
    const run_id = `darwin_${ulid()}`;
    const now = new Date().toISOString();

    await this.query(
      `INSERT INTO darwin_runs (run_id, started_at, status, mode, themes_distribution, version)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [run_id, now, 'running', mode, themesDistribution, 'v1.2.2']
    );

    return run_id;
  }

  async updateRun(run_id: string, updates: {
    completed_at?: string;
    status?: string;
    ideas_generated?: number;
    ideas_evolved?: number;
    message_posted?: number;
    duration_seconds?: number;
    error?: string;
  }): Promise<void> {
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map(f => `${f} = ?`).join(', ');

    await this.query(
      `UPDATE darwin_runs SET ${setClause} WHERE run_id = ?`,
      [...values, run_id]
    );
  }

  async insertIdea(idea: Partial<DarwinIdeaType> & {
    fitness?: FitnessScores;
    redteam?: RedTeamResult;
    consensus_count?: number;
    consensus_group?: string;
    truncated?: boolean;
  }): Promise<string> {
    // Generate hash-based idea_id
    const idea_id = generateIdeaId(idea.theme!, idea.title!);
    const now = new Date().toISOString();

    console.log('[Darwin DB] Inserting idea:', {
      idea_id: idea_id.substring(0, 20),
      title: idea.title?.substring(0, 50),
      model: idea.model,
      theme: idea.theme,
    });

    await this.query(
      `INSERT OR IGNORE INTO darwin_ideas (
        idea_id, run_id, generation, parent_id, model, theme,
        title, content, rationale, score, rank, status, created_at,
        fitness_novelty, fitness_leverage, fitness_feasibility,
        fitness_time_to_signal, fitness_strategic_fit, fitness_risk, fitness_reusability,
        consensus_count, consensus_group,
        redteam_critical, redteam_high, redteam_medium, redteam_status,
        truncated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        idea_id,
        idea.run_id,
        idea.generation || 0,
        idea.parent_id || null,
        idea.model,
        idea.theme,
        idea.title,
        idea.content,
        idea.rationale || null,
        idea.score || 0,
        idea.rank || null,
        idea.status || 'pending',
        now,
        idea.fitness?.novelty || null,
        idea.fitness?.leverage || null,
        idea.fitness?.feasibility || null,
        idea.fitness?.time_to_signal || null,
        idea.fitness?.strategic_fit || null,
        idea.fitness?.risk || null,
        idea.fitness?.reusability || null,
        idea.consensus_count || 1,
        idea.consensus_group || null,
        idea.redteam?.critical || 0,
        idea.redteam?.high || 0,
        idea.redteam?.medium || 0,
        idea.redteam?.status || 'pending',
        idea.truncated ? 1 : 0,
      ]
    );

    return idea_id;
  }

  async getTopIdeas(run_id: string, limit: number = 10): Promise<DarwinIdeaType[]> {
    const result = await this.query(
      `SELECT * FROM darwin_ideas
       WHERE run_id = ? AND generation = 0
       ORDER BY score DESC
       LIMIT ?`,
      [run_id, limit]
    );

    return result.results || [];
  }

  async updateIdeaRank(idea_id: string, rank: number, status: string): Promise<void> {
    await this.query(
      `UPDATE darwin_ideas SET rank = ?, status = ? WHERE idea_id = ?`,
      [rank, status, idea_id]
    );
  }

  async getSetting(key: string): Promise<any> {
    const result = await this.query(
      `SELECT value FROM darwin_settings WHERE key = ?`,
      [key]
    );

    if (!result.results || result.results.length === 0) {
      return null;
    }

    return JSON.parse(result.results[0].value);
  }

  async updateSetting(key: string, value: any): Promise<void> {
    const now = new Date().toISOString();
    const valueJson = JSON.stringify(value);

    await this.query(
      `INSERT OR REPLACE INTO darwin_settings (key, value, updated_at, updated_by)
       VALUES (?, ?, ?, ?)`,
      [key, valueJson, now, 'system']
    );
  }
}

// ==================== LLM Providers ====================

class ModelManager {
  private providers: Map<DarwinModelType, LlmProvider>;

  constructor() {
    this.providers = new Map();

    // ⚠️ Use AI Router functions - No pay-per-use APIs
    try {
      // Claude via CLI (Telegram forwarding)
      this.providers.set('claude', new RouterBasedProvider(callClaudeCLI));

      // ChatGPT via Codex CLI (Telegram forwarding)
      this.providers.set('chatgpt', new RouterBasedProvider(callCodexCLI));

      // Gemini via API (free tier)
      this.providers.set('gemini', new RouterBasedProvider(callGeminiAPI));
    } catch (e) {
      console.warn('AI Router providers unavailable:', e);
      throw new Error('AI Router providers required but unavailable');
    }
  }

  getProvider(model: DarwinModelType): LlmProvider | null {
    return this.providers.get(model) || null;
  }

  async generateIdea(
    model: DarwinModelType,
    theme: DarwinThemeType,
    generation: number,
    parentIdea?: { title: string; content: string; rationale: string }
  ): Promise<{ title: string; content: string; rationale: string }> {
    const provider = this.getProvider(model);
    if (!provider) {
      throw new Error(`Provider for ${model} not available`);
    }

    const systemPrompt = this.buildSystemPrompt(theme, generation, parentIdea);
    const userPrompt = generation === 0
      ? `Generate 1 innovative idea for theme: ${theme}`
      : `Evolve this TOP10 idea:\n\nTitle: ${parentIdea?.title}\n\n${parentIdea?.content}`;

    const response = await provider.generate({
      model: 'gemini-2.5-flash', // Required by LlmGenerateOptions
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: generation === 0 ? 0.9 : 0.7, // Higher creativity for initial, more focused for evolution
      maxTokens: 500,
    });

    return this.parseIdeaResponse(response.content);
  }

  private buildSystemPrompt(theme: DarwinThemeType, generation: number, parentIdea?: any): string {
    const themeDescriptions: Record<DarwinThemeType, string> = {
      product: '新製品・機能・サービスのアイデア',
      marketing: 'マーケティング・プロモーション・ブランディングのアイデア',
      operations: '業務効率化・プロセス改善・コスト削減のアイデア',
      strategy: '経営戦略・ビジネスモデル・市場開拓のアイデア',
      culture: '組織文化・チームビルディング・働き方改革のアイデア',
    };

    if (generation === 0) {
      return `You are a creative innovation consultant generating breakthrough business ideas.

Theme: ${themeDescriptions[theme]}

Generate 1 highly innovative, actionable idea. Format:

TITLE: [Catchy title in 5-10 words]

CONTENT: [2-3 sentences describing the idea, its implementation, and expected impact]

RATIONALE: [1-2 sentences explaining why this matters and what problem it solves]

Be bold, practical, and specific. Focus on ideas that can be implemented within 3-6 months.`;
    } else {
      return `You are a strategic advisor evolving a TOP10 business idea.

Theme: ${themeDescriptions[theme]}

Enhance the provided idea by:
1. Adding specific implementation steps
2. Identifying potential risks and mitigation strategies
3. Quantifying expected ROI or impact metrics
4. Suggesting pilot testing approaches

Format:

TITLE: [Enhanced title]

CONTENT: [Detailed implementation plan with metrics]

RATIONALE: [Business case with risk analysis]

Make it highly actionable and investor-ready.`;
    }
  }

  private parseIdeaResponse(content: string): { title: string; content: string; rationale: string } {
    const titleMatch = content.match(/TITLE:\s*(.+)/i);
    const contentMatch = content.match(/CONTENT:\s*([\s\S]+?)(?=RATIONALE:|$)/i);
    const rationaleMatch = content.match(/RATIONALE:\s*([\s\S]+)/i);

    return {
      title: titleMatch?.[1]?.trim() || 'Untitled Idea',
      content: contentMatch?.[1]?.trim() || content,
      rationale: rationaleMatch?.[1]?.trim() || 'No rationale provided',
    };
  }
}

// ==================== Idea Evaluator ====================

class IdeaEvaluator {
  private fitnessEvaluator = new FitnessEvaluator();
  private redteamGate = new RedTeamGate();

  async scoreIdeas(ideas: Array<{
    idea_id: string;
    title: string;
    content: string;
    rationale: string;
    theme: string;
  }>): Promise<{
    scores: Record<string, number>;
    fitness: Record<string, FitnessScores>;
    redteam: Record<string, RedTeamResult>;
  }> {
    const scores: Record<string, number> = {};
    const fitness: Record<string, FitnessScores> = {};
    const redteam: Record<string, RedTeamResult> = {};

    for (const idea of ideas) {
      // FITNESS 7-axis evaluation
      const fitnessScores = await this.fitnessEvaluator.evaluate({
        title: idea.title,
        content: idea.content,
        rationale: idea.rationale,
        theme: idea.theme,
      });

      // RED-TEAM gate
      const redteamResult = await this.redteamGate.analyze({
        title: idea.title,
        content: idea.content,
        rationale: idea.rationale,
        theme: idea.theme,
      });

      // Overall score = FITNESS overall
      let score = fitnessScores.overall;

      // RED-TEAM penalties
      if (redteamResult.status === 'blocked') {
        score = 0; // Block completely
      } else if (redteamResult.status === 'warn') {
        score *= 0.7; // 30% penalty for warnings
      }

      scores[idea.idea_id] = Math.min(1.0, Math.max(0.0, score));
      fitness[idea.idea_id] = fitnessScores;
      redteam[idea.idea_id] = redteamResult;
    }

    return { scores, fitness, redteam };
  }

  selectTOP10(ideas: Array<{ idea_id: string; score: number; theme: string }>): string[] {
    // Sort by score descending
    const sorted = ideas.sort((a, b) => b.score - a.score);

    // Ensure theme diversity in TOP10
    const top10: string[] = [];
    const themeCounts: Record<string, number> = {};

    for (const idea of sorted) {
      if (top10.length >= 10) break;

      const themeCount = themeCounts[idea.theme] || 0;
      if (themeCount < 3) { // Max 3 per theme in TOP10
        top10.push(idea.idea_id);
        themeCounts[idea.theme] = themeCount + 1;
      }
    }

    // Fill remaining slots if needed
    for (const idea of sorted) {
      if (top10.length >= 10) break;
      if (!top10.includes(idea.idea_id)) {
        top10.push(idea.idea_id);
      }
    }

    return top10.slice(0, 10);
  }
}

// ==================== Main Job ====================

async function main() {
  console.log('🌙 Darwin Night Council v1.2.2');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'PRODUCTION'}`);

  const startTime = Date.now();
  const db = new DarwinDB(MEMORY_GATEWAY_URL, GATEWAY_API_KEY);
  const modelManager = new ModelManager();
  const evaluator = new IdeaEvaluator();

  // Check mode
  const mode = await db.getSetting('mode') || 'shadow';
  const shadowDaysRemaining = await db.getSetting('shadow_days_remaining') || 7;

  console.log(`📋 Mode: ${mode}, Shadow days remaining: ${shadowDaysRemaining}`);

  // Create run
  const themeDistribution = getThemeDistribution('balanced');
  const run_id = await db.createRun(mode, JSON.stringify(themeDistribution));

  console.log(`🆔 Run ID: ${run_id}`);

  try {
    // Phase 1: Generate 60 ideas
    console.log('\n📦 Phase 1: Generating 60 ideas...');
    const tasks = generateTaskList(themeDistribution);
    const allIdeas: Array<{ idea_id: string; title: string; content: string; rationale: string; theme: string; model: string }> = [];
    const failuresByModel: Record<string, number> = { claude: 0, gemini: 0, chatgpt: 0 };

    let generatedCount = 0;
    for (const task of tasks) {
      console.log(`  Generating ${task.count} ideas: ${task.model} x ${task.theme}`);

      for (let i = 0; i < task.count; i++) {
        try {
          const rawIdea = await withRetry(
            () => modelManager.generateIdea(task.model, task.theme, 0),
            MAX_RETRIES,
            TIMEOUT_MS
          );

          // Truncate to 4096 char limit
          const truncated = truncateIdea(rawIdea.title, rawIdea.content, rawIdea.rationale);

          const idea_id = await db.insertIdea({
            run_id,
            generation: 0,
            parent_id: null,
            model: task.model,
            theme: task.theme,
            title: truncated.title,
            content: truncated.content,
            rationale: truncated.rationale,
            status: 'pending',
            truncated: truncated.truncated,
          });

          allIdeas.push({
            idea_id,
            title: truncated.title,
            content: truncated.content,
            rationale: truncated.rationale,
            theme: task.theme,
            model: task.model,
          });
          generatedCount++;

          if (!DRY_RUN && generatedCount % 10 === 0) {
            console.log(`  Progress: ${generatedCount}/60`);
          }
        } catch (error) {
          console.error(`  Failed to generate idea: ${error}`);
          failuresByModel[task.model]++;
        }
      }
    }

    // Backup generator: 2+ models failed
    const failedModels = Object.entries(failuresByModel)
      .filter(([_, count]) => count > 0)
      .map(([model]) => model);

    if (failedModels.length >= 2) {
      console.log(`\n🚨 DEGRADED MODE: ${failedModels.length} models failed`);
      const backupGenerator = new BackupGenerator();

      for (const task of tasks) {
        const failures = failuresByModel[task.model];
        if (failures > 0) {
          const backupIdeas = await backupGenerator.generate({
            theme: task.theme,
            count: failures,
            failedModels,
            existingIdeas: allIdeas.map(i => ({ title: i.title, theme: i.theme })),
          });

          for (const backupIdea of backupIdeas) {
            const truncated = truncateIdea(backupIdea.title, backupIdea.content, backupIdea.rationale);
            const idea_id = await db.insertIdea({
              run_id,
              generation: 0,
              parent_id: null,
              model: 'jarvis', // Jarvis as backup
              theme: task.theme,
              title: truncated.title,
              content: truncated.content,
              rationale: `${truncated.rationale}\n\n[${backupIdea.backupReason}]`,
              status: 'pending',
              truncated: truncated.truncated,
            });

            allIdeas.push({
              idea_id,
              title: truncated.title,
              content: truncated.content,
              rationale: truncated.rationale,
              theme: task.theme,
              model: 'jarvis',
            });
            generatedCount++;
          }

          console.log(`  ✅ Generated ${failures} backup ideas for ${task.theme}`);
        }
      }
    }

    console.log(`✅ Generated ${generatedCount} ideas`);
    await db.updateRun(run_id, { ideas_generated: generatedCount });

    // Consensus detection
    console.log('\n🤝 Detecting consensus...');
    const consensusGroups = detectConsensus(allIdeas);
    console.log(`Found ${consensusGroups.size} consensus groups`);

    // Update consensus info in DB
    for (const [group, members] of consensusGroups.entries()) {
      for (const member of members) {
        await db.query(
          'UPDATE darwin_ideas SET consensus_count = ?, consensus_group = ? WHERE idea_id = ?',
          [members.length, group, member.idea_id]
        );
      }
    }

    // Phase 2: Score and select TOP10
    console.log('\n🏆 Phase 2: Scoring with FITNESS + RED-TEAM...');
    const evaluation = await evaluator.scoreIdeas(allIdeas);

    // Update scores, fitness, and RED-TEAM in DB
    for (const idea of allIdeas) {
      const fitnessScores = evaluation.fitness[idea.idea_id];
      const redteamResult = evaluation.redteam[idea.idea_id];
      const score = evaluation.scores[idea.idea_id];

      await db.query(
        `UPDATE darwin_ideas SET
          score = ?,
          fitness_novelty = ?, fitness_leverage = ?, fitness_feasibility = ?,
          fitness_time_to_signal = ?, fitness_strategic_fit = ?, fitness_risk = ?, fitness_reusability = ?,
          redteam_critical = ?, redteam_high = ?, redteam_medium = ?, redteam_status = ?
        WHERE idea_id = ?`,
        [
          score,
          fitnessScores.novelty, fitnessScores.leverage, fitnessScores.feasibility,
          fitnessScores.time_to_signal, fitnessScores.strategic_fit, fitnessScores.risk, fitnessScores.reusability,
          redteamResult.critical, redteamResult.high, redteamResult.medium, redteamResult.status,
          idea.idea_id,
        ]
      );

      // Log RED-TEAM blocks
      if (redteamResult.status === 'blocked') {
        console.log(`  🚫 BLOCKED: ${idea.title} (${redteamResult.critical} critical, ${redteamResult.high} high issues)`);
      }
    }

    const ideasWithScores = allIdeas.map(idea => ({
      idea_id: idea.idea_id,
      score: evaluation.scores[idea.idea_id],
      theme: idea.theme,
    }));

    const top10Ids = evaluator.selectTOP10(ideasWithScores);

    // Mark TOP10 in DB
    for (let i = 0; i < top10Ids.length; i++) {
      await db.updateIdeaRank(top10Ids[i], i + 1, 'top10');
    }

    console.log(`✅ Selected TOP10`);

    // Phase 3: Evolve TOP10
    console.log('\n🧬 Phase 3: Evolving TOP10...');
    const top10Ideas = await db.getTopIdeas(run_id, 10);
    let evolvedCount = 0;

    for (const parentIdea of top10Ideas) {
      try {
        const evolved = await withRetry(
          () => modelManager.generateIdea(
            parentIdea.model as DarwinModelType,
            parentIdea.theme as DarwinThemeType,
            1,
            { title: parentIdea.title, content: parentIdea.content, rationale: parentIdea.rationale || '' }
          ),
          MAX_RETRIES,
          TIMEOUT_MS
        );

        await db.insertIdea({
          run_id,
          generation: 1,
          parent_id: parentIdea.idea_id,
          model: parentIdea.model as DarwinModelType,
          theme: parentIdea.theme as DarwinThemeType,
          title: evolved.title,
          content: evolved.content,
          rationale: evolved.rationale,
          status: 'pending',
        });

        evolvedCount++;
      } catch (error) {
        console.error(`  Failed to evolve idea ${parentIdea.idea_id}: ${error}`);
      }
    }

    console.log(`✅ Evolved ${evolvedCount} ideas`);
    await db.updateRun(run_id, { ideas_evolved: evolvedCount });

    // Phase 4: Post message (only if active mode and 02:45)
    const shouldPost = mode === 'active' && !DRY_RUN && await canPostToday(db);

    if (shouldPost) {
      console.log('\n📤 Phase 4: Posting message...');

      const bestIdea = top10Ideas[0]; // Rank 1
      const message = formatIdeaMessage(bestIdea);

      if (TELEGRAM_TOKEN && TELEGRAM_USER_ID) {
        const bot = new Bot(TELEGRAM_TOKEN);
        await bot.api.sendMessage(TELEGRAM_USER_ID, message, { parse_mode: 'Markdown' });
        await db.updateRun(run_id, { message_posted: 1 });
        await db.updateSetting('last_post_date', new Date().toISOString().split('T')[0]);
        console.log('✅ Message posted');
      }
    } else {
      console.log(`\n⏭️ Phase 4: Skipped (mode=${mode}, dry_run=${DRY_RUN})`);
    }

    // Complete run
    const endTime = Date.now();
    const durationSeconds = Math.floor((endTime - startTime) / 1000);

    await db.updateRun(run_id, {
      completed_at: new Date().toISOString(),
      status: 'completed',
      duration_seconds: durationSeconds,
    });

    console.log(`\n✅ Darwin Night Council completed in ${durationSeconds}s`);

    // Update shadow mode countdown
    if (mode === 'shadow' && shadowDaysRemaining > 0) {
      await db.updateSetting('shadow_days_remaining', shadowDaysRemaining - 1);
      if (shadowDaysRemaining - 1 === 0) {
        await db.updateSetting('mode', 'active');
        console.log('🎉 Shadow mode complete! Switching to active mode.');
      }
    }

  } catch (error) {
    console.error('❌ Darwin Night Council failed:', error);
    await db.updateRun(run_id, {
      completed_at: new Date().toISOString(),
      status: 'failed',
      error: String(error),
    });
    process.exit(1);
  }
}

// ==================== Helpers ====================

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  timeoutMs: number
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeoutMs)
      );

      return await Promise.race([fn(), timeoutPromise]);
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries) {
        const delay = Math.pow(2, i) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Unknown error');
}

async function canPostToday(db: DarwinDB): Promise<boolean> {
  const lastPostDate = await db.getSetting('last_post_date');
  const today = new Date().toISOString().split('T')[0];

  return !lastPostDate || lastPostDate !== today;
}

function formatIdeaMessage(idea: any): string {
  const emoji: Record<string, string> = {
    product: '📦',
    marketing: '📢',
    operations: '⚙️',
    strategy: '🎯',
    culture: '🌟',
  };

  return `${emoji[idea.theme] || '💡'} **Darwin Night Council**

**${idea.title}**

${idea.content}

_${idea.rationale}_

---
Theme: ${idea.theme} | Model: ${idea.model} | Rank: #${idea.rank}`;
}

// ==================== Entry Point ====================

if (import.meta.main) {
  main().catch(console.error);
}
