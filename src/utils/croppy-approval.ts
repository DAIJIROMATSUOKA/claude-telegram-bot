/**
 * Croppy Approval System
 *
 * croppyが自動判断してGO/STOPを決定
 *
 * ⚠️ 従量課金API禁止
 * - callClaudeCLI() を使用（Telegram転送経由）
 * - ANTHROPIC_API_KEY は使わない
 */

import { callClaudeCLI, callMemoryGateway } from '../handlers/ai-router';
import { ulid } from 'ulidx';

export interface ApprovalInput {
  phase_name: string;
  jarvis_context: string;
  prerequisite_summary: {
    is_experiment: boolean;
    production_impact: boolean;
    is_urgent: boolean;
  };
  implementation_summary: string;
  test_results: 'pass' | 'fail';
  error_report: string | null;
}

export interface ApprovalResult {
  approved: boolean;
  reason: string;
  raw_response: string;
}

/**
 * croppyに判断を依頼（CLI経由 = 無料）
 */
export async function askCroppyApproval(input: ApprovalInput): Promise<ApprovalResult> {
  const TIMEOUT_MS = 15000; // 15秒タイムアウト
  const startTime = Date.now();

  let result: ApprovalResult;
  let didTimeout = false;
  let hadError = false;

  try {
    // プロンプト構築
    const prompt = buildApprovalPrompt(input);

    // callClaudeCLI()で呼び出し（従量課金API不使用）
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('CROPPY_TIMEOUT')), TIMEOUT_MS)
    );

    const responsePromise = callClaudeCLI(prompt, ''); // memoryPackは空

    const response = await Promise.race([responsePromise, timeoutPromise]);

    if (response.error) {
      throw new Error(`Croppy error: ${response.error}`);
    }

    // レスポンス解析
    result = parseApprovalResponse(response.content);
  } catch (error: any) {
    console.error('[Croppy Approval] Error:', error.message);

    didTimeout = error.message === 'CROPPY_TIMEOUT';
    hadError = true;

    // フェイルセーフ: エラー時は自動STOP
    result = {
      approved: false,
      reason: didTimeout ? 'タイムアウト' : 'croppy呼び出し失敗',
      raw_response: error.message,
    };
  }

  const executionTimeMs = Date.now() - startTime;

  // DBにログ保存
  await logApprovalDecision(input, result, executionTimeMs, didTimeout, hadError);

  return result;
}

/**
 * 判断プロンプト構築
 */
function buildApprovalPrompt(input: ApprovalInput): string {
  const systemPrompt = `[SYSTEM]
あなたはクロッピー🦞（Claude AI）です。
あなたの役割は「判断者」ではありません。
あなたは【事前に定義されたルールを機械的に適用する装置】です。
目的は「正解を出す」ことではなく、
「人（DJ）を呼ばずに進められるケースを安全に通す」ことです。
・80%の確信でGOしてよい
・1%でも不安があればSTOP
・迷ったらSTOP
・壊れていたらSTOP
あなたは裁量を持ちません。
判断基準は以下に限定されます。

[判断基準]

【GO条件】※すべて満たす場合のみGO
- テストがすべて通過している
- 実行時エラーが発生していない
- 従量課金APIを使用していない
  （ANTHROPIC_API_KEY / OPENAI_API_KEY / 有料外部APIは禁止）
- 仕様書の MUST 要件を満たしている
- 既存テストが壊れていない（破壊的変更なし）
- 不可逆な操作を含まない
  （データ削除・本番反映・取り消し不可操作なし）
- 外部ユーザーへの影響がない
- Jarvisが「判断前提サマリー」を明示している

【STOP条件】※1つでも該当したら即STOP
- テスト失敗
- エラーあり
- 従量課金API使用
- 仕様と明確に不一致
- 不可逆な操作を含む
- 外部影響あり（通知・課金・ユーザー変更など）
- リスクフラグあり
- 判断に必要な情報が不足している
- 判断前提サマリーが欠けている
- 少しでも迷いがある

[出力フォーマット（厳守）]
出力は必ず1行のみ。
GO: <短い理由>
または
STOP: <短い理由>
理由は10〜20文字程度。説明・補足・思考過程は禁止。`;

  const userPrompt = `
Phase: ${input.phase_name}

判断前提サマリー:
- 実験的機能: ${input.prerequisite_summary.is_experiment ? 'Yes' : 'No'}
- 本番影響: ${input.prerequisite_summary.production_impact ? 'Yes' : 'No'}
- 緊急性: ${input.prerequisite_summary.is_urgent ? 'Yes' : 'No'}

実装サマリー:
${input.implementation_summary}

テスト結果: ${input.test_results}

エラー報告:
${input.error_report || 'なし'}

Jarvisコンテキスト:
${input.jarvis_context}

判断してください。`;

  return systemPrompt + '\n\n' + userPrompt;
}

/**
 * レスポンス解析
 */
function parseApprovalResponse(content: string): ApprovalResult {
  const trimmed = content.trim();

  // GO/STOP判定
  const goMatch = trimmed.match(/^GO:\s*(.+)$/im);
  const stopMatch = trimmed.match(/^STOP:\s*(.+)$/im);

  if (goMatch && goMatch[1]) {
    return {
      approved: true,
      reason: goMatch[1].trim(),
      raw_response: trimmed,
    };
  }

  if (stopMatch && stopMatch[1]) {
    return {
      approved: false,
      reason: stopMatch[1].trim(),
      raw_response: trimmed,
    };
  }

  // フォーマット不正 → 自動STOP
  return {
    approved: false,
    reason: 'レスポンス形式不正',
    raw_response: trimmed,
  };
}

/**
 * 判断結果をDBにログ保存
 */
async function logApprovalDecision(
  input: ApprovalInput,
  result: ApprovalResult,
  executionTimeMs: number,
  didTimeout: boolean,
  hadError: boolean
): Promise<void> {
  try {
    const logId = ulid();
    const createdAt = new Date().toISOString();

    await callMemoryGateway('/v1/db/query', 'POST', {
      sql: `INSERT INTO approval_log (
              log_id, created_at, phase_name, jarvis_context,
              is_experiment, production_impact, is_urgent,
              implementation_summary, test_results, error_report,
              approved, reason, raw_response,
              execution_time_ms, timeout, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        logId,
        createdAt,
        input.phase_name,
        input.jarvis_context,
        input.prerequisite_summary.is_experiment ? 1 : 0,
        input.prerequisite_summary.production_impact ? 1 : 0,
        input.prerequisite_summary.is_urgent ? 1 : 0,
        input.implementation_summary,
        input.test_results,
        input.error_report,
        result.approved ? 1 : 0,
        result.reason,
        result.raw_response,
        executionTimeMs,
        didTimeout ? 1 : 0,
        hadError ? 1 : 0,
      ],
    });

    console.log('[Croppy] ログ保存成功:', { logId, approved: result.approved });
  } catch (error) {
    console.error('[Croppy] ログ保存失敗:', error);
    // ログ失敗は致命的ではないので処理継続
  }
}
