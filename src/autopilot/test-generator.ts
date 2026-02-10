/**
 * Test Generator Engine - AI-Generated Golden Tests (Phase 5-1)
 *
 * Purpose: Automatically generate Golden Test functions from Accident Patterns
 * using LLM (Gemini free tier only - no pay-per-use APIs)
 *
 * Philosophy: "Automate test creation, maintain human oversight"
 */

import { askGemini } from '../utils/multi-ai';
import type { AccidentPattern, GoldenTest } from './golden-test-types';

/**
 * Test Generation Request
 */
export interface TestGenerationRequest {
  accident_pattern: AccidentPattern;
  validate?: boolean; // Run safety validation (default: true)
}

/**
 * Test Generation Result
 */
export interface TestGenerationResult {
  success: boolean;
  golden_test?: GoldenTest;
  test_function_code?: string;
  validation_result?: ValidationResult;
  error?: string;
  llm_provider: string;
  generation_time_ms: number;
}

/**
 * Validation Result
 */
export interface ValidationResult {
  is_valid: boolean;
  issues: ValidationIssue[];
  warnings: string[];
}

export interface ValidationIssue {
  severity: 'critical' | 'warning';
  issue: string;
  suggestion: string;
}

/**
 * Test Generator Engine
 *
 * Generates Golden Tests from Accident Patterns using Gemini (free tier)
 */
export class TestGeneratorEngine {
  constructor(_apiKey?: string) {
    // apiKeyは互換性のため残すが使用しない（CLI経由のため不要）
  }

  /**
   * Generate Golden Test from Accident Pattern
   */
  async generateTest(request: TestGenerationRequest): Promise<TestGenerationResult> {
    const startTime = Date.now();

    try {
      console.log(`[TestGenerator] Generating test for ${request.accident_pattern.pattern_id} using gemini`);

      // Generate test using Gemini
      const testFunction = await this.generateTestFunction(request.accident_pattern);

      // Create GoldenTest object
      const goldenTest = this.createGoldenTest(request.accident_pattern, testFunction);

      // Validate generated test (optional)
      let validationResult: ValidationResult | undefined;
      if (request.validate !== false) {
        validationResult = await this.validateGeneratedTest(goldenTest, testFunction);

        if (!validationResult.is_valid) {
          return {
            success: false,
            error: `Test validation failed: ${validationResult.issues.map(i => i.issue).join(', ')}`,
            validation_result: validationResult,
            llm_provider: 'gemini',
            generation_time_ms: Date.now() - startTime,
          };
        }
      }

      console.log(`[TestGenerator] Successfully generated ${goldenTest.test_id}`);

      return {
        success: true,
        golden_test: goldenTest,
        test_function_code: testFunction,
        validation_result: validationResult,
        llm_provider: 'gemini',
        generation_time_ms: Date.now() - startTime,
      };

    } catch (error) {
      console.error('[TestGenerator] Generation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        llm_provider: 'gemini',
        generation_time_ms: Date.now() - startTime,
      };
    }
  }

  /**
   * Generate test function using Gemini CLI
   */
  private async generateTestFunction(
    pattern: AccidentPattern
  ): Promise<string> {
    const prompt = this.buildPrompt(pattern);

    const result = await askGemini(prompt, 60_000);

    if (result.error) {
      throw new Error(`Gemini CLI error: ${result.error}`);
    }

    const text = result.output.trim();

    // Remove markdown code blocks if present
    return text.replace(/^```typescript\n/, '').replace(/^```\n/, '').replace(/\n```$/, '');
  }

  /**
   * Build prompt for LLM
   */
  private buildPrompt(pattern: AccidentPattern): string {
    return `You are a test engineer creating a Golden Test to prevent a past accident from recurring.

## Accident Pattern

**ID:** ${pattern.pattern_id}
**Title:** ${pattern.title}
**Description:** ${pattern.description}
**Severity:** ${pattern.severity}
**Blast Radius:** ${pattern.blast_radius}

**Root Cause:**
${pattern.root_cause}

**Trigger Conditions:**
${pattern.trigger_conditions.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Your Task

Write a TypeScript test function that:
1. Reproduces the accident conditions in a safe test environment
2. Validates that the system NOW correctly handles these conditions
3. Uses Given-When-Then format
4. Returns a clear pass/fail result

## Requirements

- **Function signature:** \`async function test${this.toPascalCase(pattern.pattern_id)}(): Promise<void>\`
- **Given:** Set up the initial conditions that led to the accident
- **When:** Perform the action that previously caused the accident
- **Then:** Assert that the system now handles it safely (throw Error if validation fails)
- **Use standard Node.js/TypeScript APIs** - no external test frameworks
- **Include clear error messages** when assertions fail
- **Add explanatory comments** for each section

## Example Format

\`\`\`typescript
async function testAccidentPrevention(): Promise<void> {
  // Given: Initial conditions that led to the accident
  const testData = setupDangerousCondition();

  // When: Perform the action that previously failed
  const result = await executeRiskyOperation(testData);

  // Then: Verify the system now handles it safely
  if (!result.success) {
    throw new Error('Expected safe handling, but operation failed');
  }

  if (result.sideEffects.length > 0) {
    throw new Error(\`Unexpected side effects: \${result.sideEffects.join(', ')}\`);
  }

  console.log('✅ Accident pattern prevented successfully');
}
\`\`\`

## Output Format

Return ONLY the TypeScript function code, with no markdown code blocks or explanations.
Start with \`async function test\` and end with the closing brace.`;
  }

  /**
   * Create GoldenTest object from generated test function
   */
  private createGoldenTest(pattern: AccidentPattern, testFunction: string): GoldenTest {
    // Calculate selection score (from Phase 3: 3-axis scoring)
    const severityScore = this.getSeverityScore(pattern.severity);
    const blastRadiusScore = this.getBlastRadiusScore(pattern.blast_radius);
    const frequencyScore = Math.min(pattern.occurrence_count / 10, 1.0);

    const selectionScore = severityScore * 0.5 + blastRadiusScore * 0.3 + frequencyScore * 0.2;

    // Determine kill switch threshold based on severity
    const killSwitchThreshold = this.getKillSwitchThreshold(pattern.severity);

    // Extract Given-When-Then from test function (heuristic)
    const { given, when, then } = this.extractGivenWhenThen(testFunction);

    const testId = `GT-GEN-${pattern.pattern_id.replace('ACC-', '')}`;

    return {
      test_id: testId,
      title: `Generated: ${pattern.title}`,
      description: `Auto-generated test to prevent: ${pattern.description}`,

      // Test selection criteria
      severity: pattern.severity,
      blast_radius: pattern.blast_radius,
      frequency: pattern.occurrence_count,
      selection_score: selectionScore,

      // Test structure (Given-When-Then)
      given,
      when,
      then,

      // Test execution
      test_function: testFunction,
      timeout_ms: 10000,

      // Flaky detection (initial state)
      flaky_status: 'stable',
      failure_count: 0,
      retry_count: 0,

      // Kill Switch integration
      kill_switch_threshold: killSwitchThreshold,

      // Coverage tracking
      accident_pattern_id: pattern.pattern_id,
      times_prevented: 0,

      // Metadata
      created_at: new Date().toISOString(),
      source: 'synthetic', // AI-generated
      tags: ['auto-generated', 'phase-5', pattern.severity],
    };
  }

  /**
   * Validate generated test function
   */
  private async validateGeneratedTest(
    test: GoldenTest,
    testFunction: string
  ): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];

    // Check 1: Function signature
    if (!testFunction.includes('async function test')) {
      issues.push({
        severity: 'critical',
        issue: 'Missing async function signature',
        suggestion: 'Function must start with "async function test"',
      });
    }

    // Check 2: Error handling
    if (!testFunction.includes('throw new Error')) {
      warnings.push('Test does not throw errors for failed assertions');
    }

    // Check 3: Given-When-Then comments
    const hasGiven = testFunction.includes('// Given:') || testFunction.includes('// GIVEN:');
    const hasWhen = testFunction.includes('// When:') || testFunction.includes('// WHEN:');
    const hasThen = testFunction.includes('// Then:') || testFunction.includes('// THEN:');

    if (!hasGiven || !hasWhen || !hasThen) {
      warnings.push('Missing Given-When-Then comment structure');
    }

    // Check 4: Dangerous operations
    const dangerousPatterns = [
      'rm -rf',
      'process.exit',
      'eval(',
      'child_process.exec',
    ];

    for (const pattern of dangerousPatterns) {
      if (testFunction.includes(pattern)) {
        issues.push({
          severity: 'critical',
          issue: `Dangerous operation detected: ${pattern}`,
          suggestion: 'Remove dangerous system calls from test function',
        });
      }
    }

    // Check 5: Syntax validation (basic)
    try {
      // Try to create a function (doesn't execute it)
      new Function(`return (${testFunction})`);
    } catch (error) {
      issues.push({
        severity: 'critical',
        issue: 'Syntax error in generated code',
        suggestion: `Fix syntax: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    return {
      is_valid: issues.filter(i => i.severity === 'critical').length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Extract Given-When-Then from test function (heuristic)
   */
  private extractGivenWhenThen(testFunction: string): {
    given: string;
    when: string;
    then: string;
  } {
    // Try to extract from comments
    const givenMatch = testFunction.match(/\/\/ Given:?\s*(.+)/i);
    const whenMatch = testFunction.match(/\/\/ When:?\s*(.+)/i);
    const thenMatch = testFunction.match(/\/\/ Then:?\s*(.+)/i);

    return {
      given: givenMatch ? givenMatch[1]!.trim() : 'Initial test conditions',
      when: whenMatch ? whenMatch[1]!.trim() : 'Execute test action',
      then: thenMatch ? thenMatch[1]!.trim() : 'Verify safe outcome',
    };
  }

  /**
   * Helper: Convert to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * Helper: Get severity score (0.0-1.0)
   */
  private getSeverityScore(severity: string): number {
    const scores: Record<string, number> = {
      low: 0.25,
      medium: 0.5,
      high: 0.75,
      critical: 1.0,
    };
    return scores[severity] || 0.5;
  }

  /**
   * Helper: Get blast radius score (0.0-1.0)
   */
  private getBlastRadiusScore(blastRadius: string): number {
    const scores: Record<string, number> = {
      file: 0.25,
      directory: 0.5,
      project: 0.75,
      system: 1.0,
    };
    return scores[blastRadius] || 0.5;
  }

  /**
   * Helper: Get kill switch threshold
   */
  private getKillSwitchThreshold(
    severity: string
  ): 'immediate' | 'delayed' | 'warning' {
    if (severity === 'critical') return 'immediate';
    if (severity === 'high') return 'immediate';
    if (severity === 'medium') return 'delayed';
    return 'warning';
  }
}
