#!/usr/bin/env tsx
/**
 * CLI Runner for Test Generator Engine
 *
 * Phase 5-1: Generate Golden Tests from Accident Patterns using AI
 *
 * Usage:
 *   npm run generate:test <accident-pattern-id>
 *   tsx src/scripts/generate-golden-test.ts ACC-006-NEW-ACCIDENT
 */

import { TestGeneratorEngine } from '../autopilot/test-generator';
import { SEED_ACCIDENT_PATTERNS } from '../autopilot/golden-test-seed-data';
import type { AccidentPattern } from '../autopilot/golden-test-types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('🤖 Golden Test Generator - Phase 5-1\n');
    console.log('Usage: npm run generate:test <accident-pattern-id>');
    console.log('       npm run generate:test --all\n');
    console.log('Available Accident Patterns:');
    SEED_ACCIDENT_PATTERNS.forEach(pattern => {
      console.log(`  - ${pattern.pattern_id}: ${pattern.title}`);
    });
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY not found in environment variables');
    process.exit(1);
  }

  const engine = new TestGeneratorEngine(apiKey);

  if (args[0] === '--all') {
    console.log('🔄 Generating tests for all accident patterns...\n');
    await generateAllTests(engine);
  } else {
    const patternId = args[0];
    await generateSingleTest(engine, patternId);
  }
}

async function generateSingleTest(engine: TestGeneratorEngine, patternId: string) {
  const pattern = SEED_ACCIDENT_PATTERNS.find(p => p.pattern_id === patternId);

  if (!pattern) {
    console.error(`❌ Accident pattern not found: ${patternId}`);
    console.log('\nAvailable patterns:');
    SEED_ACCIDENT_PATTERNS.forEach(p => {
      console.log(`  - ${p.pattern_id}: ${p.title}`);
    });
    process.exit(1);
  }

  console.log('🤖 AI Golden Test Generator\n');
  console.log(`Accident Pattern: ${pattern.pattern_id}`);
  console.log(`Title: ${pattern.title}`);
  console.log(`Severity: ${pattern.severity}`);
  console.log(`Blast Radius: ${pattern.blast_radius}\n`);

  console.log('🔄 Generating test using Claude...\n');

  const result = await engine.generateTest({
    accident_pattern: pattern,
    llm_provider: 'claude',
    validate: true,
  });

  if (!result.success) {
    console.error('❌ Test generation failed:', result.error);
    if (result.validation_result && !result.validation_result.is_valid) {
      console.error('\n🚨 Validation Issues:');
      result.validation_result.issues.forEach(issue => {
        console.error(`  [${issue.severity.toUpperCase()}] ${issue.issue}`);
        console.error(`    → ${issue.suggestion}`);
      });
    }
    process.exit(1);
  }

  console.log(`✅ Test generated successfully in ${result.generation_time_ms}ms\n`);

  if (result.golden_test) {
    console.log('📋 Generated Golden Test:');
    console.log(`  Test ID: ${result.golden_test.test_id}`);
    console.log(`  Title: ${result.golden_test.title}`);
    console.log(`  Given: ${result.golden_test.given}`);
    console.log(`  When: ${result.golden_test.when}`);
    console.log(`  Then: ${result.golden_test.then}`);
    console.log(`  Selection Score: ${result.golden_test.selection_score.toFixed(2)}`);
    console.log(`  Kill Switch: ${result.golden_test.kill_switch_threshold}\n`);
  }

  if (result.validation_result) {
    if (result.validation_result.warnings.length > 0) {
      console.log('⚠️  Warnings:');
      result.validation_result.warnings.forEach(w => console.log(`  - ${w}`));
      console.log('');
    }
  }

  if (result.test_function_code) {
    console.log('📝 Generated Test Function:');
    console.log('─'.repeat(80));
    console.log(result.test_function_code);
    console.log('─'.repeat(80));
    console.log('');

    // Ask user if they want to save
    console.log('💾 Save test to file?');
    console.log('  1. Save to seed data (recommended)');
    console.log('  2. Save to standalone file');
    console.log('  3. Skip\n');

    // For automation, auto-save to standalone file
    saveStandaloneTest(pattern.pattern_id, result.test_function_code);
  }

  console.log('\n🎉 Generation complete!');
  process.exit(0);
}

async function generateAllTests(engine: TestGeneratorEngine) {
  console.log(`Generating ${SEED_ACCIDENT_PATTERNS.length} tests...\n`);

  let succeeded = 0;
  let failed = 0;

  for (const pattern of SEED_ACCIDENT_PATTERNS) {
    console.log(`\n🔄 Generating test for ${pattern.pattern_id}...`);

    const result = await engine.generateTest({
      accident_pattern: pattern,
      llm_provider: 'claude',
      validate: true,
    });

    if (result.success) {
      console.log(`✅ Success: ${result.golden_test?.test_id} (${result.generation_time_ms}ms)`);
      succeeded++;

      if (result.test_function_code) {
        saveStandaloneTest(pattern.pattern_id, result.test_function_code);
      }
    } else {
      console.error(`❌ Failed: ${result.error}`);
      failed++;
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('📊 Generation Summary');
  console.log('═'.repeat(80));
  console.log(`  Total: ${SEED_ACCIDENT_PATTERNS.length}`);
  console.log(`  Succeeded: ${succeeded} ✅`);
  console.log(`  Failed: ${failed} ❌`);
  console.log(`  Success Rate: ${((succeeded / SEED_ACCIDENT_PATTERNS.length) * 100).toFixed(1)}%`);
  console.log('═'.repeat(80));

  process.exit(failed > 0 ? 1 : 0);
}

function saveStandaloneTest(patternId: string, testCode: string) {
  const outputDir = path.join(process.cwd(), 'generated-tests');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `${patternId.toLowerCase()}-test.ts`;
  const filepath = path.join(outputDir, filename);

  const fullCode = `/**
 * Auto-generated Golden Test
 * Source: ${patternId}
 * Generated: ${new Date().toISOString()}
 */

${testCode}

// Export for test runner
export { test${patternId.replace(/[-]/g, '')} };
`;

  fs.writeFileSync(filepath, fullCode, 'utf-8');
  console.log(`💾 Saved to: ${filepath}`);
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
