/**
 * Auto Review - コード変更後にジェミー💎が自動レビュー
 *
 * クロッピー🦞がファイル変更を含む応答をした後、
 * バックグラウンドでジェミー💎にdiffを投げてレビューさせる。
 * 問題があればTelegramに通知する。
 */

import { callGeminiAPI, callCodexCLI } from '../handlers/ai-router';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// コード変更を検出するパターン
const CODE_CHANGE_PATTERNS = [
  /(?:Edit|Write|Create)\s+(?:file|ファイル)/i,
  /✏️.*(?:Edit|Write)/,
  /📝.*(?:Write|Create)/,
  /file_path.*\.(?:ts|js|tsx|jsx|py|sh|json|yaml|yml|toml)/i,
  /```(?:typescript|javascript|python|bash|json)/,
];

/**
 * 応答にコード変更が含まれているか検出
 */
export function detectCodeChanges(response: string): boolean {
  return CODE_CHANGE_PATTERNS.some(pattern => pattern.test(response));
}

/**
 * git diffを取得
 */
async function getGitDiff(): Promise<string> {
  try {
    const { stdout } = await execAsync(
      'git diff --stat && echo "---" && git diff --no-color | head -200',
      {
        cwd: '/Users/daijiromatsuokam1/claude-telegram-bot',
        timeout: 10000,
        env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:' + (process.env.PATH || '') },
      }
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * ジェミー💎による自動レビュー
 *
 * @returns レビュー結果（問題があれば文字列、なければnull）
 */
export async function autoReviewWithGemini(
  response: string
): Promise<string | null> {
  // コード変更が検出されなければスキップ
  if (!detectCodeChanges(response)) {
    return null;
  }

  console.log('[Auto Review] 💎 Code changes detected, starting Gemini review...');

  const diff = await getGitDiff();
  if (!diff || diff.length < 20) {
    console.log('[Auto Review] 💎 No meaningful diff found, skipping');
    return null;
  }

  const reviewPrompt = `以下のgit diffをレビューしろ。問題がなければ「LGTM」とだけ答えろ。
問題がある場合のみ、具体的に指摘しろ（セキュリティ、バグ、型エラー、ロジックミス）。

ルール:
- 200文字以内で回答
- スタイルの指摘は不要
- 重大な問題のみ報告
- 問題なしなら「LGTM」

## diff
${diff.slice(0, 3000)}`;

  try {
    const result = await callGeminiAPI(reviewPrompt, '');

    if (result.error) {
      console.warn('[Auto Review] 💎 Gemini review failed:', result.error);
      return null;
    }

    const review = result.content.trim();

    // LGTMなら通知不要
    if (/^LGTM$/i.test(review) || review.toLowerCase().includes('lgtm')) {
      console.log('[Auto Review] 💎 LGTM - no issues found');
      return null;
    }

    console.log('[Auto Review] 💎 Issues found:', review.slice(0, 100));

    // 重大な変更（diffが大きい）場合はチャッピーにも確認（council review）
    if (diff.length > 1000) {
      const chappyReview = await councilReviewWithChappy(diff);
      if (chappyReview) {
        return `💎 ジェミーレビュー:\n${review}\n\n🧠 チャッピーレビュー:\n${chappyReview}`;
      }
    }

    return `💎 ジェミーレビュー:\n${review}`;
  } catch (error) {
    console.warn('[Auto Review] 💎 Review error:', error);
    return null;
  }
}

/**
 * チャッピー🧠によるセカンドオピニオン（大きな変更時のみ）
 */
async function councilReviewWithChappy(diff: string): Promise<string | null> {
  try {
    console.log('[Auto Review] 🧠 Large change detected, getting Chappy second opinion...');

    const reviewPrompt = `以下のgit diffをレビューしろ。問題がなければ「LGTM」とだけ答えろ。
重大なバグ、セキュリティ問題、ロジックミスのみ指摘しろ。

ルール:
- 200文字以内
- スタイルの指摘は不要
- 問題なしなら「LGTM」

## diff
${diff.slice(0, 3000)}`;

    const result = await callCodexCLI(reviewPrompt, '');

    if (result.error || !result.content) {
      console.warn('[Auto Review] 🧠 Chappy review failed:', result.error);
      return null;
    }

    const review = result.content.trim();

    if (/^LGTM$/i.test(review) || review.toLowerCase().includes('lgtm')) {
      console.log('[Auto Review] 🧠 Chappy: LGTM');
      return null;
    }

    return review;
  } catch (error) {
    console.warn('[Auto Review] 🧠 Chappy review error:', error);
    return null;
  }
}
