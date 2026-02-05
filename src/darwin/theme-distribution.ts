/**
 * Darwin Engine v1.2.2 - Theme Distribution
 * Manages distribution of 60 ideas across 5 themes
 */

import type { ThemeDistributionType, DarwinThemeType } from './schema-validator';
import { BALANCED_DISTRIBUTION } from './schema-validator';

// ==================== Distribution Strategies ====================

export type DistributionStrategy = 'balanced' | 'weighted' | 'custom';

/**
 * Get theme distribution based on strategy
 */
export function getThemeDistribution(
  strategy: DistributionStrategy,
  customWeights?: Partial<Record<DarwinThemeType, number>>
): ThemeDistributionType {
  switch (strategy) {
    case 'balanced':
      return BALANCED_DISTRIBUTION;

    case 'weighted':
      // Weighted distribution based on historical performance
      // (Can be enhanced with feedback data)
      return {
        product: 15,
        marketing: 15,
        operations: 15,
        strategy: 10,
        culture: 5,
      };

    case 'custom':
      if (!customWeights) {
        throw new Error('Custom weights required for custom distribution strategy');
      }
      return createCustomDistribution(customWeights);

    default:
      return BALANCED_DISTRIBUTION;
  }
}

/**
 * Create custom distribution from partial weights
 * Normalizes to sum to 60
 */
export function createCustomDistribution(
  weights: Partial<Record<DarwinThemeType, number>>
): ThemeDistributionType {
  const themes: DarwinThemeType[] = ['product', 'marketing', 'operations', 'strategy', 'culture'];

  // Calculate total weight
  const totalWeight = themes.reduce((sum, theme) => sum + (weights[theme] || 0), 0);

  if (totalWeight === 0) {
    throw new Error('Total weight cannot be zero');
  }

  // Normalize to 60 ideas
  const distribution: any = {};
  let assigned = 0;

  for (let i = 0; i < themes.length; i++) {
    const theme = themes[i]!;
    const weight = weights[theme] || 0;

    if (i === themes.length - 1) {
      // Last theme gets remaining ideas to ensure sum = 60
      distribution[theme] = 60 - assigned;
    } else {
      const count = Math.round((weight / totalWeight) * 60);
      distribution[theme] = count;
      assigned += count;
    }
  }

  return distribution as ThemeDistributionType;
}

/**
 * Apply priority themes to distribution
 * Boosts specified themes by reducing others proportionally
 */
export function applyPriorityThemes(
  baseDistribution: ThemeDistributionType,
  priorityThemes: DarwinThemeType[],
  boostAmount: number = 5
): ThemeDistributionType {
  if (priorityThemes.length === 0) {
    return baseDistribution;
  }

  const themes: DarwinThemeType[] = ['product', 'marketing', 'operations', 'strategy', 'culture'];
  const distribution: any = { ...baseDistribution };

  // Calculate total boost needed
  const totalBoost = priorityThemes.length * boostAmount;

  // Get non-priority themes
  const nonPriorityThemes = themes.filter(t => !priorityThemes.includes(t));

  if (nonPriorityThemes.length === 0) {
    // All themes are priority - no adjustment needed
    return baseDistribution;
  }

  // Calculate reduction per non-priority theme
  const reductionPerTheme = Math.floor(totalBoost / nonPriorityThemes.length);
  let remainingReduction = totalBoost - (reductionPerTheme * nonPriorityThemes.length);

  // Reduce non-priority themes
  for (const theme of nonPriorityThemes) {
    const reduction = reductionPerTheme + (remainingReduction > 0 ? 1 : 0);
    distribution[theme] = Math.max(0, distribution[theme] - reduction);
    if (remainingReduction > 0) remainingReduction--;
  }

  // Boost priority themes
  const boostPerPriority = Math.floor(totalBoost / priorityThemes.length);
  let remainingBoost = totalBoost - (boostPerPriority * priorityThemes.length);

  for (const theme of priorityThemes) {
    const boost = boostPerPriority + (remainingBoost > 0 ? 1 : 0);
    distribution[theme] = distribution[theme] + boost;
    if (remainingBoost > 0) remainingBoost--;
  }

  return distribution as ThemeDistributionType;
}

/**
 * Distribute ideas across models for parallel generation
 */
export function distributeAcrossModels(
  themeDistribution: ThemeDistributionType
): Record<'claude' | 'gemini' | 'chatgpt', Partial<Record<DarwinThemeType, number>>> {
  const themes: DarwinThemeType[] = ['product', 'marketing', 'operations', 'strategy', 'culture'];
  const models = ['claude', 'gemini', 'chatgpt'] as const;

  const modelDistributions: any = {
    claude: {},
    gemini: {},
    chatgpt: {},
  };

  // Distribute each theme across 3 models
  for (const theme of themes) {
    const totalCount = themeDistribution[theme];
    const perModel = Math.floor(totalCount / 3);
    const remainder = totalCount % 3;

    for (let i = 0; i < models.length; i++) {
      const model = models[i]!;
      modelDistributions[model][theme] = perModel + (i < remainder ? 1 : 0);
    }
  }

  return modelDistributions;
}

/**
 * Generate task list for idea generation
 * Returns array of { model, theme, count } tasks
 */
export interface GenerationTask {
  model: 'claude' | 'gemini' | 'chatgpt';
  theme: DarwinThemeType;
  count: number;
}

export function generateTaskList(
  themeDistribution: ThemeDistributionType
): GenerationTask[] {
  const modelDistributions = distributeAcrossModels(themeDistribution);
  const tasks: GenerationTask[] = [];

  for (const [model, themes] of Object.entries(modelDistributions)) {
    for (const [theme, count] of Object.entries(themes)) {
      if (count > 0) {
        tasks.push({
          model: model as 'claude' | 'gemini' | 'chatgpt',
          theme: theme as DarwinThemeType,
          count: count as number,
        });
      }
    }
  }

  return tasks;
}

/**
 * Validate distribution sums to 60
 */
export function validateDistributionSum(distribution: ThemeDistributionType): boolean {
  const sum = distribution.product + distribution.marketing +
              distribution.operations + distribution.strategy +
              distribution.culture;
  return sum === 60;
}

/**
 * Format distribution for display
 */
export function formatDistribution(distribution: ThemeDistributionType): string {
  return [
    `📦 Product: ${distribution.product}`,
    `📢 Marketing: ${distribution.marketing}`,
    `⚙️ Operations: ${distribution.operations}`,
    `🎯 Strategy: ${distribution.strategy}`,
    `🌟 Culture: ${distribution.culture}`,
  ].join('\n');
}

// ==================== Exports ====================

export {
  BALANCED_DISTRIBUTION,
  type ThemeDistributionType,
  type DarwinThemeType,
};
