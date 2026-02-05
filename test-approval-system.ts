#!/usr/bin/env bun
/**
 * Test script for the approval system
 *
 * Usage: bun run test-approval-system.ts
 */

import { detectDangerousCommand, getDangerEmoji } from './src/utils/danger-detector';

console.log('=== Approval System Test ===\n');

// Test cases
const testCases = [
  // Critical level
  'rm -rf /',
  'rm -rf ~',
  'sudo rm -rf /var',
  ':(){ :|:& };:',
  'dd if=/dev/zero of=/dev/sda',
  'mkfs.ext4 /dev/sda1',

  // High level
  'rm -rf my-folder',
  'rm *.txt',
  'unlink important-file.txt',
  'chmod 777 /etc/passwd',
  'cat > /etc/hosts',

  // Medium level
  'rm old-file.txt',
  'trash unused-document.pdf',
  'git push --force',
  'git reset --hard HEAD~1',
  'docker rm my-container',
  'npm uninstall -g typescript',

  // Safe commands
  'ls -la',
  'cat file.txt',
  'echo "Hello World"',
  'npm install',
  'git status',
];

console.log('Testing dangerous command detection:\n');

for (const command of testCases) {
  const result = detectDangerousCommand(command);
  const emoji = getDangerEmoji(result.level);

  console.log(`${emoji} [${result.level.toUpperCase()}] ${command}`);

  if (result.isDangerous) {
    console.log(`   Needs approval: ${result.needsApproval ? 'YES' : 'NO'}`);
    for (const match of result.matches) {
      console.log(`   - ${match.description}`);
    }
  }

  console.log('');
}

console.log('=== Test Complete ===');
console.log('\nSummary:');
console.log(`- Total commands tested: ${testCases.length}`);

const criticalCount = testCases.filter(cmd => detectDangerousCommand(cmd).level === 'critical').length;
const highCount = testCases.filter(cmd => detectDangerousCommand(cmd).level === 'high').length;
const mediumCount = testCases.filter(cmd => detectDangerousCommand(cmd).level === 'medium').length;
const safeCount = testCases.filter(cmd => detectDangerousCommand(cmd).level === 'safe').length;

console.log(`- Critical: ${criticalCount}`);
console.log(`- High: ${highCount}`);
console.log(`- Medium: ${mediumCount}`);
console.log(`- Safe: ${safeCount}`);

console.log('\n✅ All tests completed successfully!');
