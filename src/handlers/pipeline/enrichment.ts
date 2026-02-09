/**
 * Enrichment Stage - メッセージの事前エンリッチメント
 *
 * X/Twitter URL → Web Search → Croppy Context → Tool Preloading
 * 各ステージは独立してテスト可能。
 */

import { maybeEnrichWithXSummary } from "../../utils/x-summary";
import { maybeEnrichWithWebSearch } from "../../utils/web-search";
import { buildCroppyPrompt } from "../../utils/croppy-context";
import { preloadToolContext, formatPreloadedContext } from "../../utils/tool-preloader";

export interface EnrichmentResult {
  message: string;
  enrichmentMs: number;
  xEnriched: boolean;
  webSearched: boolean;
  croppyInjected: boolean;
  preloadedContext: string;
}

/**
 * メッセージをエンリッチメント（事前情報付与）する
 */
export async function enrichMessage(
  message: string,
  userId: number
): Promise<EnrichmentResult> {
  const start = Date.now();
  let enrichedMessage = message;
  let xEnriched = false;
  let webSearched = false;
  let croppyInjected = false;

  // 1. X/Twitter URL Enrichment
  const messageBeforeX = enrichedMessage;
  enrichedMessage = await maybeEnrichWithXSummary(enrichedMessage);
  xEnriched = enrichedMessage !== messageBeforeX;

  // 2. Web Search (X URLが注入済みならスキップ)
  if (!xEnriched) {
    const messageBeforeSearch = enrichedMessage;
    enrichedMessage = await maybeEnrichWithWebSearch(enrichedMessage);
    webSearched = enrichedMessage !== messageBeforeSearch;
  }

  // 3. Croppy Context Injection
  if (enrichedMessage.trim().toLowerCase().startsWith('croppy:')) {
    console.log('[Enrichment] croppy: detected, injecting context...');
    const originalPrompt = enrichedMessage.slice(7).trim();
    enrichedMessage = 'croppy: ' + await buildCroppyPrompt(originalPrompt, userId);
    croppyInjected = true;
  }

  // 4. Tool Pre-Loading
  const preloaded = preloadToolContext(enrichedMessage);
  const preloadedContext = formatPreloadedContext(preloaded);
  if (preloadedContext && !croppyInjected) {
    enrichedMessage = enrichedMessage + '\n' + preloadedContext;
  }
  if (preloadedContext) {
    console.log(`[Enrichment] Loaded ${preloaded.length} context(s): ${preloaded.map(p => p.type).join(', ')}`);
  }

  return {
    message: enrichedMessage,
    enrichmentMs: Date.now() - start,
    xEnriched,
    webSearched,
    croppyInjected,
    preloadedContext,
  };
}
