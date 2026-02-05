/**
 * Darwin Engine v1.2.2 - FITNESS 7-Axis Evaluator
 *
 * Scoring dimensions (0.0-1.0):
 * - Novelty (15%): How unique/innovative is this idea?
 * - Leverage (20%): Impact vs effort ratio
 * - Feasibility (20%): Can we actually implement this?
 * - Time-to-Signal (15%): How quickly will we see results?
 * - Strategic Fit (10%): Alignment with business goals
 * - Risk (10%): Downside potential (lower = better)
 * - Reusability (10%): Can this be applied elsewhere?
 */

export interface FitnessScores {
  novelty: number;           // 0.0-1.0
  leverage: number;          // 0.0-1.0
  feasibility: number;       // 0.0-1.0
  time_to_signal: number;    // 0.0-1.0
  strategic_fit: number;     // 0.0-1.0
  risk: number;              // 0.0-1.0 (inverted: lower risk = higher score)
  reusability: number;       // 0.0-1.0
  overall: number;           // Weighted average
}

export interface IdeaForEvaluation {
  title: string;
  content: string;
  rationale: string;
  theme: string;
}

/**
 * FITNESS 7-Axis Evaluator
 */
export class FitnessEvaluator {
  private weights = {
    novelty: 0.15,
    leverage: 0.20,
    feasibility: 0.20,
    time_to_signal: 0.15,
    strategic_fit: 0.10,
    risk: 0.10,
    reusability: 0.10,
  };

  /**
   * Evaluate idea across 7 FITNESS dimensions
   */
  async evaluate(idea: IdeaForEvaluation): Promise<FitnessScores> {
    const scores: FitnessScores = {
      novelty: this.scoreNovelty(idea),
      leverage: this.scoreLeverage(idea),
      feasibility: this.scoreFeasibility(idea),
      time_to_signal: this.scoreTimeToSignal(idea),
      strategic_fit: this.scoreStrategicFit(idea),
      risk: this.scoreRisk(idea),
      reusability: this.scoreReusability(idea),
      overall: 0,
    };

    // Calculate weighted overall score
    scores.overall =
      scores.novelty * this.weights.novelty +
      scores.leverage * this.weights.leverage +
      scores.feasibility * this.weights.feasibility +
      scores.time_to_signal * this.weights.time_to_signal +
      scores.strategic_fit * this.weights.strategic_fit +
      scores.risk * this.weights.risk +
      scores.reusability * this.weights.reusability;

    return scores;
  }

  /**
   * Novelty: Uniqueness and innovation
   */
  private scoreNovelty(idea: IdeaForEvaluation): number {
    let score = 0.5; // Base score

    // Keywords indicating innovation
    const innovationKeywords = [
      'breakthrough', 'revolutionary', 'unprecedented', 'novel',
      'innovative', 'disruptive', 'game-changing', 'first-of-its-kind',
      '新しい', '革新的', '画期的', '独創的'
    ];

    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();
    const keywordCount = innovationKeywords.filter(kw => text.includes(kw)).length;
    score += Math.min(0.3, keywordCount * 0.1);

    // Length and detail suggest thorough thinking
    const contentLength = idea.content.length + idea.rationale.length;
    score += Math.min(0.2, contentLength / 2000);

    return Math.min(1.0, score);
  }

  /**
   * Leverage: Impact vs effort ratio
   */
  private scoreLeverage(idea: IdeaForEvaluation): number {
    let score = 0.5; // Base score

    // High impact keywords
    const impactKeywords = [
      'scale', 'multiply', 'exponential', 'compound',
      'automate', 'systemize', 'leverage', 'amplify',
      '拡大', '増幅', '自動化', 'スケール'
    ];

    // Low effort keywords
    const efficiencyKeywords = [
      'simple', 'quick', 'easy', 'straightforward',
      'minimal', 'low-cost', 'existing', 'reuse',
      '簡単', '迅速', '低コスト', '既存'
    ];

    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    const impactCount = impactKeywords.filter(kw => text.includes(kw)).length;
    const efficiencyCount = efficiencyKeywords.filter(kw => text.includes(kw)).length;

    score += Math.min(0.3, impactCount * 0.1);
    score += Math.min(0.2, efficiencyCount * 0.1);

    return Math.min(1.0, score);
  }

  /**
   * Feasibility: Implementability
   */
  private scoreFeasibility(idea: IdeaForEvaluation): number {
    let score = 0.6; // Slightly optimistic base

    // Feasibility indicators
    const feasibleKeywords = [
      'proven', 'tested', 'existing', 'available',
      'ready', 'practical', 'achievable', 'realistic',
      '実証済み', '実績', '実現可能', '現実的'
    ];

    // Infeasibility red flags
    const infeasibleKeywords = [
      'requires significant', 'major investment', 'years to',
      'unrealistic', 'unproven', 'hypothetical', 'speculative',
      '大規模', '長期', '未検証'
    ];

    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    const feasibleCount = feasibleKeywords.filter(kw => text.includes(kw)).length;
    const infeasibleCount = infeasibleKeywords.filter(kw => text.includes(kw)).length;

    score += Math.min(0.3, feasibleCount * 0.1);
    score -= Math.min(0.4, infeasibleCount * 0.15);

    // Detailed rationale suggests thoughtful planning
    if (idea.rationale.length > 100) {
      score += 0.1;
    }

    return Math.max(0.1, Math.min(1.0, score));
  }

  /**
   * Time-to-Signal: Speed of feedback
   */
  private scoreTimeToSignal(idea: IdeaForEvaluation): number {
    let score = 0.5; // Base score

    // Fast feedback keywords
    const fastKeywords = [
      'immediately', 'quickly', 'within days', 'within weeks',
      'instant', 'rapid', 'fast', 'short-term',
      '即座', '迅速', '短期', 'すぐに'
    ];

    // Slow feedback keywords
    const slowKeywords = [
      'long-term', 'years', 'eventually', 'gradual',
      'delayed', 'slow', 'extended period',
      '長期', '数年', 'ゆっくり'
    ];

    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    const fastCount = fastKeywords.filter(kw => text.includes(kw)).length;
    const slowCount = slowKeywords.filter(kw => text.includes(kw)).length;

    score += Math.min(0.4, fastCount * 0.15);
    score -= Math.min(0.3, slowCount * 0.15);

    return Math.max(0.1, Math.min(1.0, score));
  }

  /**
   * Strategic Fit: Alignment with business goals
   */
  private scoreStrategicFit(idea: IdeaForEvaluation): number {
    let score = 0.5; // Base score

    // Theme-based strategic importance
    const themeWeights: Record<string, number> = {
      product: 0.9,      // High strategic value
      strategy: 0.85,
      marketing: 0.75,
      operations: 0.7,
      culture: 0.6,
    };

    score = themeWeights[idea.theme] || 0.5;

    // Strategic keywords
    const strategicKeywords = [
      'competitive advantage', 'market position', 'differentiation',
      'growth', 'expansion', 'strategic', 'mission', 'vision',
      '競争優位', '成長', '戦略的', '差別化'
    ];

    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();
    const keywordCount = strategicKeywords.filter(kw => text.includes(kw)).length;

    score += Math.min(0.3, keywordCount * 0.1);

    return Math.min(1.0, score);
  }

  /**
   * Risk: Downside potential (inverted: lower risk = higher score)
   */
  private scoreRisk(idea: IdeaForEvaluation): number {
    let score = 0.7; // Start with low risk assumption

    // Risk indicators (reduce score)
    const riskKeywords = [
      'risk', 'dangerous', 'failure', 'loss', 'damage',
      'irreversible', 'costly mistake', 'significant downside',
      'リスク', '危険', '損失', '失敗'
    ];

    // Risk mitigation (increase score)
    const mitigationKeywords = [
      'mitigate', 'safeguard', 'backup', 'reversible',
      'pilot', 'test', 'validate', 'low-risk',
      '軽減', 'セーフガード', 'テスト', '検証'
    ];

    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    const riskCount = riskKeywords.filter(kw => text.includes(kw)).length;
    const mitigationCount = mitigationKeywords.filter(kw => text.includes(kw)).length;

    score -= Math.min(0.5, riskCount * 0.15);
    score += Math.min(0.2, mitigationCount * 0.1);

    return Math.max(0.1, Math.min(1.0, score));
  }

  /**
   * Reusability: Applicability to other contexts
   */
  private scoreReusability(idea: IdeaForEvaluation): number {
    let score = 0.5; // Base score

    // Reusability keywords
    const reusableKeywords = [
      'template', 'framework', 'pattern', 'repeatable',
      'scalable', 'modular', 'adaptable', 'general',
      'テンプレート', 'フレームワーク', '汎用', '応用'
    ];

    // Specificity keywords (reduce reusability)
    const specificKeywords = [
      'specific to', 'only for', 'unique case', 'one-time',
      'custom', 'bespoke', 'specialized',
      '専用', '特殊', '一回限り'
    ];

    const text = (idea.title + ' ' + idea.content + ' ' + idea.rationale).toLowerCase();

    const reusableCount = reusableKeywords.filter(kw => text.includes(kw)).length;
    const specificCount = specificKeywords.filter(kw => text.includes(kw)).length;

    score += Math.min(0.4, reusableCount * 0.15);
    score -= Math.min(0.3, specificCount * 0.15);

    return Math.max(0.1, Math.min(1.0, score));
  }

  /**
   * Format scores for display
   */
  formatScores(scores: FitnessScores): string {
    return [
      `Overall: ${(scores.overall * 100).toFixed(1)}%`,
      `├─ Novelty: ${(scores.novelty * 100).toFixed(1)}% (15%)`,
      `├─ Leverage: ${(scores.leverage * 100).toFixed(1)}% (20%)`,
      `├─ Feasibility: ${(scores.feasibility * 100).toFixed(1)}% (20%)`,
      `├─ Time-to-Signal: ${(scores.time_to_signal * 100).toFixed(1)}% (15%)`,
      `├─ Strategic Fit: ${(scores.strategic_fit * 100).toFixed(1)}% (10%)`,
      `├─ Risk: ${(scores.risk * 100).toFixed(1)}% (10%)`,
      `└─ Reusability: ${(scores.reusability * 100).toFixed(1)}% (10%)`,
    ].join('\n');
  }
}
