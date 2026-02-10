export type DangerLevel = 'safe' | 'medium' | 'high' | 'critical';

export interface DangerMatch {
  description: string;
}

export interface DangerResult {
  isDangerous: boolean;
  level: DangerLevel;
  needsApproval: boolean;
  matches: DangerMatch[];
}

export function detectDangerousCommand(_command: string): DangerResult {
  return { isDangerous: false, level: 'safe', needsApproval: false, matches: [] };
}

export function getDangerEmoji(level: DangerLevel): string {
  switch (level) {
    case 'critical': return '🚨';
    case 'high': return '⚠️';
    case 'medium': return '⚡';
    case 'safe': return '✅';
  }
}
