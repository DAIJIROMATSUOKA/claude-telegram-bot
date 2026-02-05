/**
 * Darwin Engine v1.2.2 - Schema Validator
 * Zod schemas for type-safe Darwin operations
 */

import { z } from 'zod';

// ==================== Enums ====================

export const DarwinTheme = z.enum([
  'product',
  'marketing',
  'operations',
  'strategy',
  'culture',
]);

export const DarwinModel = z.enum([
  'claude',
  'gemini',
  'chatgpt',
]);

export const DarwinRunStatus = z.enum([
  'running',
  'completed',
  'failed',
  'killed',
]);

export const DarwinMode = z.enum([
  'shadow',
  'active',
]);

export const DarwinIdeaStatus = z.enum([
  'pending',
  'top10',
  'posted',
  'archived',
]);

export const DarwinReaction = z.enum([
  'thumbs_up',
  'thumbs_down',
  'thinking',
  'fire',
]);

export const NightCommand = z.enum([
  'KILL',
  'PAUSE',
  'RESUME',
  'STATUS',
  'PRIORITY',
]);

// ==================== Database Schemas ====================

export const DarwinRun = z.object({
  run_id: z.string().regex(/^darwin_[0-9A-HJKMNP-TV-Z]{26}$/), // ULID
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
  status: DarwinRunStatus,
  mode: DarwinMode,
  themes_distribution: z.string(), // JSON string
  ideas_generated: z.number().int().min(0).default(0),
  ideas_evolved: z.number().int().min(0).default(0),
  message_posted: z.number().int().min(0).max(1).default(0),
  duration_seconds: z.number().int().min(0).nullable(),
  error: z.string().nullable(),
  version: z.string().default('v1.2.2'),
});

export const DarwinIdea = z.object({
  idea_id: z.string().regex(/^idea_[0-9A-HJKMNP-TV-Z]{26}$/), // ULID
  run_id: z.string().regex(/^darwin_[0-9A-HJKMNP-TV-Z]{26}$/),
  generation: z.number().int().min(0).max(1), // 0=initial, 1=evolved
  parent_id: z.string().regex(/^idea_[0-9A-HJKMNP-TV-Z]{26}$/).nullable(),
  model: DarwinModel,
  theme: DarwinTheme,
  title: z.string().max(256),
  content: z.string(),
  rationale: z.string().nullable(),
  score: z.number().min(0).max(1).default(0),
  rank: z.number().int().min(1).max(10).nullable(),
  status: DarwinIdeaStatus,
  created_at: z.string().datetime(),
});

export const DarwinFeedback = z.object({
  feedback_id: z.string().regex(/^feedback_[0-9A-HJKMNP-TV-Z]{26}$/),
  idea_id: z.string().regex(/^idea_[0-9A-HJKMNP-TV-Z]{26}$/),
  reaction: DarwinReaction,
  comment: z.string().nullable(),
  user_id: z.string(),
  created_at: z.string().datetime(),
});

export const DarwinSettings = z.object({
  key: z.string(),
  value: z.string(), // JSON string
  updated_at: z.string().datetime(),
  updated_by: z.string().nullable(),
});

// ==================== API Schemas ====================

export const ThemeDistribution = z.object({
  product: z.number().int().min(0),
  marketing: z.number().int().min(0),
  operations: z.number().int().min(0),
  strategy: z.number().int().min(0),
  culture: z.number().int().min(0),
}).refine(
  (dist) => {
    const total = dist.product + dist.marketing + dist.operations + dist.strategy + dist.culture;
    return total === 60;
  },
  { message: 'Theme distribution must sum to 60 ideas' }
);

export const IdeaGenerationRequest = z.object({
  theme: DarwinTheme,
  count: z.number().int().min(1).max(20),
  generation: z.number().int().min(0).max(1),
  parent_idea: z.string().nullable(),
  context: z.string().optional(),
});

export const IdeaGenerationResponse = z.object({
  idea_id: z.string(),
  theme: DarwinTheme,
  title: z.string(),
  content: z.string(),
  rationale: z.string(),
  model: DarwinModel,
  generation: z.number().int(),
  created_at: z.string().datetime(),
});

export const TOP10SelectionRequest = z.object({
  ideas: z.array(z.object({
    idea_id: z.string(),
    theme: DarwinTheme,
    title: z.string(),
    content: z.string(),
    score: z.number(),
  })).min(60).max(60),
});

export const TOP10SelectionResponse = z.object({
  top10: z.array(z.string()).length(10), // Array of idea_ids
  scores: z.record(z.string(), z.number()), // idea_id -> score
});

export const NightCommandRequest = z.object({
  command: NightCommand,
  args: z.record(z.string(), z.any()).optional(),
  issued_by: z.string(),
  issued_at: z.string().datetime(),
});

// ==================== Type Exports ====================

export type DarwinThemeType = z.infer<typeof DarwinTheme>;
export type DarwinModelType = z.infer<typeof DarwinModel>;
export type DarwinRunStatusType = z.infer<typeof DarwinRunStatus>;
export type DarwinModeType = z.infer<typeof DarwinMode>;
export type DarwinIdeaStatusType = z.infer<typeof DarwinIdeaStatus>;
export type DarwinReactionType = z.infer<typeof DarwinReaction>;
export type NightCommandType = z.infer<typeof NightCommand>;

export type DarwinRunType = z.infer<typeof DarwinRun>;
export type DarwinIdeaType = z.infer<typeof DarwinIdea>;
export type DarwinFeedbackType = z.infer<typeof DarwinFeedback>;
export type DarwinSettingsType = z.infer<typeof DarwinSettings>;

export type ThemeDistributionType = z.infer<typeof ThemeDistribution>;
export type IdeaGenerationRequestType = z.infer<typeof IdeaGenerationRequest>;
export type IdeaGenerationResponseType = z.infer<typeof IdeaGenerationResponse>;
export type TOP10SelectionRequestType = z.infer<typeof TOP10SelectionRequest>;
export type TOP10SelectionResponseType = z.infer<typeof TOP10SelectionResponse>;
export type NightCommandRequestType = z.infer<typeof NightCommandRequest>;

// ==================== Validation Helpers ====================

export function validateThemeDistribution(dist: unknown): ThemeDistributionType {
  return ThemeDistribution.parse(dist);
}

export function validateIdeaGeneration(req: unknown): IdeaGenerationRequestType {
  return IdeaGenerationRequest.parse(req);
}

export function validateTOP10Selection(req: unknown): TOP10SelectionRequestType {
  return TOP10SelectionRequest.parse(req);
}

export function validateNightCommand(req: unknown): NightCommandRequestType {
  return NightCommandRequest.parse(req);
}

// ==================== Default Values ====================

export const DEFAULT_THEME_DISTRIBUTION: ThemeDistributionType = {
  product: 12,
  marketing: 12,
  operations: 12,
  strategy: 12,
  culture: 12,
};

export const BALANCED_DISTRIBUTION: ThemeDistributionType = {
  product: 20,
  marketing: 20,
  operations: 20,
  strategy: 20,
  culture: 0, // Excluded per spec: "culture: 0 (balanced配分時)"
};
