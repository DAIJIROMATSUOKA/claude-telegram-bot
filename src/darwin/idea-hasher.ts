/**
 * Darwin Engine v1.2.2 - Idea Hasher & Consensus Detector
 *
 * Generates deterministic idea_id from theme + normalized_title
 * Detects when multiple models generate similar ideas (consensus)
 */

import { createHash } from 'crypto';

/**
 * Normalize title for hashing
 * - Lowercase
 * - Remove punctuation
 * - Trim whitespace
 * - Remove common stopwords
 */
export function normalizeTitle(title: string): string {
  let normalized = title.toLowerCase();

  // Remove punctuation
  normalized = normalized.replace(/[^\w\s]/g, ' ');

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Remove common stopwords (English + Japanese)
  const stopwords = [
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were',
    'を', 'の', 'に', 'は', 'が', 'と', 'で', 'や', 'も', 'する',
  ];

  const words = normalized.split(' ').filter(word => {
    return word.length > 0 && !stopwords.includes(word);
  });

  return words.join(' ');
}

/**
 * Generate idea_id hash from theme + normalized title
 * Format: idea_<hash>
 */
export function generateIdeaId(theme: string, title: string): string {
  const normalized = normalizeTitle(title);
  const input = `${theme}:${normalized}`;

  const hash = createHash('sha256')
    .update(input)
    .digest('hex')
    .substring(0, 26); // Same length as ULID for consistency

  return `idea_${hash}`;
}

/**
 * Generate consensus group hash (for grouping similar ideas)
 * Uses only normalized title (ignoring theme)
 */
export function generateConsensusGroup(title: string): string {
  const normalized = normalizeTitle(title);

  const hash = createHash('sha256')
    .update(normalized)
    .digest('hex')
    .substring(0, 16);

  return hash;
}

/**
 * Calculate similarity score between two titles (0.0-1.0)
 * Uses Jaccard similarity of word sets
 */
export function calculateTitleSimilarity(title1: string, title2: string): number {
  const words1 = new Set(normalizeTitle(title1).split(' '));
  const words2 = new Set(normalizeTitle(title2).split(' '));

  if (words1.size === 0 || words2.size === 0) return 0;

  // Jaccard similarity: intersection / union
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Detect consensus among ideas
 * Returns map of consensus_group -> idea_ids[]
 */
export function detectConsensus(
  ideas: Array<{ idea_id: string; title: string; theme: string; model: string }>
): Map<string, Array<{ idea_id: string; model: string }>> {
  const consensusGroups = new Map<string, Array<{ idea_id: string; model: string }>>();

  for (const idea of ideas) {
    const group = generateConsensusGroup(idea.title);

    if (!consensusGroups.has(group)) {
      consensusGroups.set(group, []);
    }

    consensusGroups.get(group)!.push({
      idea_id: idea.idea_id,
      model: idea.model,
    });
  }

  // Filter out single-idea groups (no consensus)
  for (const [group, members] of consensusGroups.entries()) {
    if (members.length <= 1) {
      consensusGroups.delete(group);
    }
  }

  return consensusGroups;
}

/**
 * Find consensus groups with threshold
 * Returns only groups where similarity >= threshold
 */
export function findConsensusWithThreshold(
  ideas: Array<{ idea_id: string; title: string; theme: string; model: string }>,
  threshold: number = 0.6
): Map<string, Array<{ idea_id: string; model: string; title: string }>> {
  const groups = new Map<string, Array<{ idea_id: string; model: string; title: string }>>();

  // Compare all pairs
  for (let i = 0; i < ideas.length; i++) {
    for (let j = i + 1; j < ideas.length; j++) {
      const idea1 = ideas[i]!;
      const idea2 = ideas[j]!;

      // Skip if same model (not consensus)
      if (idea1.model === idea2.model) continue;

      const similarity = calculateTitleSimilarity(idea1.title, idea2.title);

      if (similarity >= threshold) {
        // Create group key from both idea_ids (sorted)
        const groupKey = [idea1.idea_id, idea2.idea_id].sort().join(':');

        if (!groups.has(groupKey)) {
          groups.set(groupKey, [
            { idea_id: idea1.idea_id, model: idea1.model, title: idea1.title },
            { idea_id: idea2.idea_id, model: idea2.model, title: idea2.title },
          ]);
        }
      }
    }
  }

  return groups;
}

/**
 * Format consensus report
 */
export function formatConsensusReport(
  consensusGroups: Map<string, Array<{ idea_id: string; model: string; title?: string }>>
): string {
  if (consensusGroups.size === 0) {
    return '✅ No consensus detected - all ideas are unique';
  }

  const lines: string[] = [];
  lines.push(`🤝 Consensus Detected: ${consensusGroups.size} group(s)`);
  lines.push('');

  let groupNum = 1;
  for (const [group, members] of consensusGroups.entries()) {
    lines.push(`Group ${groupNum}: ${members.length} models agreed`);

    for (const member of members) {
      const title = member.title ? ` - ${member.title}` : '';
      lines.push(`  • ${member.model}${title}`);
    }

    lines.push('');
    groupNum++;
  }

  return lines.join('\n');
}

/**
 * Calculate consensus strength (0.0-1.0)
 * 3 models agree = 1.0
 * 2 models agree = 0.67
 * 1 model = 0.33
 */
export function calculateConsensusStrength(consensusCount: number): number {
  return Math.min(1.0, consensusCount / 3);
}

/**
 * Truncate text to max length with ellipsis
 */
export function truncateText(text: string, maxLength: number = 4096): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }

  // Truncate with ellipsis, leave room for "... (truncated)"
  const suffix = '... (truncated)';
  const truncated = text.substring(0, maxLength - suffix.length) + suffix;

  return { text: truncated, truncated: true };
}

/**
 * Truncate idea fields to meet 4096 total limit
 */
export interface TruncatedIdea {
  title: string;
  content: string;
  rationale: string;
  truncated: boolean;
}

export function truncateIdea(
  title: string,
  content: string,
  rationale: string,
  maxTotal: number = 4096
): TruncatedIdea {
  // Reserve space: title (max 256) + content (flexible) + rationale (flexible)
  const titleMax = 256;
  const overhead = 50; // Buffer for separators and metadata

  let finalTitle = title.substring(0, titleMax);
  let finalContent = content;
  let finalRationale = rationale;
  let truncated = title.length > titleMax;

  const remaining = maxTotal - finalTitle.length - overhead;

  // Split remaining space: 70% content, 30% rationale
  const contentMax = Math.floor(remaining * 0.7);
  const rationaleMax = remaining - contentMax;

  if (content.length > contentMax) {
    finalContent = content.substring(0, contentMax - 15) + '... (truncated)';
    truncated = true;
  }

  if (rationale.length > rationaleMax) {
    finalRationale = rationale.substring(0, rationaleMax - 15) + '... (truncated)';
    truncated = true;
  }

  return {
    title: finalTitle,
    content: finalContent,
    rationale: finalRationale,
    truncated,
  };
}
