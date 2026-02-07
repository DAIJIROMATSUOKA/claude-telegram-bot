/**
 * AI Router - Jarvisの司令塔
 *
 * プレフィックスで最適なAIを選択し、実行する
 *
 * 対応プレフィックス:
 * - "gpt: " → Codex CLI (ChatGPT)
 * - "gemini: " → Gemini API
 * - "croppy: " → Claude CLI
 * - "all: " → 3つ全部に投げて統合
 * - "council: " → AI Council（3つのAIに諮問 → Jarvisが統合判断）
 *
 * プレフィックスなし → Jarvis (デフォルト)
 */

export type AIProvider = 'jarvis' | 'gpt' | 'gemini' | 'croppy' | 'all' | 'council';

export interface RouteResult {
  provider: AIProvider;
  prompt: string; // プレフィックスを除いたプロンプト
}

/**
 * AIプロバイダーの表示名を取得
 */
export function getAIDisplayName(provider: AIProvider): string {
  switch (provider) {
    case 'jarvis':
      return 'Jarvis🤖';
    case 'gpt':
      return 'チャッピー🧠';
    case 'gemini':
      return 'ジェミー💎';
    case 'croppy':
      return 'クロッピー🦞';
    case 'all':
      return '🌟 All AIs';
    case 'council':
      return '🏛️ AI Council';
    default:
      return 'Unknown AI';
  }
}

export interface AIResponse {
  provider: AIProvider;
  content: string;
  error?: string;
}

/**
 * Memory Gateway URL
 */
const MEMORY_GATEWAY_URL = process.env.MEMORY_GATEWAY_URL || 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev';
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || '';

/**
 * Memory Gatewayへのリクエスト送信
 */
export async function callMemoryGateway(
  path: string,
  method: string,
  body?: any
): Promise<{ error?: string; data?: any }> {
  try {
    const response = await fetch(`${MEMORY_GATEWAY_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_API_KEY}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data = await response.json();
    return { data };
  } catch (error: any) {
    return { error: error.message };
  }
}

export interface AICouncilResponse {
  provider: 'council';
  advisorResponses: string;
  fullResponses: Array<AIResponse>;
}

/**
 * メッセージからプレフィックスを検出し、AIとプロンプトを分離
 */
export function parseRoutePrefix(message: string): RouteResult {
  const trimmed = message.trim();

  // プレフィックスパターン（大文字小文字を区別しない）
  const patterns: Array<{ regex: RegExp; provider: AIProvider }> = [
    { regex: /^gpt:\s*/i, provider: 'gpt' },
    { regex: /^gemini:\s*/i, provider: 'gemini' },
    { regex: /^croppy:\s*/i, provider: 'croppy' },
    { regex: /^all:\s*/i, provider: 'all' },
    { regex: /^council:\s*/i, provider: 'council' },
  ];

  for (const { regex, provider } of patterns) {
    if (regex.test(trimmed)) {
      const prompt = trimmed.replace(regex, '').trim();
      return { provider, prompt };
    }
  }

  // プレフィックスなし → Jarvis（デフォルト）
  return { provider: 'jarvis', prompt: trimmed };
}

/**
 * AI_MEMORYを取得（要約版）
 */
export async function getMemoryPack(
  credentialsPath: string,
  documentId: string
): Promise<string> {
  try {
    // 認証情報ファイルの存在確認
    const credentialsFile = Bun.file(credentialsPath);
    const exists = await credentialsFile.exists();
    if (!exists) {
      const errorMsg = `認証情報ファイルが見つかりません: ${credentialsPath}`;
      console.error('[AI Router]', errorMsg);
      return `(AI_MEMORY取得失敗: ${errorMsg})`;
    }

    const { getDocsClient } = await import('./gemini-tasks-sync');
    const docsClient = await getDocsClient(credentialsPath);

    const doc = await docsClient.documents.get({ documentId });

    let content = '';
    for (const element of doc.data.body?.content || []) {
      if (element.paragraph) {
        for (const textElement of element.paragraph.elements || []) {
          if (textElement.textRun) {
            content += textElement.textRun.content;
          }
        }
      }
    }

    console.log(`[AI Router] AI_MEMORY retrieved: ${content.length} chars`);

    // 長すぎる場合は要約（今後強化予定）
    if (content.length > 5000) {
      const lines = content.split('\n');
      const summary = lines.slice(0, 100).join('\n'); // 最初の100行
      return summary + '\n\n...(以下省略)';
    }

    return content;
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.error('[AI Router] Failed to get AI_MEMORY:', errorMsg);
    if (error?.status === 404) {
      return `(AI_MEMORY取得失敗: ドキュメントが見つかりません。Doc ID: ${documentId})`;
    }
    return `(AI_MEMORY取得失敗: ${errorMsg})`;
  }
}

/**
 * 子プロセスを非同期で実行（タイムアウト管理付き）
 */
async function execAsync(
  command: string,
  args: string[],
  options: { timeout: number; cwd: string }
): Promise<string> {
  const { spawn } = await import('child_process');

  console.log('[execAsync] Starting process:', command);
  console.log('[execAsync] Args count:', args.length);
  console.log('[execAsync] Timeout:', options.timeout);
  console.log('[execAsync] CWD:', options.cwd);

  return new Promise((resolve, reject) => {
    console.log('[execAsync] Creating spawn process...');
    const proc = spawn(command, args, {
      cwd: options.cwd,
      shell: true,
      env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:' + (process.env.PATH || '') },
    });

    console.log('[execAsync] Process spawned, PID:', proc.pid);

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      console.log('[execAsync] ⚠️ TIMEOUT! Killing process...');
      timedOut = true;
      proc.kill('SIGKILL');
    }, options.timeout);

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      console.log('[execAsync] stdout chunk received, length:', chunk.length);
      stdout += chunk;
    });

    proc.stderr?.on('data', (data) => {
      const chunk = data.toString();
      console.log('[execAsync] stderr chunk received:', chunk.slice(0, 200));
      stderr += chunk;
    });

    proc.on('close', (code) => {
      console.log('[execAsync] Process closed, code:', code);
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Process timed out after ${options.timeout}ms`));
      } else if (code !== 0) {
        reject(new Error(`Process exited with code ${code}: ${stderr}`));
      } else {
        console.log('[execAsync] Success! stdout length:', stdout.length);
        resolve(stdout);
      }
    });

    proc.on('error', (err) => {
      console.log('[execAsync] Process error event:', err.message);
      clearTimeout(timer);
      reject(err);
    });

    console.log('[execAsync] Event listeners attached, waiting for completion...');
  });
}

/**
 * Claude CLI でクロッピー🦞を呼び出し
 *
 * @param prompt プロンプト（文脈注入済みの場合もあり）
 * @param memoryPack AI_MEMORY（オプション）
 * @param skipContext 文脈を既に注入済みの場合はtrue
 * @param userId Telegram user ID（jarvis_context + chat_history取得用）
 */
export async function callClaudeCLI(
  prompt: string,
  memoryPack: string,
  skipContext: boolean = false,
  userId?: string | number
): Promise<AIResponse> {
  try {
    console.log('[AI Router] 🦞 Calling Claude CLI...');
    console.log('[AI Router] 🦞 memoryPack length:', memoryPack.length);
    console.log('[AI Router] 🦞 memoryPack preview:', memoryPack.slice(0, 200));
    console.log('[AI Router] 🦞 userId:', userId);

    // AGENTS.md（CLAUDE.md）をグローバル変数から取得
    const { AGENTS_MD_CONTENT } = await import('../index');

    // jarvis_context と chat_history を取得
    let jarvisContext: any = null;
    let chatHistory: any[] = [];

    if (userId && !skipContext) {
      const { getJarvisContext } = await import('../utils/jarvis-context');
      const { getChatHistory } = await import('../utils/chat-history');

      jarvisContext = await getJarvisContext(userId);
      chatHistory = await getChatHistory(userId, 50); // 直近50件

      console.log('[AI Router] 🦞 Context loaded:', {
        hasContext: !!jarvisContext,
        historyCount: chatHistory.length,
      });
    } else {
      console.log('[AI Router] 🦞 Context skipped (userId:', userId, 'skipContext:', skipContext, ')');
    }

    // フォールバック情報（取得失敗時に必ず含める）
    const fallbackInfo = `
プロジェクト: ~/claude-telegram-bot
従量課金API禁止（ANTHROPIC_API_KEY, OPENAI_API_KEY使用禁止）
`.trim();

    // 文脈セクションを構築
    const { formatContextForPrompt } = await import('../utils/jarvis-context');
    const { formatChatHistoryForPrompt } = await import('../utils/chat-history');

    const formattedContext = jarvisContext
      ? formatContextForPrompt(jarvisContext)
      : '（コンテキストなし）';

    const formattedHistory = chatHistory.length > 0
      ? formatChatHistoryForPrompt(chatHistory)
      : '（会話履歴なし）';

    // [SYSTEM] ブロックを構築 - 必ずフォールバック情報、AGENTS.md、jarvis_context、chat_historyを含める
    const systemBlock = `
[SYSTEM - 以下の情報を必ず最初に読み、全ての応答に反映すること]
${fallbackInfo}

${AGENTS_MD_CONTENT ? `# プロジェクトガイド（既知の場合はスキップ可）\n${AGENTS_MD_CONTENT}\n` : ''}
# 現在のコンテキスト
${formattedContext}

# 直近の会話（10件）
${formattedHistory}
[END SYSTEM]
`.trim();

    const systemPrompt = `あなたはクロッピー🦞（Croppy）です。

${systemBlock}

AI_MEMORYの内容を参照して、ユーザーの質問に答えてください。

## AI_MEMORY
${memoryPack}

重要な情報があれば、応答の最後に「[MEMORY]」タグで追記内容を示してください。

例:
応答内容...

[MEMORY] 追記したい重要な情報`;

    // フルプロンプトを作成
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;

    console.log('[AI Router] 🦞 Full prompt length:', fullPrompt.length);
    console.log('[AI Router] 🦞 Executing via temp file (safer than pipe)...');
    const startTime = Date.now();

    // Use temp file instead of echo pipe (avoids escaping issues)
    const fs = await import('fs/promises');
    const path = await import('path');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execPromise = promisify(exec);

    const tempFile = path.join('/tmp', `claude-prompt-${Date.now()}.txt`);

    try {
      // Write prompt to temp file
      await fs.writeFile(tempFile, fullPrompt, 'utf-8');

      // Execute claude with file input
      const { stdout, stderr } = await execPromise(
        `claude --model claude-opus-4-6 --print < ${tempFile}`,
        {
          timeout: 180000, // 180秒（3分）- クロッピー🦞のタイムアウト改善
          cwd: '/Users/daijiromatsuokam1',
          env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:' + (process.env.PATH || '') },
          maxBuffer: 10 * 1024 * 1024, // 10MB
        }
      );

      console.log(`[AI Router] 🦞 Claude CLI completed in ${Date.now() - startTime}ms`);
      console.log('[AI Router] 🦞 Output length:', stdout.length);
      console.log('[AI Router] 🦞 Output preview:', stdout.slice(0, 200));

      if (stderr) {
        console.log('[AI Router] 🦞 stderr:', stderr);
      }

      return {
        provider: 'croppy',
        content: stdout.trim(),
      };
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  } catch (error: any) {
    console.error('[AI Router] 🦞 Claude CLI error:', error.message);
    console.error('[AI Router] 🦞 Error stack:', error.stack);
    return {
      provider: 'croppy',
      content: '',
      error: `Claude CLI error: ${error.message}`,
    };
  }
}

/**
 * Gemini API を呼び出し
 */
export async function callGeminiAPI(
  prompt: string,
  memoryPack: string
): Promise<AIResponse> {
  try {
    console.log('[AI Router] 🔮 Calling Gemini API...');
    console.log('[AI Router] 🔮 memoryPack length:', memoryPack.length);
    console.log('[AI Router] 🔮 memoryPack preview:', memoryPack.slice(0, 200));
    console.log('[AI Router DEBUG] process.env.GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? `${process.env.GEMINI_API_KEY.slice(0, 10)}...` : 'NOT FOUND');

    const { GoogleGenerativeAI } = await import('@google/generative-ai');

    const apiKey = process.env.GEMINI_API_KEY;
    console.log('[AI Router DEBUG] apiKey after assignment:', apiKey ? `${apiKey.slice(0, 10)}...` : 'NOT FOUND');

    if (!apiKey) {
      console.error('[AI Router DEBUG] GEMINI_API_KEY is missing!');
      return {
        provider: 'gemini',
        content: '',
        error: 'GEMINI_API_KEY is not set',
      };
    }

    console.log('[AI Router DEBUG] Creating GoogleGenerativeAI instance...');

    const genAI = new GoogleGenerativeAI(apiKey);
    console.log('[AI Router DEBUG] GoogleGenerativeAI instance created');

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ googleSearchRetrieval: {} } as any],
    });
    console.log('[AI Router DEBUG] Model created (gemini-2.5-flash + Google Search)');

    const systemPrompt = `あなたはジェミー💎（Gemmy）です。

AI_MEMORYの内容を参照して、ユーザーの質問に答えてください。

## AI_MEMORY
${memoryPack}

重要な情報があれば、応答の最後に「[MEMORY]」タグで追記内容を示してください。

例:
応答内容...

[MEMORY] 追記したい重要な情報`;

    console.log('[AI Router DEBUG] Sending request to Gemini API...');
    const result = await model.generateContent(systemPrompt + '\n\n' + prompt);
    console.log('[AI Router DEBUG] Response received from Gemini API');

    const response = await result.response;
    const text = response.text();
    console.log('[AI Router DEBUG] Response text extracted, length:', text.length);

    return {
      provider: 'gemini',
      content: text,
    };
  } catch (error: any) {
    console.error('[AI Router] Gemini API error:', error);
    console.error('[AI Router DEBUG] Error type:', error.constructor.name);
    console.error('[AI Router DEBUG] Error message:', error.message);
    console.error('[AI Router DEBUG] Full error object:', JSON.stringify(error, null, 2));

    // エラーの詳細情報を含めてTelegramに返す（プレーンテキスト）
    const errorDetails = `
🔮 Gemini API Error Debug Info

Error Type: ${error.constructor.name}
Error Message: ${error.message}

Stack Trace:
${error.stack || 'N/A'}

Full Error Object:
${JSON.stringify(error, null, 2)}

Environment Check:
- GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? `Set (${process.env.GEMINI_API_KEY.slice(0, 10)}...)` : 'NOT SET'}
    `.trim();

    return {
      provider: 'gemini',
      content: errorDetails,
      error: `Gemini API error: ${error.message}`,
    };
  }
}

/**
 * Codex CLI でChatGPTを呼び出し
 */
export async function callCodexCLI(
  prompt: string,
  memoryPack: string
): Promise<AIResponse> {
  try {
    console.log('[AI Router] 🤖 Calling Codex CLI...');
    console.log('[AI Router] 🤖 memoryPack length:', memoryPack.length);
    console.log('[AI Router] 🤖 memoryPack preview:', memoryPack.slice(0, 200));

    const systemPrompt = `あなたはチャッピー🧠（Chappy）です。

AI_MEMORYの内容を参照して、ユーザーの質問に答えてください。

## AI_MEMORY
${memoryPack}

重要な情報があれば、応答の最後に「[MEMORY]」タグで追記内容を示してください。

例:
応答内容...

[MEMORY] 追記したい重要な情報`;

    // フルプロンプトを作成
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;

    console.log('[AI Router] 🤖 Full prompt length:', fullPrompt.length);
    console.log('[AI Router] 🤖 Executing via temp file (safer than pipe)...');
    const startTime = Date.now();

    // Use temp file instead of echo pipe (avoids escaping issues)
    const fs = await import('fs/promises');
    const path = await import('path');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execPromise = promisify(exec);

    const codexPath = '/Users/daijiromatsuokam1/claude-telegram-bot/node_modules/.bin/codex';
    const tempFile = path.join('/tmp', `codex-prompt-${Date.now()}.txt`);

    try {
      // Write prompt to temp file
      await fs.writeFile(tempFile, fullPrompt, 'utf-8');

      // Execute codex with file input
      const { stdout, stderr } = await execPromise(
        `${codexPath} exec --skip-git-repo-check < ${tempFile}`,
        {
          timeout: 180000, // 180秒（3分）- チャッピー🧠のタイムアウト改善
          cwd: '/Users/daijiromatsuokam1',
          env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:' + (process.env.PATH || '') },
          maxBuffer: 10 * 1024 * 1024, // 10MB
        }
      );

      console.log(`[AI Router] 🤖 Codex CLI completed in ${Date.now() - startTime}ms`);
      console.log('[AI Router] 🤖 Output length:', stdout.length);
      console.log('[AI Router] 🤖 Output preview:', stdout.slice(0, 200));

      if (stderr) {
        console.log('[AI Router] 🤖 stderr:', stderr);
      }

      return {
        provider: 'gpt',
        content: stdout.trim(),
      };
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  } catch (error: any) {
    console.error('[AI Router] 🤖 Codex CLI error:', error.message);
    console.error('[AI Router] 🤖 Error stack:', error.stack);
    return {
      provider: 'gpt',
      content: '',
      error: `Codex CLI error: ${error.message}`,
    };
  }
}

/**
 * テキストを指定文字数で切り詰める（文の途中で切らないようにする）
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // maxLengthより手前で最後の改行または句点を探す
  const truncated = text.slice(0, maxLength);
  const lastBreak = Math.max(
    truncated.lastIndexOf('\n'),
    truncated.lastIndexOf('。'),
    truncated.lastIndexOf('. ')
  );

  if (lastBreak > maxLength * 0.5) {
    return truncated.slice(0, lastBreak + 1) + '\n...(省略)';
  }

  return truncated + '...(省略)';
}

/**
 * 3つのAI全部に投げて統合
 */
export async function callAllAIs(
  prompt: string,
  memoryPack: string,
  userId?: string | number
): Promise<AIResponse> {
  console.log('[AI Router] 🌟 Calling all AIs...');
  console.log('[AI Router] 🌟 memoryPack for all AIs:');
  console.log('[AI Router] 🌟   - length:', memoryPack.length);
  console.log('[AI Router] 🌟   - preview:', memoryPack.slice(0, 300));
  console.log('[AI Router] 🌟   - contains error?:', memoryPack.includes('取得失敗'));
  console.log('[AI Router] 🌟   - full memoryPack:', memoryPack);

  // 各AI応答の最大文字数
  const MAX_RESPONSE_LENGTH = 500;

  // 順次実行（デバッグ用 - 並列だとどこでタイムアウトか分からない）
  console.log('[AI Router] 🌟 Starting Gemini first (fastest)...');
  console.log('[AI Router] 🌟 Passing memoryPack to Gemini:', { length: memoryPack.length, hasError: memoryPack.includes('取得失敗') });
  const geminiResponse = await callGeminiAPI(prompt, memoryPack);
  console.log('[AI Router] 🌟 Gemini done, result:', geminiResponse.error ? `ERROR: ${geminiResponse.error}` : 'OK');

  console.log('[AI Router] 🌟 Starting Claude CLI...');
  const claudeResponse = await callClaudeCLI(prompt, memoryPack, false, userId);
  console.log('[AI Router] 🌟 Claude done, result:', claudeResponse.error ? `ERROR: ${claudeResponse.error}` : 'OK');

  console.log('[AI Router] 🌟 Starting Codex CLI...');
  const gptResponse = await callCodexCLI(prompt, memoryPack);
  console.log('[AI Router] 🌟 Codex done, result:', gptResponse.error ? `ERROR: ${gptResponse.error}` : 'OK');

  // 統合結果を作成（各応答を500文字に切り詰め）
  let combined = '🌟 **All AIs Response**\n\n';

  if (claudeResponse.content) {
    const truncated = truncateText(claudeResponse.content, MAX_RESPONSE_LENGTH);
    combined += `## クロッピー🦞\n${truncated}\n\n`;
  } else if (claudeResponse.error) {
    combined += `## クロッピー🦞\n⚠️ ${claudeResponse.error}\n\n`;
  }

  if (geminiResponse.content) {
    const truncated = truncateText(geminiResponse.content, MAX_RESPONSE_LENGTH);
    combined += `## ジェミー💎\n${truncated}\n\n`;
  } else if (geminiResponse.error) {
    combined += `## ジェミー💎\n⚠️ ${geminiResponse.error}\n\n`;
  }

  if (gptResponse.content) {
    const truncated = truncateText(gptResponse.content, MAX_RESPONSE_LENGTH);
    combined += `## チャッピー🧠\n${truncated}\n\n`;
  } else if (gptResponse.error) {
    combined += `## チャッピー🧠\n⚠️ ${gptResponse.error}\n\n`;
  }

  return {
    provider: 'all',
    content: combined,
  };
}

/**
 * AI Council - 3つのAIに諮問してJarvisが統合判断
 */
export async function callAICouncil(
  prompt: string,
  memoryPack: string
): Promise<Omit<AICouncilResponse, 'provider'>> {
  console.log('[AI Council] 🏛️ Calling AI Council...');
  console.log('[AI Council] 🏛️ memoryPack length:', memoryPack.length);

  // 3つのAIに並行で諮問（個別エラーハンドリング付き）
  console.log('[AI Council] 🏛️ Consulting advisors in parallel with individual error handling...');

  // 各AIを個別にtry-catchでラップ + 10秒タイムアウト
  const callWithFallback = async (
    fn: () => Promise<AIResponse>,
    providerName: string
  ): Promise<AIResponse> => {
    console.log(`[AI Council] 🏛️ Starting ${providerName} call...`);
    const startTime = Date.now();

    try {
      // 210秒タイムアウト（個別AI呼び出し180秒 + バッファ30秒）
      const timeoutPromise = new Promise<AIResponse>((_, reject) =>
        setTimeout(() => reject(new Error('COUNCIL_TIMEOUT')), 210000)
      );

      const result = await Promise.race([fn(), timeoutPromise]);

      const duration = Date.now() - startTime;
      console.log(`[AI Council] 🏛️ ${providerName} completed in ${duration}ms`);
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      if (error.message === 'COUNCIL_TIMEOUT') {
        console.error(`[AI Council] COUNCIL_TIMEOUT: ${providerName} (${duration}ms)`);
        return {
          provider: providerName.toLowerCase() as any,
          content: '',
          error: `⚠️ Timeout (210s exceeded)`,
        };
      }

      console.error(`[AI Council] ${providerName} failed in ${duration}ms:`, error.message);
      return {
        provider: providerName.toLowerCase() as any,
        content: '',
        error: error.message || 'Unknown error',
      };
    }
  };

  // 並行実行（各AIのエラーは個別にキャッチ）
  const [geminiResponse, claudeResponse, gptResponse] = await Promise.all([
    callWithFallback(() => callGeminiAPI(prompt, memoryPack), 'Gemini'),
    callWithFallback(() => callClaudeCLI(prompt, memoryPack), 'Claude'),
    callWithFallback(() => callCodexCLI(prompt, memoryPack), 'GPT'),
  ]);

  console.log('[AI Council] 🏛️ All advisors responded (some may have errors)');
  console.log('[AI Council] 🏛️ Gemini:', geminiResponse.error ? `Error: ${geminiResponse.error}` : 'OK');
  console.log('[AI Council] 🏛️ Claude:', claudeResponse.error ? `Error: ${claudeResponse.error}` : 'OK');
  console.log('[AI Council] 🏛️ GPT:', gptResponse.error ? `Error: ${gptResponse.error}` : 'OK');

  // アドバイザーの応答をまとめる
  let advisorResponses = '## AI Council Advisors\n\n';

  if (claudeResponse.content) {
    advisorResponses += `### クロッピー🦞の意見\n${claudeResponse.content}\n\n`;
  } else if (claudeResponse.error) {
    advisorResponses += `### クロッピー🦞の意見\n⚠️ ${claudeResponse.error}\n\n`;
  }

  if (geminiResponse.content) {
    advisorResponses += `### ジェミー💎の意見\n${geminiResponse.content}\n\n`;
  } else if (geminiResponse.error) {
    advisorResponses += `### ジェミー💎の意見\n⚠️ ${geminiResponse.error}\n\n`;
  }

  if (gptResponse.content) {
    advisorResponses += `### チャッピー🧠の意見\n${gptResponse.content}\n\n`;
  } else if (gptResponse.error) {
    advisorResponses += `### チャッピー🧠の意見\n⚠️ ${gptResponse.error}\n\n`;
  }

  return {
    advisorResponses,
    fullResponses: [geminiResponse, claudeResponse, gptResponse],
  };
}

/**
 * AIルーター - メインエントリーポイント
 */
export async function routeToAI(
  provider: AIProvider,
  prompt: string,
  credentialsPath: string,
  documentId: string
): Promise<AIResponse | AICouncilResponse> {
  console.log(`[AI Router] Routing to: ${provider}`);

  // 1. Memory Pack取得
  const memoryPack = await getMemoryPack(credentialsPath, documentId);

  // 2. AI実行
  switch (provider) {
    case 'croppy':
      return callClaudeCLI(prompt, memoryPack);

    case 'gemini':
      return callGeminiAPI(prompt, memoryPack);

    case 'gpt':
      return callCodexCLI(prompt, memoryPack);

    case 'all':
      return callAllAIs(prompt, memoryPack);

    case 'council':
      const councilResult = await callAICouncil(prompt, memoryPack);
      return {
        provider: 'council',
        ...councilResult,
      };

    case 'jarvis':
    default:
      // Jarvis（デフォルト）は呼び出し元で処理
      return {
        provider: 'jarvis',
        content: '',
      };
  }
}

/**
 * AI応答からMEMORYタグを抽出してAI_MEMORYに追記
 */
export async function extractAndSaveMemory(
  response: AIResponse,
  credentialsPath: string,
  documentId: string
): Promise<void> {
  const memoryMatch = response.content.match(/\[MEMORY\]\s*(.+?)(?:\n|$)/s);

  if (!memoryMatch) {
    return; // MEMORYタグなし
  }

  const memoryContent = memoryMatch[1]!.trim();

  if (!memoryContent) {
    return;
  }

  try {
    const { getDocsClient } = await import('./gemini-tasks-sync');
    const docsClient = await getDocsClient(credentialsPath);

    const doc = await docsClient.documents.get({ documentId });
    const bodyContent = doc.data.body?.content;
    const endIndex = bodyContent?.[bodyContent.length - 1]?.endIndex;

    const timestamp = new Date().toISOString().split('T')[0];
    const source = response.provider === 'croppy' ? 'クロッピー🦞' :
                   response.provider === 'gemini' ? 'ジェミー💎' :
                   response.provider === 'gpt' ? 'チャッピー🧠' : 'AI';

    const appendText = `\n- [${timestamp}] (${source}) ${memoryContent}\n`;

    await docsClient.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              text: appendText,
              location: { index: (endIndex ?? 1) - 1 },
            },
          },
        ],
      },
    });

    console.log(`[AI Router] ✅ Saved to AI_MEMORY: ${memoryContent}`);
  } catch (error) {
    console.error('[AI Router] Failed to save memory:', error);
  }
}
