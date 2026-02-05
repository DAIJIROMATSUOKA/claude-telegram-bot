/**
 * Darwin Engine v1.2.2 - Command Handlers
 *
 * Commands:
 * - darwin status - Show latest run status
 * - darwin themes - Show theme distribution
 * - darwin history - Show recent runs
 * - darwin detail <run_id> - Show run details
 * - darwin feedback <idea_id> <reaction> - Submit feedback
 *
 * Night Commands (23:00-02:45):
 * - darwin KILL - Stop current run
 * - darwin PAUSE - Pause after current task
 * - darwin RESUME - Resume paused run
 * - darwin STATUS - Real-time execution status
 * - darwin PRIORITY <theme> - Boost theme priority
 */

import type { Context } from 'grammy';
import { isAuthorized } from '../security';
import { ALLOWED_USERS } from '../config';
import {
  isNightExecutionWindow,
  validateNightCommand,
  getCommandDescription,
  createConfirmationMessage,
  getTimeUntilNextExecution,
  type NightCommandType,
} from '../darwin/night-command-acl';
import { formatDistribution } from '../darwin/theme-distribution';

const MEMORY_GATEWAY_URL = process.env.MEMORY_GATEWAY_URL || 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || '';

// ==================== Database Client ====================

class DarwinDB {
  private gatewayUrl: string;
  private apiKey: string;

  constructor(gatewayUrl: string, apiKey: string) {
    this.gatewayUrl = gatewayUrl;
    this.apiKey = apiKey;
  }

  async query(sql: string, params?: any[]): Promise<any> {
    const response = await fetch(`${this.gatewayUrl}/v1/db/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!response.ok) {
      throw new Error(`DB query failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getLatestRun(): Promise<any> {
    const result = await this.query(
      `SELECT * FROM darwin_runs ORDER BY started_at DESC LIMIT 1`
    );
    return result.results?.[0] || null;
  }

  async getRunHistory(limit: number = 5): Promise<any[]> {
    const result = await this.query(
      `SELECT run_id, started_at, completed_at, status, mode, ideas_generated, ideas_evolved, message_posted
       FROM darwin_runs
       ORDER BY started_at DESC
       LIMIT ?`,
      [limit]
    );
    return result.results || [];
  }

  async getRunDetails(run_id: string): Promise<any> {
    const result = await this.query(
      `SELECT * FROM darwin_runs WHERE run_id = ?`,
      [run_id]
    );
    return result.results?.[0] || null;
  }

  async getTOP10(run_id: string): Promise<any[]> {
    const result = await this.query(
      `SELECT idea_id, rank, theme, title, score,
              fitness_novelty, fitness_leverage, fitness_feasibility,
              redteam_status, consensus_count, model
       FROM darwin_ideas
       WHERE run_id = ? AND rank IS NOT NULL
       ORDER BY rank ASC`,
      [run_id]
    );
    return result.results || [];
  }

  async getIdeaDetails(idea_id: string): Promise<any> {
    const result = await this.query(
      `SELECT * FROM darwin_ideas WHERE idea_id = ?`,
      [idea_id]
    );
    return result.results?.[0] || null;
  }

  async insertFeedback(idea_id: string, reaction: string, comment: string | null, user_id: string): Promise<void> {
    await this.query(
      `INSERT INTO darwin_feedback (feedback_id, idea_id, reaction, comment, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`feedback_${Date.now()}`, idea_id, reaction, comment, user_id, new Date().toISOString()]
    );
  }

  async getSetting(key: string): Promise<any> {
    const result = await this.query(
      `SELECT value FROM darwin_settings WHERE key = ?`,
      [key]
    );
    return result.results?.[0] ? JSON.parse(result.results[0].value) : null;
  }
}

// ==================== Command Handlers ====================

/**
 * darwin status - Show latest run status
 */
export async function handleDarwinStatus(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  try {
    const db = new DarwinDB(MEMORY_GATEWAY_URL, GATEWAY_API_KEY);
    const latestRun = await db.getLatestRun();

    if (!latestRun) {
      await ctx.reply('📊 No Darwin runs found yet.\n\nFirst run scheduled for tonight at 23:00 JST.');
      return;
    }

    const mode = await db.getSetting('mode');
    const shadowDays = await db.getSetting('shadow_days_remaining');

    const lines: string[] = [];
    lines.push('🌙 **Darwin Night Council Status**\n');
    lines.push(`**Latest Run:** ${latestRun.run_id}`);
    lines.push(`Started: ${new Date(latestRun.started_at).toLocaleString('ja-JP')}`);
    lines.push(`Status: ${latestRun.status}`);
    lines.push(`Mode: ${mode}${mode === 'shadow' ? ` (${shadowDays} days left)` : ''}`);
    lines.push('');
    lines.push(`📦 Ideas Generated: ${latestRun.ideas_generated}`);
    lines.push(`🧬 Ideas Evolved: ${latestRun.ideas_evolved}`);
    lines.push(`📤 Message Posted: ${latestRun.message_posted ? 'Yes' : 'No'}`);

    if (latestRun.completed_at) {
      lines.push(`⏱️ Duration: ${latestRun.duration_seconds}s`);
    }

    if (latestRun.error) {
      lines.push(`\n❌ Error: ${latestRun.error}`);
    }

    lines.push('');
    lines.push(`Next run: ${getTimeUntilNextExecution()}`);

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (error) {
    await ctx.reply(`❌ Error: ${error}`);
  }
}

/**
 * darwin themes - Show theme distribution
 */
export async function handleDarwinThemes(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  try {
    const db = new DarwinDB(MEMORY_GATEWAY_URL, GATEWAY_API_KEY);
    const distributionJson = await db.getSetting('theme_distribution');
    const priorityThemes = await db.getSetting('priority_themes') || [];

    const lines: string[] = [];
    lines.push('🎨 **Theme Distribution**\n');
    lines.push(formatDistribution(distributionJson));

    if (priorityThemes.length > 0) {
      lines.push('');
      lines.push(`🎯 **Priority Themes:** ${priorityThemes.join(', ')}`);
    }

    lines.push('');
    lines.push('To adjust priorities during execution:');
    lines.push('`darwin PRIORITY <theme>`');

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (error) {
    await ctx.reply(`❌ Error: ${error}`);
  }
}

/**
 * darwin history - Show recent runs
 */
export async function handleDarwinHistory(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  try {
    const db = new DarwinDB(MEMORY_GATEWAY_URL, GATEWAY_API_KEY);
    const runs = await db.getRunHistory(10);

    if (runs.length === 0) {
      await ctx.reply('📊 No Darwin runs found yet.');
      return;
    }

    const lines: string[] = [];
    lines.push('📜 **Darwin Run History**\n');

    for (const run of runs) {
      const date = new Date(run.started_at).toLocaleDateString('ja-JP');
      const status = run.status === 'completed' ? '✅' : run.status === 'failed' ? '❌' : '🔄';
      const posted = run.message_posted ? '📤' : '';

      lines.push(`${status} ${posted} ${date} - ${run.ideas_generated} ideas (${run.mode})`);
      lines.push(`   \`${run.run_id}\``);
    }

    lines.push('');
    lines.push('Use `darwin detail <run_id>` for details');

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (error) {
    await ctx.reply(`❌ Error: ${error}`);
  }
}

/**
 * darwin detail <run_id> - Show run details with TOP10
 */
export async function handleDarwinDetail(ctx: Context, run_id: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  try {
    const db = new DarwinDB(MEMORY_GATEWAY_URL, GATEWAY_API_KEY);
    const run = await db.getRunDetails(run_id);

    if (!run) {
      await ctx.reply(`❌ Run not found: ${run_id}`);
      return;
    }

    const top10 = await db.getTOP10(run_id);

    const lines: string[] = [];
    lines.push(`🌙 **Darwin Run: ${run_id}**\n`);
    lines.push(`Started: ${new Date(run.started_at).toLocaleString('ja-JP')}`);
    lines.push(`Status: ${run.status}`);
    lines.push(`Mode: ${run.mode}`);
    lines.push(`Duration: ${run.duration_seconds || 'N/A'}s`);
    lines.push('');
    lines.push(`📦 Ideas Generated: ${run.ideas_generated}`);
    lines.push(`🧬 Ideas Evolved: ${run.ideas_evolved}`);
    lines.push(`📤 Message Posted: ${run.message_posted ? 'Yes' : 'No'}`);

    if (top10.length > 0) {
      lines.push('');
      lines.push('🏆 **TOP10 Ideas:**\n');

      for (const idea of top10) {
        const emoji = idea.theme === 'product' ? '📦' :
                     idea.theme === 'marketing' ? '📢' :
                     idea.theme === 'operations' ? '⚙️' :
                     idea.theme === 'strategy' ? '🎯' : '🌟';
        const redteam = idea.redteam_status === 'blocked' ? '🚫' :
                       idea.redteam_status === 'warn' ? '⚠️' : '✅';
        const consensus = idea.consensus_count > 1 ? `🤝${idea.consensus_count}` : '';

        lines.push(`${idea.rank}. ${emoji} ${redteam} ${consensus} **${idea.title}**`);
        lines.push(`   Score: ${(idea.score * 100).toFixed(1)}% | ${idea.model}`);
        lines.push(`   \`${idea.idea_id}\``);
      }
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (error) {
    await ctx.reply(`❌ Error: ${error}`);
  }
}

/**
 * darwin feedback <idea_id> <reaction> [comment] - Submit feedback
 */
export async function handleDarwinFeedback(
  ctx: Context,
  idea_id: string,
  reaction: string,
  comment?: string
): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  const validReactions = ['thumbs_up', 'thumbs_down', 'thinking', 'fire', '👍', '👎', '🤔', '🔥'];
  if (!validReactions.includes(reaction)) {
    await ctx.reply(`❌ Invalid reaction. Use: thumbs_up, thumbs_down, thinking, fire (or emojis 👍👎🤔🔥)`);
    return;
  }

  // Normalize emoji to text
  const normalizedReaction = {
    '👍': 'thumbs_up',
    '👎': 'thumbs_down',
    '🤔': 'thinking',
    '🔥': 'fire',
  }[reaction] || reaction;

  try {
    const db = new DarwinDB(MEMORY_GATEWAY_URL, GATEWAY_API_KEY);
    const idea = await db.getIdeaDetails(idea_id);

    if (!idea) {
      await ctx.reply(`❌ Idea not found: ${idea_id}`);
      return;
    }

    await db.insertFeedback(idea_id, normalizedReaction, comment || null, String(userId));

    const emoji = { thumbs_up: '👍', thumbs_down: '👎', thinking: '🤔', fire: '🔥' }[normalizedReaction];
    await ctx.reply(`✅ Feedback recorded ${emoji}\n\n**${idea.title}**${comment ? `\n\nComment: ${comment}` : ''}`, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    await ctx.reply(`❌ Error: ${error}`);
  }
}

/**
 * darwin NIGHT_COMMAND - Handle night-time commands
 */
export async function handleDarwinNightCommand(ctx: Context, command: string, args?: string[]): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  const cmd = command.toUpperCase() as NightCommandType;

  // Validate command
  const db = new DarwinDB(MEMORY_GATEWAY_URL, GATEWAY_API_KEY);
  const latestRun = await db.getLatestRun();
  const currentStatus = latestRun?.status || null;

  const validation = validateNightCommand(cmd, currentStatus);

  if (!validation.allowed) {
    await ctx.reply(`❌ ${validation.reason}`);
    return;
  }

  // Handle confirmation for destructive commands
  if (validation.requiresConfirmation) {
    const confirmMsg = createConfirmationMessage(cmd);
    await ctx.reply(confirmMsg, { parse_mode: 'Markdown' });
    return;
  }

  // Execute command
  switch (cmd) {
    case 'STATUS':
      await handleDarwinStatus(ctx);
      break;

    case 'PRIORITY':
      if (!args || args.length === 0) {
        await ctx.reply('❌ Usage: darwin PRIORITY <theme>');
        return;
      }
      await handlePriorityCommand(ctx, args[0]);
      break;

    case 'KILL':
    case 'PAUSE':
    case 'RESUME':
      await ctx.reply(`🚧 ${cmd} command execution not yet implemented (requires run state management)`);
      break;

    default:
      await ctx.reply(`❌ Unknown command: ${cmd}`);
  }
}

async function handlePriorityCommand(ctx: Context, theme: string): Promise<void> {
  const validThemes = ['product', 'marketing', 'operations', 'strategy', 'culture'];
  if (!validThemes.includes(theme)) {
    await ctx.reply(`❌ Invalid theme. Valid: ${validThemes.join(', ')}`);
    return;
  }

  try {
    const db = new DarwinDB(MEMORY_GATEWAY_URL, GATEWAY_API_KEY);
    const currentPriorities = await db.getSetting('priority_themes') || [];

    if (currentPriorities.includes(theme)) {
      await ctx.reply(`ℹ️ ${theme} is already a priority theme`);
      return;
    }

    currentPriorities.push(theme);
    await db.query(
      `UPDATE darwin_settings SET value = ?, updated_at = ? WHERE key = 'priority_themes'`,
      [JSON.stringify(currentPriorities), new Date().toISOString()]
    );

    await ctx.reply(`✅ ${theme} added to priority themes\n\nCurrent priorities: ${currentPriorities.join(', ')}`, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    await ctx.reply(`❌ Error: ${error}`);
  }
}

// ==================== Workflow Optimizer Commands (v1.3) ====================

/**
 * darwin patterns - Show workflow patterns
 */
export async function handleDarwinPatterns(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  try {
    const db = new DarwinDB(MEMORY_GATEWAY_URL, GATEWAY_API_KEY);
    const result = await db.query(
      `SELECT pattern_name, pattern_type, frequency_count, avg_duration_ms, success_rate, last_seen_at
       FROM workflow_patterns
       ORDER BY frequency_count DESC
       LIMIT 10`
    );

    const patterns = result.results || [];

    if (patterns.length === 0) {
      await ctx.reply('📊 No workflow patterns detected yet.\n\nRun `darwin analyze` to analyze your workflows.');
      return;
    }

    const lines: string[] = [];
    lines.push('🔄 **Top Workflow Patterns**\n');

    for (const pattern of patterns) {
      const emoji = pattern.pattern_type === 'sequence' ? '➡️' : pattern.pattern_type === 'parallel' ? '⚡' : '🔀';
      const duration = Math.round(pattern.avg_duration_ms / 1000);
      const successRate = (pattern.success_rate * 100).toFixed(0);

      lines.push(`${emoji} **${pattern.pattern_name}**`);
      lines.push(`   Frequency: ${pattern.frequency_count}x | ${duration}s avg | ${successRate}% success`);
      lines.push('');
    }

    lines.push('_Updated: ' + new Date(patterns[0].last_seen_at).toLocaleString('ja-JP') + '_');

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (error) {
    await ctx.reply(`❌ Error: ${error}`);
  }
}

/**
 * darwin bottlenecks - Show detected bottlenecks
 */
export async function handleDarwinBottlenecks(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  try {
    const db = new DarwinDB(MEMORY_GATEWAY_URL, GATEWAY_API_KEY);
    const result = await db.query(
      `SELECT action_name, expected_duration_ms, actual_duration_ms, slowdown_factor, detected_at, suggested_optimization
       FROM bottleneck_detections
       WHERE resolved = 0
       ORDER BY detected_at DESC
       LIMIT 10`
    );

    const bottlenecks = result.results || [];

    if (bottlenecks.length === 0) {
      await ctx.reply('✅ No bottlenecks detected. Your workflows are running smoothly!');
      return;
    }

    const lines: string[] = [];
    lines.push('🐌 **Detected Bottlenecks**\n');

    for (const bottleneck of bottlenecks) {
      const expected = Math.round(bottleneck.expected_duration_ms / 1000);
      const actual = Math.round(bottleneck.actual_duration_ms / 1000);
      const factor = bottleneck.slowdown_factor.toFixed(1);

      lines.push(`⚠️ **${bottleneck.action_name}**`);
      lines.push(`   Expected: ${expected}s | Actual: ${actual}s (${factor}x slower)`);
      if (bottleneck.suggested_optimization) {
        lines.push(`   💡 ${bottleneck.suggested_optimization}`);
      }
      lines.push('');
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (error) {
    await ctx.reply(`❌ Error: ${error}`);
  }
}

/**
 * darwin analyze - Run pattern analysis now
 */
export async function handleDarwinAnalyze(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAuthorized(userId, ALLOWED_USERS)) {
    await ctx.reply('Unauthorized.');
    return;
  }

  await ctx.reply('🔍 Starting workflow analysis...\n\nThis may take a minute.');

  try {
    const { execSync } = await import('child_process');
    const result = execSync('bash scripts/analyze-patterns.sh', {
      cwd: '/Users/daijiromatsuokam1/claude-telegram-bot',
      encoding: 'utf-8',
      timeout: 120000,
    });

    // Extract stats from output
    const patternsMatch = result.match(/Patterns: (\d+)/);
    const bottlenecksMatch = result.match(/Bottlenecks: (\d+)/);
    const predictionsMatch = result.match(/Predictions: (\d+)/);
    const skipMatch = result.match(/Skip Candidates: (\d+)/);

    const patterns = patternsMatch ? parseInt(patternsMatch[1]) : 0;
    const bottlenecks = bottlenecksMatch ? parseInt(bottlenecksMatch[1]) : 0;
    const predictions = predictionsMatch ? parseInt(predictionsMatch[1]) : 0;
    const skipCandidates = skipMatch ? parseInt(skipMatch[1]) : 0;

    await ctx.reply(
      `✅ **Analysis Complete**\n\n` +
      `📊 Results:\n` +
      `• Patterns: ${patterns}\n` +
      `• Bottlenecks: ${bottlenecks}\n` +
      `• Predictions: ${predictions}\n` +
      `• Skip Candidates: ${skipCandidates}\n\n` +
      `Use \`darwin patterns\` or \`darwin bottlenecks\` to view details.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    await ctx.reply(`❌ Analysis failed: ${error}`);
  }
}

// ==================== Main Router ====================

/**
 * Route darwin commands
 */
export async function routeDarwinCommand(ctx: Context, args: string[]): Promise<void> {
  if (args.length === 0) {
    await ctx.reply(
      '🌙 **Darwin Night Council Commands**\n\n' +
      '**Regular Commands:**\n' +
      '• `darwin status` - Latest run status\n' +
      '• `darwin themes` - Theme distribution\n' +
      '• `darwin history` - Recent runs\n' +
      '• `darwin detail <run_id>` - Run details\n' +
      '• `darwin feedback <idea_id> <reaction> [comment]` - Submit feedback\n\n' +
      '**Workflow Optimizer (v1.3):**\n' +
      '• `darwin patterns` - Show workflow patterns\n' +
      '• `darwin bottlenecks` - Show detected bottlenecks\n' +
      '• `darwin analyze` - Run pattern analysis now\n\n' +
      '**Night Commands (23:00-02:45):**\n' +
      '• `darwin STATUS` - Real-time status\n' +
      '• `darwin PRIORITY <theme>` - Boost theme\n' +
      '• `darwin PAUSE` - Pause execution\n' +
      '• `darwin RESUME` - Resume paused\n' +
      '• `darwin KILL` - Stop run (⚠️ requires confirmation)',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const command = args[0].toLowerCase();
  const restArgs = args.slice(1);

  switch (command) {
    case 'status':
      await handleDarwinStatus(ctx);
      break;

    case 'themes':
      await handleDarwinThemes(ctx);
      break;

    case 'history':
      await handleDarwinHistory(ctx);
      break;

    case 'detail':
      if (restArgs.length === 0) {
        await ctx.reply('❌ Usage: darwin detail <run_id>');
        return;
      }
      await handleDarwinDetail(ctx, restArgs[0]);
      break;

    case 'feedback':
      if (restArgs.length < 2) {
        await ctx.reply('❌ Usage: darwin feedback <idea_id> <reaction> [comment]');
        return;
      }
      await handleDarwinFeedback(ctx, restArgs[0], restArgs[1], restArgs.slice(2).join(' ') || undefined);
      break;

    // Workflow Optimizer commands (v1.3)
    case 'patterns':
      await handleDarwinPatterns(ctx);
      break;

    case 'bottlenecks':
      await handleDarwinBottlenecks(ctx);
      break;

    case 'analyze':
      await handleDarwinAnalyze(ctx);
      break;

    // Night commands
    case 'kill':
    case 'pause':
    case 'resume':
    case 'priority':
      await handleDarwinNightCommand(ctx, command, restArgs);
      break;

    default:
      await ctx.reply(`❌ Unknown darwin command: ${command}\n\nType \`darwin\` for help`, { parse_mode: 'Markdown' });
  }
}
