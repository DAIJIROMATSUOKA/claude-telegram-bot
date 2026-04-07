import { createLogger } from "./logger";
const log = createLogger("x-summary");

/**
 * X (Twitter) URL要約パイプライン
 *
 * メッセージ中のX/Twitter URLを検出し、api.fxtwitter.comから
 * ツイート本文・メタ情報をJSON取得してプロンプトに注入する。
 *
 * - 認証不要（fxtwitter APIはキー不要）
 * - 従量課金ゼロ
 * - HTML scrapingではなくJSON APIで安定取得
 * - Claudeが自然に要約・コメントできるようコンテキスト注入
 */

const X_URL_PATTERN = /https?:\/\/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/gi;
const FETCH_TIMEOUT_MS = 10_000;

interface FxTweetAuthor {
  name: string;
  screen_name: string;
}

interface FxTweetMedia {
  photos?: { url: string }[];
  videos?: { url: string; thumbnail_url: string }[];
}

interface FxTweetArticleBlock {
  text: string;
  type: string;
}

interface FxTweetArticle {
  title: string;
  preview_text: string;
  content?: {
    blocks?: FxTweetArticleBlock[];
  };
}

interface FxTweet {
  text: string;
  author: FxTweetAuthor;
  created_at: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number | null;
  lang: string;
  media?: FxTweetMedia;
  quote?: FxTweet;
  article?: FxTweetArticle | null;
}

interface FxTweetResponse {
  code: number;
  tweet?: FxTweet;
}

/**
 * メッセージ中のX/Twitter URLを検出する。
 * マッチごとに { screenName, tweetId, originalUrl } を返す。
 */
function extractXURLs(message: string): { screenName: string; tweetId: string; originalUrl: string }[] {
  const results: { screenName: string; tweetId: string; originalUrl: string }[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex (gフラグ付きregexなので)
  X_URL_PATTERN.lastIndex = 0;
  while ((match = X_URL_PATTERN.exec(message)) !== null) {
    results.push({
      screenName: match[1]!,
      tweetId: match[2]!,
      originalUrl: match[0],
    });
  }
  return results;
}

/**
 * fxtwitter APIからツイート情報をJSON取得。
 * 失敗時はnull（メイン処理を止めない）。
 */
async function fetchTweet(screenName: string, tweetId: string): Promise<FxTweet | null> {
  try {
    const url = `https://api.fxtwitter.com/${screenName}/status/${tweetId}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'TelegramBot/1.0' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[X Summary] API returned ${response.status} for ${tweetId}`);
      return null;
    }

    const data = (await response.json()) as FxTweetResponse;
    if (data.code !== 200 || !data.tweet) {
      console.warn(`[X Summary] API response code ${data.code} for ${tweetId}`);
      return null;
    }

    return data.tweet;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.warn(`[X Summary] Timeout fetching tweet ${tweetId}`);
    } else {
      console.warn(`[X Summary] Fetch failed for ${tweetId}:`, error?.message || error);
    }
    return null;
  }
}

/**
 * X記事のcontent.blocksからテキストを抽出。
 * ブロックタイプに応じてMarkdown風に整形する。
 * content.blocksがなければpreview_textにフォールバック。
 */
function extractArticleText(article: FxTweetArticle): string {
  const blocks = article.content?.blocks;
  if (!blocks || blocks.length === 0) {
    return article.preview_text;
  }

  const parts: string[] = [];
  for (const block of blocks) {
    if (!block.text || block.text.trim() === '') continue;

    switch (block.type) {
      case 'header-one':
        parts.push(`\n## ${block.text}`);
        break;
      case 'header-two':
        parts.push(`\n### ${block.text}`);
        break;
      case 'header-three':
        parts.push(`\n#### ${block.text}`);
        break;
      case 'atomic':
        // メディア埋め込み等。タイムスタンプ("0:38"等)はスキップ
        if (!/^\d+:\d+$/.test(block.text.trim())) {
          parts.push(block.text);
        }
        break;
      default:
        // unstyled = 通常テキスト
        parts.push(block.text);
        break;
    }
  }

  return parts.join('\n\n');
}

/**
 * ツイート情報を人間可読な形式に整形。
 */
function formatTweet(tweet: FxTweet, originalUrl: string): string {
  const lines: string[] = [];

  lines.push(`@${tweet.author.screen_name} (${tweet.author.name})`);
  lines.push(`投稿日: ${tweet.created_at}`);
  lines.push('');

  // X記事（Article）形式の場合、タイトルと全文を抽出
  if (tweet.article) {
    lines.push(`📝 記事: ${tweet.article.title}`);
    lines.push('');
    const articleBody = extractArticleText(tweet.article);
    lines.push(articleBody);
  } else if (tweet.text) {
    lines.push(tweet.text);
  } else {
    lines.push('(テキストなし)');
  }

  // エンゲージメント
  const stats: string[] = [];
  if (tweet.likes) stats.push(`♥${tweet.likes.toLocaleString()}`);
  if (tweet.retweets) stats.push(`🔁${tweet.retweets.toLocaleString()}`);
  if (tweet.replies) stats.push(`💬${tweet.replies.toLocaleString()}`);
  if (tweet.views) stats.push(`👁${tweet.views.toLocaleString()}`);
  if (stats.length > 0) {
    lines.push('');
    lines.push(stats.join(' | '));
  }

  // メディア情報
  if (tweet.media) {
    const photoCount = tweet.media.photos?.length || 0;
    const videoCount = tweet.media.videos?.length || 0;
    if (photoCount > 0 || videoCount > 0) {
      const mediaParts: string[] = [];
      if (photoCount > 0) mediaParts.push(`写真${photoCount}枚`);
      if (videoCount > 0) mediaParts.push(`動画${videoCount}本`);
      lines.push(`[添付: ${mediaParts.join(', ')}]`);
    }
  }

  // 引用ツイート
  if (tweet.quote) {
    lines.push('');
    lines.push('── 引用元 ──');
    lines.push(`@${tweet.quote.author.screen_name}: ${tweet.quote.text}`);
  }

  lines.push('');
  lines.push(`URL: ${originalUrl}`);

  return lines.join('\n');
}

/**
 * メッセージにX/Twitter URLが含まれていれば、ツイート本文を取得してコンテキスト注入。
 * 含まれていなければ元メッセージをそのまま返す。
 * 失敗してもメイン処理は止めない（graceful degradation）。
 */
export async function maybeEnrichWithXSummary(message: string): Promise<string> {
  const urls = extractXURLs(message);
  if (urls.length === 0) {
    return message;
  }

  log.info(`[X Summary] ${urls.length}件のX URLを検出、取得中...`);
  const startTime = Date.now();

  // 複数URLは並列取得
  const results = await Promise.all(
    urls.map(async ({ screenName, tweetId, originalUrl }) => {
      const tweet = await fetchTweet(screenName, tweetId);
      if (!tweet) return null;
      return formatTweet(tweet, originalUrl);
    })
  );

  const validResults = results.filter((r): r is string => r !== null);
  const elapsed = Date.now() - startTime;

  if (validResults.length === 0) {
    log.info(`[X Summary] 取得失敗 (${elapsed}ms)、元メッセージで続行`);
    return message;
  }

  log.info(`[X Summary] ${validResults.length}件取得完了 (${elapsed}ms)`);

  const tweetContext = validResults.join('\n\n---\n\n');

  return message + `\n\n[X/TWITTER POST CONTENT]\n${tweetContext}\n[END X/TWITTER POST CONTENT]\n\nユーザーがX/Twitterの投稿URLを送信した。上記が投稿内容。URLだけで他に指示がなければ、投稿の要点を簡潔に要約して返答せよ。`;
}
