/**
 * Danger Detection Module
 *
 * Detects dangerous commands/operations that require user approval
 */

/**
 * 危険なコマンドのパターン定義
 */
export interface DangerPattern {
  pattern: RegExp;
  level: 'critical' | 'high' | 'medium';
  description: string;
  confirmationPrompt: string;
}

/**
 * 危険コマンド検出結果
 */
export interface DangerDetectionResult {
  isDangerous: boolean;
  level: 'critical' | 'high' | 'medium' | 'safe';
  matches: Array<{
    pattern: string;
    description: string;
    confirmationPrompt: string;
  }>;
  needsApproval: boolean;
}

/**
 * 危険なコマンドパターンの定義
 */
const DANGER_PATTERNS: DangerPattern[] = [
  // Critical level - システムに致命的な影響
  {
    pattern: /rm\s+-rf\s+[\/~$]/,
    level: 'critical',
    description: 'ルートディレクトリまたはホームディレクトリの完全削除',
    confirmationPrompt: '⚠️ **危険な操作です！** システム全体または重要なディレクトリを削除しようとしています。本当に実行しますか？'
  },
  {
    pattern: /sudo\s+rm/,
    level: 'critical',
    description: 'root権限でのファイル削除',
    confirmationPrompt: '⚠️ **危険な操作です！** root権限でファイルを削除しようとしています。本当に実行しますか？'
  },
  {
    pattern: /:\(\)\{.*:\|:&\s*\};:/,
    level: 'critical',
    description: 'フォークボム（システムクラッシュ）',
    confirmationPrompt: '🚨 **システムクラッシュの危険があります！** フォークボムの実行を検出しました。実行を中止することを強く推奨します。'
  },
  {
    pattern: />\s*\/dev\/sd/,
    level: 'critical',
    description: 'ディスクデバイスへの直接書き込み',
    confirmationPrompt: '🚨 **データ損失の危険があります！** ディスクに直接書き込もうとしています。本当に実行しますか？'
  },
  {
    pattern: /mkfs\./,
    level: 'critical',
    description: 'ファイルシステムのフォーマット',
    confirmationPrompt: '🚨 **データ損失の危険があります！** ディスクをフォーマットしようとしています。本当に実行しますか？'
  },
  {
    pattern: /dd\s+if=/,
    level: 'critical',
    description: 'ddコマンド（データ破壊の可能性）',
    confirmationPrompt: '⚠️ **データ損失の危険があります！** ddコマンドは慎重に使用する必要があります。本当に実行しますか？'
  },

  // High level - 重要なファイル/データの削除
  {
    pattern: /rm\s+-rf/,
    level: 'high',
    description: '再帰的な強制削除',
    confirmationPrompt: '⚠️ ディレクトリを再帰的に削除しようとしています。本当に実行しますか？'
  },
  {
    pattern: /rm\s+.*\*|rm\s+.*\.{2,}/,
    level: 'high',
    description: 'ワイルドカード使用の削除',
    confirmationPrompt: '⚠️ ワイルドカードを使用してファイルを削除しようとしています。本当に実行しますか？'
  },
  {
    pattern: /unlink|shred/,
    level: 'high',
    description: 'ファイルの完全削除',
    confirmationPrompt: '⚠️ ファイルを完全に削除しようとしています。本当に実行しますか？'
  },
  {
    pattern: />\s*\/.+|cat\s+>\s*\/.+/,
    level: 'high',
    description: 'システムファイルの上書き',
    confirmationPrompt: '⚠️ システムファイルを上書きしようとしています。本当に実行しますか？'
  },
  {
    pattern: /chmod\s+777|chmod\s+-R/,
    level: 'high',
    description: '権限の大幅な変更',
    confirmationPrompt: '⚠️ ファイル権限を変更しようとしています。本当に実行しますか？'
  },

  // Medium level - 通常のファイル削除など
  {
    pattern: /rm\s+[^-]/,
    level: 'medium',
    description: '通常のファイル削除',
    confirmationPrompt: 'ファイルを削除しようとしています。よろしいですか？'
  },
  {
    pattern: /trash|mv\s+.*\/\.Trash/,
    level: 'medium',
    description: 'ゴミ箱への移動',
    confirmationPrompt: 'ファイルをゴミ箱に移動します。よろしいですか？'
  },
  {
    pattern: /git\s+push\s+--force|git\s+push\s+-f/,
    level: 'medium',
    description: 'Git強制プッシュ',
    confirmationPrompt: '⚠️ Gitリポジトリに強制プッシュしようとしています。本当に実行しますか？'
  },
  {
    pattern: /git\s+reset\s+--hard/,
    level: 'medium',
    description: 'Git Hard Reset',
    confirmationPrompt: '⚠️ Gitの履歴を強制的にリセットしようとしています。本当に実行しますか？'
  },
  {
    pattern: /docker\s+rm|docker\s+rmi/,
    level: 'medium',
    description: 'Dockerコンテナ/イメージの削除',
    confirmationPrompt: 'Dockerコンテナまたはイメージを削除しようとしています。よろしいですか？'
  },
  {
    pattern: /npm\s+uninstall\s+-g|yarn\s+global\s+remove/,
    level: 'medium',
    description: 'グローバルパッケージの削除',
    confirmationPrompt: 'グローバルパッケージを削除しようとしています。よろしいですか？'
  },
];

/**
 * コマンドから危険な操作を検出
 */
export function detectDangerousCommand(command: string): DangerDetectionResult {
  const matches: DangerDetectionResult['matches'] = [];
  let highestLevel: DangerDetectionResult['level'] = 'safe';

  // すべてのパターンをチェック
  for (const dangerPattern of DANGER_PATTERNS) {
    if (dangerPattern.pattern.test(command)) {
      matches.push({
        pattern: dangerPattern.pattern.source,
        description: dangerPattern.description,
        confirmationPrompt: dangerPattern.confirmationPrompt
      });

      // 最高レベルを更新
      if (highestLevel === 'safe' ||
          (dangerPattern.level === 'critical') ||
          (dangerPattern.level === 'high' && highestLevel !== 'critical') ||
          (dangerPattern.level === 'medium' && highestLevel === 'safe')) {
        highestLevel = dangerPattern.level;
      }
    }
  }

  return {
    isDangerous: matches.length > 0,
    level: highestLevel,
    matches,
    needsApproval: highestLevel === 'critical' || highestLevel === 'high'
  };
}

/**
 * メッセージから危険な操作を検出
 * (ユーザーメッセージから意図を推定)
 */
export function detectDangerousIntent(message: string): DangerDetectionResult {
  const lowerMessage = message.toLowerCase();
  const matches: DangerDetectionResult['matches'] = [];
  let highestLevel: DangerDetectionResult['level'] = 'safe';

  // 削除意図の検出
  const deleteKeywords = [
    'delete', '削除', '消して', 'remove', 'rm ',
    'unlink', 'trash', 'ゴミ箱', 'shred'
  ];

  const hasDeleteIntent = deleteKeywords.some(keyword =>
    lowerMessage.includes(keyword)
  );

  if (hasDeleteIntent) {
    // ワイルドカードや再帰的削除の検出
    if (lowerMessage.includes('all') ||
        lowerMessage.includes('すべて') ||
        lowerMessage.includes('全部') ||
        lowerMessage.includes('*')) {
      highestLevel = 'high';
      matches.push({
        pattern: 'bulk_delete',
        description: '複数ファイルの一括削除',
        confirmationPrompt: '⚠️ 複数のファイルを削除しようとしています。本当に実行しますか？'
      });
    } else {
      highestLevel = 'medium';
      matches.push({
        pattern: 'delete_intent',
        description: 'ファイル削除の意図',
        confirmationPrompt: 'ファイルを削除しようとしています。よろしいですか？'
      });
    }
  }

  // システム変更の検出
  const systemKeywords = [
    'format', 'フォーマット', 'reset', 'リセット',
    'reinstall', '再インストール', 'wipe', '消去'
  ];

  const hasSystemIntent = systemKeywords.some(keyword =>
    lowerMessage.includes(keyword)
  );

  if (hasSystemIntent) {
    highestLevel = 'critical';
    matches.push({
      pattern: 'system_modification',
      description: 'システムの大幅な変更',
      confirmationPrompt: '🚨 **システムに大きな影響を与える可能性があります！** 本当に実行しますか？'
    });
  }

  return {
    isDangerous: matches.length > 0,
    level: highestLevel,
    matches,
    needsApproval: highestLevel === 'critical' || highestLevel === 'high'
  };
}

/**
 * 危険レベルに応じた絵文字を取得
 */
export function getDangerEmoji(level: DangerDetectionResult['level']): string {
  switch (level) {
    case 'critical':
      return '🚨';
    case 'high':
      return '⚠️';
    case 'medium':
      return '⚡';
    default:
      return '✅';
  }
}

/**
 * 承認要求メッセージのフォーマット
 */
export function formatApprovalRequest(
  detection: DangerDetectionResult,
  context: string
): string {
  if (!detection.isDangerous) {
    return '';
  }

  const emoji = getDangerEmoji(detection.level);
  let message = `${emoji} **承認が必要な操作**\n\n`;

  // 検出された危険な操作をリスト化
  for (let i = 0; i < detection.matches.length; i++) {
    const match = detection.matches[i];
    if (!match) continue;

    message += `${i + 1}. ${match.description}\n`;
  }

  message += `\n**実行内容:**\n\`${context.slice(0, 200)}\`\n\n`;

  // 最も重大な警告を表示
  const mostSevereMatch = detection.matches[0];
  if (mostSevereMatch) {
    message += `${mostSevereMatch.confirmationPrompt}\n\n`;
  }

  return message;
}
