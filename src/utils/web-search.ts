import { createLogger } from "./logger";
const log = createLogger("web-search");

/**
 * ジェミー先行Web検索パイプライン
 *
 * 質問がWeb検索を必要としているかローカルヒューリスティックで判定し、
 * 必要な場合のみジェミー💎（Gemini 2.5 Flash + googleSearchRetrieval）で
 * 検索結果を取得してプロンプトに注入する。
 *
 * 全AIパス（Jarvis/croppy/gpt/council/ai session）で共有。
 * 従量課金ゼロ（Google AI Pro固定費）。
 */

// ========================================
// Web検索必要性の自動判定（ローカル、APIなし）
// ========================================

/** AIプレフィックスを除去して本文だけにする */
function stripPrefix(msg: string): string {
  return msg.replace(/^(?:croppy|gemini|gpt|council|all):\s*/i, '').trim();
}

/** 実装・コード系の指示かどうか（検索不要パターン） */
function isCodeTask(msg: string): boolean {
  // コードブロック含有
  if (/```/.test(msg)) return true;
  // ファイルパス含有
  if (/(?:src|scripts|tests)\/[\w\-\.\/]+\.(?:ts|js|json|sh|py|md)/.test(msg)) return true;
  // 実装系キーワード
  if (/(?:実装して|修正して|コードを|ファイルを|リファクタ|デバッグ|ビルド|コンパイル|テストを|commit|push|deploy|restart)/.test(msg)) return true;
  return false;
}

/**
 * メッセージがWeb検索を必要とするか判定。
 * ローカルヒューリスティックのみ。API呼び出しなし。
 */
export function needsWebSearch(message: string): boolean {
  const msg = stripPrefix(message);

  // 短すぎるメッセージはスキップ
  if (msg.length < 5) return false;

  // 除外: コード・実装系タスク
  if (isCodeTask(msg)) return false;

  // 時事・最新情報
  if (/(?:最新|最近|今日|今週|今月|今年|現在|latest|recent|today|current|now|this\s+(?:week|month|year))/i.test(msg)) return true;

  // 年号（2024-2030）
  if (/(?:202[4-9]|2030)/.test(msg)) return true;

  // 明示的な検索要求
  if (/(?:調べて|検索して|ググって|search|look\s*up|find\s+(?:out|info))/i.test(msg)) return true;

  // ニュース・イベント
  if (/(?:ニュース|リリース|発表|公開|発売|announced|released|launched|published)/i.test(msg)) return true;

  // 価格・相場
  if (/(?:いくら|何円|価格|値段|相場|料金|price|cost|how\s+much)/i.test(msg)) return true;

  // 事実確認系（誰が/いつ/どこで）
  if (/(?:誰が|いつ|どこで|who\s+(?:is|was|won|did)|when\s+(?:is|was|did)|where\s+(?:is|was|did))/i.test(msg)) return true;

  // 比較・ランキング
  if (/(?:ランキング|おすすめ|比較|一覧|ranking|best|top\s+\d|comparison|vs\.?)/i.test(msg)) return true;

  // URL含有（リンクについて聞いている）
  if (/https?:\/\//.test(msg)) return true;

  // 天気
  if (/(?:天気|weather|forecast)/.test(msg)) return true;

  return false;
}

// ========================================
// ジェミー💎によるWeb検索実行
// ========================================

const SEARCH_TIMEOUT_MS = 15_000;
const MAX_SEARCH_RESULT_LENGTH = 1000;

/**
 * ジェミー💎にWeb検索だけさせて結果を返す。
 * Gemini CLI経由（Google AI Pro定額サブスク）。従量課金ゼロ。
 * CLIのGeminiはデフォルトでGoogle Search Groundingが有効。
 * 失敗時はnull（メイン処理を止めない）。
 */
export async function searchWithGemini(query: string): Promise<string | null> {
  try {
    const { askGemini } = await import('./multi-ai');

    const searchPrompt = `以下の質問に答えるためにWeb検索し、検索で見つかった事実・データ・情報源のみを箇条書きで返せ。
自分の意見や分析は不要。検索結果の要点のみ。${MAX_SEARCH_RESULT_LENGTH}文字以内。

質問: ${query}`;

    const result = await askGemini(searchPrompt, SEARCH_TIMEOUT_MS);

    if (result.error) {
      console.warn('[Web Search] Gemini CLI検索失敗:', result.error);
      return null;
    }

    return result.output ? result.output.slice(0, MAX_SEARCH_RESULT_LENGTH) : null;
  } catch (error: any) {
    console.warn('[Web Search] Gemini CLI検索失敗:', error?.message || error);
    return null;
  }
}

// ========================================
// オーケストレーター
// ========================================

/**
 * メッセージにWeb検索が必要なら、ジェミーで検索してコンテキスト注入。
 * 不要なら元メッセージをそのまま返す。
 */
export async function maybeEnrichWithWebSearch(message: string): Promise<string> {
  const strippedMessage = stripPrefix(message);

  if (!needsWebSearch(strippedMessage)) {
    return message;
  }

  log.info('[Web Search] 検索必要と判定、ジェミー💎に問い合わせ中...');
  const startTime = Date.now();
  const results = await searchWithGemini(strippedMessage);
  const elapsed = Date.now() - startTime;

  if (!results) {
    log.info(`[Web Search] 結果なし (${elapsed}ms)、検索なしで続行`);
    return message;
  }

  log.info(`[Web Search] 取得完了 (${elapsed}ms, ${results.length}文字)`);

  return message + `\n\n[WEB SEARCH RESULTS]\n${results}\n[END WEB SEARCH RESULTS]`;
}
