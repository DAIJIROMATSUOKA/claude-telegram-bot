#!/usr/bin/env bun
// Test script for Self-Audit Engine

import { performSelfAudit, getLatestAudit } from './src/meta-agent/self-audit.js';

console.log('🔍 Running Self-Audit Engine Test...\n');

try {
  // Perform audit
  const result = await performSelfAudit('./logs/bot.log');

  console.log('✅ Self-Audit Complete!\n');
  console.log('📊 Results:');
  console.log(`  Date: ${result.date}`);
  console.log(`  Error Count: ${result.error_count}`);
  console.log(`  Avg Response: ${result.avg_response_ms || 'N/A'}ms`);
  console.log(`  Satisfaction Score: ${result.satisfaction_score.toFixed(2)}`);
  console.log(`  Log File Size: ${result.log_file_size} bytes`);
  console.log(`  Total Messages: ${result.total_messages}`);
  console.log(`  Total Sessions: ${result.total_sessions}`);

  // Parse JSON fields
  const issues = JSON.parse(result.issues_found);
  const recommendations = JSON.parse(result.recommendations);

  console.log(`\n🔍 Issues Found: ${issues.length}`);
  if (issues.length > 0) {
    issues.forEach((issue: any, idx: number) => {
      console.log(`  ${idx + 1}. [${issue.severity}] ${issue.type}: ${issue.description}`);
    });
  }

  console.log(`\n💡 Recommendations: ${recommendations.length}`);
  if (recommendations.length > 0) {
    recommendations.forEach((rec: any, idx: number) => {
      console.log(`  ${idx + 1}. [${rec.priority}] ${rec.action}`);
      console.log(`     Reason: ${rec.reason}`);
    });
  }

  // Verify it was saved to DB
  console.log('\n📁 Verifying database save...');
  const latest = getLatestAudit();
  if (latest && latest.date === result.date) {
    console.log('✅ Successfully saved to database');
  } else {
    console.log('❌ Failed to save to database');
  }

} catch (error) {
  console.error('❌ Error running self-audit:', error);
  process.exit(1);
}
