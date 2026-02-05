/**
 * Auto-execute rules from CLAUDE.md
 *
 * This module detects patterns in messages and automatically executes
 * corresponding commands defined in CLAUDE.md.
 */

import type { Context } from "grammy";
import { exec } from "child_process";
import { promisify } from "util";
import { consultAICouncil } from '../utils/ai-council-helper';

const execAsync = promisify(exec);

/**
 * Check if message looks like a JARVIS specification/task instruction.
 * These should bypass auto-rules and go directly to Claude LLM.
 */
function looksLikeJarvisSpec(text: string): boolean {
  const t = text.trimStart();
  if (/^\[(JARVIS TASK|JARVIS MASTER TASK)\]/i.test(t)) return true;
  if (/^Goal:\s/m.test(text) && /^Deliverables:\s/m.test(text)) return true;
  return false;
}

// AI Council Configuration
const AI_COUNCIL_CONFIG = {
  enablePreImplementation: true,  // 実装前相談
  enablePeriodicCheck: true,       // 定期チェック (not yet implemented)
  enableErrorConsultation: true,   // エラー時相談 (not yet implemented)
  periodicCheckInterval: 30 * 60 * 1000, // 30分
  errorThreshold: 2,               // エラー2回で相談
};

// Track consultation history (in-memory)
const consultationHistory: Map<string, number> = new Map(); // taskHash -> timestamp

/**
 * Check if message matches any auto-execution rules and handle them.
 * Returns true if a rule was matched and executed (caller should not send to Claude).
 * Returns false if no rule matched (caller should proceed with normal Claude processing).
 */
export async function checkAutoRules(
  ctx: Context,
  message: string
): Promise<boolean> {
  try {
    // Guard: Skip auto-rules for JARVIS specification documents
    if (looksLikeJarvisSpec(message)) {
      console.log('[Auto-Rules] Detected JARVIS spec format - bypassing auto-rules');
      return false; // Pass directly to Claude LLM
    }

    // Rule 1: Task Time Tracking (開始/終了)
    if (await handleTaskTracking(ctx, message)) {
      return true;
    }

    // Rule 2: iPhone Alarm Setting (アラーム)
    if (await handleAlarmSetting(ctx, message)) {
      return true;
    }

    // Rule 3: Gemini Query (Geminiに聞く:)
    if (await handleGeminiQuery(ctx, message)) {
      return true;
    }

    // Rule 4: Obsidian Daily Note (【Obsidian】)
    if (await handleObsidianNote(ctx, message)) {
      return true;
    }

    // Rule 5: Toggl Report Commands (toggl今日/今週/先週)
    if (await handleTogglReport(ctx, message)) {
      return true;
    }

    // Rule 6: Reminder Commands (リマインダー)
    if (await handleReminder(ctx, message)) {
      return true;
    }

    // Rule 7: Calendar Event (カレンダー/予定)
    if (await handleCalendarEvent(ctx, message)) {
      return true;
    }

    // Rule 8: Twitter/X URL Auto-fetch (補助情報として取得、Claudeへの送信はブロックしない)
    await handleTwitterURL(ctx, message);

    // Rule 9: Proactive AI Council Consultation (実装前相談 - ブロックせずに相談結果をClaudeに渡す)
    await handlePreImplementationConsultation(ctx, message);

    // No rule matched
    return false;
  } catch (error) {
    console.error("Error in auto-rules:", error);
    return false;
  }
}

/**
 * Task Time Tracking: 開始/終了
 */
async function handleTaskTracking(
  ctx: Context,
  message: string
): Promise<boolean> {
  if (message.endsWith("開始")) {
    const taskName = message.slice(0, -2).trim(); // Remove "開始" and trim whitespace
    try {
      const { stdout } = await execAsync(
        `python3 /Users/daijiromatsuokam1/task-tracker.py start "${taskName}"`
      );
      await ctx.reply(stdout.trim());
      return true;
    } catch (error) {
      await ctx.reply(`❌ タスク計測エラー: ${error}`);
      return true;
    }
  }

  if (message.endsWith("終了") || message.endsWith("完了")) {
    const taskName = message.slice(0, -2).trim(); // Remove "終了" or "完了" and trim whitespace
    try {
      const { stdout } = await execAsync(
        `python3 /Users/daijiromatsuokam1/task-tracker.py end "${taskName}"`
      );
      await ctx.reply(stdout.trim());

      // Auto-check the task in AI_MEMORY if it exists in today's task list
      await autoCheckTaskInMemory(taskName);

      return true;
    } catch (error) {
      await ctx.reply(`❌ タスク計測エラー: ${error}`);
      return true;
    }
  }

  return false;
}

/**
 * iPhone Alarm Setting: アラーム
 */
async function handleAlarmSetting(
  ctx: Context,
  message: string
): Promise<boolean> {
  if (!message.startsWith("アラーム")) {
    return false;
  }

  // Parse time and label from message
  const parsed = parseAlarmMessage(message);
  if (!parsed) {
    await ctx.reply("❌ アラーム形式が不正です。例: アラーム19時エサ");
    return true;
  }

  const { time, label } = parsed;
  const iMessageFormat = `${time}|${label}`;

  try {
    // Send iMessage using osascript
    await execAsync(
      `osascript -e 'tell application "Messages" to send "${iMessageFormat}" to buddy "+818065560713"'`
    );
    await ctx.reply(`⏰ ${time}のアラーム（${label}）をセットしました！`);
    return true;
  } catch (error) {
    await ctx.reply(`❌ アラーム設定エラー: ${error}`);
    return true;
  }
}

/**
 * Parse alarm message and extract time + label
 * Examples:
 *   アラーム5時テスト → { time: "05:00", label: "テスト" }
 *   アラーム 5時 テスト → { time: "05:00", label: "テスト" }
 *   アラーム5:00テスト → { time: "05:00", label: "テスト" }
 *   アラーム 5:00 テスト → { time: "05:00", label: "テスト" }
 *   アラーム17時テスト → { time: "17:00", label: "テスト" }
 *   アラーム 17時 テスト → { time: "17:00", label: "テスト" }
 *   アラーム17:30テスト → { time: "17:30", label: "テスト" }
 *   アラーム 17:30 テスト → { time: "17:30", label: "テスト" }
 *   アラーム7時半テスト → { time: "07:30", label: "テスト" }
 *   アラーム 7時半 テスト → { time: "07:30", label: "テスト" }
 *   アラーム7時15分テスト → { time: "07:15", label: "テスト" }
 *   アラーム 7時15分 テスト → { time: "07:15", label: "テスト" }
 */
function parseAlarmMessage(message: string): { time: string; label: string } | null {
  // Remove "アラーム" prefix and trim any leading/trailing spaces
  const content = message.slice(4).trim();

  // 🔧 Pattern 1: X時Y分 ラベル (e.g., 7時15分テスト, 7時15分 テスト)
  // Most specific pattern - must come first
  const pattern1 = /^(\d{1,2})\s*時\s*(\d{1,2})\s*分\s*(.*)$/;
  const match1 = content.match(pattern1);
  if (match1 && match1[1] && match1[2]) {
    const hour = match1[1].padStart(2, "0");
    const minute = match1[2].padStart(2, "0");
    const label = match1[3].trim() || "アラーム";
    return { time: `${hour}:${minute}`, label };
  }

  // 🔧 Pattern 2: X時半 ラベル (e.g., 7時半テスト, 7時半 テスト)
  const pattern2 = /^(\d{1,2})\s*時\s*半\s*(.*)$/;
  const match2 = content.match(pattern2);
  if (match2 && match2[1]) {
    const hour = match2[1].padStart(2, "0");
    const label = match2[2].trim() || "アラーム";
    return { time: `${hour}:30`, label };
  }

  // 🔧 Pattern 3: HH:MM ラベル (e.g., 17:30テスト, 17:30 テスト, 5:00テスト, 5:00 テスト)
  const pattern3 = /^(\d{1,2})\s*:\s*(\d{2})\s*(.*)$/;
  const match3 = content.match(pattern3);
  if (match3 && match3[1] && match3[2]) {
    const hour = match3[1].padStart(2, "0");
    const minute = match3[2];
    const label = match3[3].trim() || "アラーム";
    return { time: `${hour}:${minute}`, label };
  }

  // 🔧 Pattern 4: X時 ラベル (e.g., 5時テスト, 5時 テスト, 17時テスト, 17時 テスト)
  // Least specific pattern - must come last
  const pattern4 = /^(\d{1,2})\s*時\s*(.*)$/;
  const match4 = content.match(pattern4);
  if (match4 && match4[1]) {
    const hour = match4[1].padStart(2, "0");
    const label = match4[2].trim() || "アラーム";
    return { time: `${hour}:00`, label };
  }

  return null;
}

/**
 * Export for testing
 */
export { parseAlarmMessage };

/**
 * Gemini Query: Geminiに聞く:
 */
async function handleGeminiQuery(
  ctx: Context,
  message: string
): Promise<boolean> {
  if (!message.startsWith("Geminiに聞く:")) {
    return false;
  }

  const question = message.slice(9).trim(); // Remove "Geminiに聞く:"
  if (!question) {
    await ctx.reply("❌ 質問を入力してください。");
    return true;
  }

  try {
    // Send typing indicator while waiting for Gemini
    await ctx.replyWithChatAction("typing");

    const { stdout } = await execAsync(
      `python3 /Users/daijiromatsuokam1/jarvis-gemini.py "${question}"`
    );
    await ctx.reply(stdout.trim());
    return true;
  } catch (error) {
    await ctx.reply(`❌ Geminiエラー: ${error}`);
    return true;
  }
}

/**
 * Twitter/X URL Auto-fetch (補助情報として取得)
 */
async function handleTwitterURL(
  ctx: Context,
  message: string
): Promise<void> {
  // Detect Twitter/X URLs
  const twitterURLPattern = /https?:\/\/(twitter\.com|x\.com)\/\w+\/status\/\d+/gi;
  const urls = message.match(twitterURLPattern);

  if (!urls || urls.length === 0) {
    return;
  }

  try {
    await ctx.replyWithChatAction("typing");

    for (const url of urls) {
      const content = await fetchTwitterContent(url);
      if (content) {
        await ctx.reply(`🐦 Twitter投稿内容:\n\n${content}`, {
          disable_web_page_preview: true,
        });
      }
    }
  } catch (error) {
    console.error("Error fetching Twitter content:", error);
    // エラーでも処理を続行
  }
}

/**
 * Fetch Twitter content using nitter.net or fxtwitter.com
 */
async function fetchTwitterContent(url: string): Promise<string | null> {
  // Try nitter.net first
  try {
    const nitterURL = url.replace(/https?:\/\/(twitter|x)\.com/, "https://nitter.net");
    const response = await fetch(nitterURL);

    if (response.ok) {
      const html = await response.text();
      const content = extractContentFromNitter(html);
      if (content) {
        return content;
      }
    }
  } catch (error) {
    console.error("Nitter fetch failed:", error);
  }

  // Try fxtwitter.com as fallback
  try {
    const fxURL = url.replace(/https?:\/\/(twitter|x)\.com/, "https://fxtwitter.com");
    const response = await fetch(fxURL);

    if (response.ok) {
      const html = await response.text();
      const content = extractContentFromFxTwitter(html);
      if (content) {
        return content;
      }
    }
  } catch (error) {
    console.error("FxTwitter fetch failed:", error);
  }

  return null;
}

/**
 * Extract tweet content from nitter.net HTML
 */
function extractContentFromNitter(html: string): string | null {
  try {
    // Extract tweet text from nitter HTML
    const tweetTextMatch = html.match(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!tweetTextMatch) return null;

    // Clean HTML tags and decode entities
    let text = tweetTextMatch[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();

    return text || null;
  } catch (error) {
    console.error("Error extracting from nitter:", error);
    return null;
  }
}

/**
 * Extract tweet content from fxtwitter.com HTML
 */
function extractContentFromFxTwitter(html: string): string | null {
  try {
    // Try to extract from meta description
    const metaMatch = html.match(/<meta property="og:description" content="([^"]*)">/);
    if (metaMatch && metaMatch[1]) {
      return metaMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
    }
    return null;
  } catch (error) {
    console.error("Error extracting from fxtwitter:", error);
    return null;
  }
}

/**
 * Obsidian Daily Note: 【Obsidian】
 */
async function handleObsidianNote(
  ctx: Context,
  message: string
): Promise<boolean> {
  if (!message.startsWith("【Obsidian】")) {
    return false;
  }

  const content = message.slice(11).trim(); // Remove "【Obsidian】"
  if (!content) {
    await ctx.reply("❌ 追記する内容を入力してください。");
    return true;
  }

  try {
    const { stdout } = await execAsync(
      `/Users/daijiromatsuokam1/obsidian-append.sh "${content.replace(/"/g, '\\"')}"`
    );
    await ctx.reply(stdout.trim());
    return true;
  } catch (error) {
    await ctx.reply(`❌ Obsidian追記エラー: ${error}`);
    return true;
  }
}

/**
 * Toggl Report Commands: toggl今日/今週/先週
 */
async function handleTogglReport(
  ctx: Context,
  message: string
): Promise<boolean> {
  // Not implemented yet
  return false;
}

/**
 * Reminder Commands: リマインダー
 */
async function handleReminder(
  ctx: Context,
  message: string
): Promise<boolean> {
  // Not implemented yet
  return false;
}

/**
 * Calendar Event: カレンダー/予定
 */
async function handleCalendarEvent(
  ctx: Context,
  message: string
): Promise<boolean> {
  // Not implemented yet
  return false;
}

/**
 * Auto-check task in AI_MEMORY when task tracking ends
 * Reads AI_MEMORY, finds today's task list, and marks the task as completed (✅)
 */
async function autoCheckTaskInMemory(taskName: string): Promise<void> {
  try {
    // Read current AI_MEMORY
    const { stdout: memoryContent } = await execAsync(
      "python3 /Users/daijiromatsuokam1/ai-memory-manager.py read"
    );

    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // e.g., 2026-02-02

    // Find the latest version of today's task list
    const lines = memoryContent.split('\n');
    let latestTaskSection: string[] = [];
    let latestVersion = -1;
    let inTodaySection = false;
    let currentSection: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect start of today's task section (any version)
      if (line.includes(`## ${dateStr} 今日やること`)) {
        inTodaySection = true;
        currentSection = [line];
        continue;
      }

      // If we're in a today section, collect lines
      if (inTodaySection) {
        // Stop when we hit another ## header or end of content
        if (line.startsWith('## ') && !line.includes(`${dateStr} 今日やること`)) {
          inTodaySection = false;

          // Extract version number if present
          const versionMatch = currentSection[0].match(/v(\d+)/);
          const version = versionMatch ? parseInt(versionMatch[1]) : 0;

          // Keep the highest version
          if (version > latestVersion) {
            latestVersion = version;
            latestTaskSection = [...currentSection];
          }
          currentSection = [];
        } else if (line.trim() !== '') {
          currentSection.push(line);
        }
      }
    }

    // Handle case where section is at the end of the file
    if (inTodaySection && currentSection.length > 0) {
      const versionMatch = currentSection[0].match(/v(\d+)/);
      const version = versionMatch ? parseInt(versionMatch[1]) : 0;
      if (version > latestVersion) {
        latestVersion = version;
        latestTaskSection = [...currentSection];
      }
    }

    // Check if the task exists in the latest section
    if (latestTaskSection.length === 0) {
      console.log(`No today's task list found for ${dateStr}`);
      return;
    }

    let taskFound = false;
    const updatedSection = latestTaskSection.map(line => {
      // Check if this line contains the exact task name (without ✅)
      const trimmedLine = line.trim();
      if (trimmedLine === `- ${taskName}` || trimmedLine === `- ✅ ${taskName}`) {
        taskFound = true;
        // If not already checked, add ✅
        if (!trimmedLine.startsWith('- ✅')) {
          return line.replace(`- ${taskName}`, `- ✅ ${taskName}`);
        }
      }
      return line;
    });

    // If task was found and updated, write to AI_MEMORY
    if (taskFound) {
      const newVersion = latestVersion + 1;
      const header = `## ${dateStr} 今日やること（最新版v${newVersion}）`;
      const taskLines = updatedSection.slice(1).join('\n'); // Skip the old header

      const updateContent = `---
**追加: ${dateStr} ${today.toTimeString().split(' ')[0].slice(0, 5)}**
${header}
${taskLines}`;

      await execAsync(
        `python3 /Users/daijiromatsuokam1/ai-memory-manager.py append "${updateContent.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
      );

      console.log(`✅ Auto-checked task "${taskName}" in AI_MEMORY (version ${newVersion})`);
    } else {
      console.log(`Task "${taskName}" not found in today's task list`);
    }
  } catch (error) {
    console.error(`Error auto-checking task in AI_MEMORY:`, error);
    // Don't throw - this is a background operation
  }
}

/**
 * Proactive AI Council Consultation - 実装前相談
 *
 * Detects implementation tasks and automatically consults AI Council before starting.
 * Does NOT block Claude processing - runs consultation in parallel and stores result.
 */
async function handlePreImplementationConsultation(
  ctx: Context,
  message: string
): Promise<void> {
  if (!AI_COUNCIL_CONFIG.enablePreImplementation) {
    return;
  }

  // Check if message is an implementation request
  if (!isImplementationRequest(message)) {
    return;
  }

  // Check if we should skip consultation
  if (shouldSkipConsultation(message)) {
    console.log('[AI Council] Skipping consultation (skip conditions met)');
    return;
  }

  // Check if we recently consulted on this task (within 10 minutes)
  const taskHash = simpleHash(message);
  const lastConsultation = consultationHistory.get(taskHash);
  const now = Date.now();

  if (lastConsultation && (now - lastConsultation) < 10 * 60 * 1000) {
    console.log('[AI Council] Skipping consultation (consulted within 10 minutes)');
    return;
  }

  try {
    // Mark consultation in progress
    consultationHistory.set(taskHash, now);

    const chatId = ctx.chat?.id;
    if (!chatId) {
      console.error('[AI Council] No chat ID available');
      return;
    }

    // SPAM PREVENTION: Don't notify user during implementation
    // Just log to console for debugging
    console.log('[AI Council] 🏛️ AI Councilに実装前相談中...');

    // Consult AI Council
    const question = `この実装タスクを開始します。設計上の懸念点や注意すべきポイントを教えてください。

タスク: ${message}

3人とも、簡潔に（3-5行以内で）重要なポイントのみを指摘してください。`;

    const result = await consultAICouncil(
      ctx.api,
      chatId,
      question,
      { sendToUser: false, includePrefix: false } // Don't send to user yet
    );

    // SPAM PREVENTION: Store advice in context instead of sending notification
    // The advice will be shown in the user's message via text handler
    console.log('[AI Council] 🏛️ AI Councilからの助言を取得しました');

    // Store consultation result in context for Claude to use
    // This will be picked up by the text handler
    (ctx as any).aiCouncilAdvice = result.advisorResponses;

    console.log('[AI Council] Pre-implementation consultation completed');
  } catch (error: any) {
    console.error('[AI Council] Consultation error:', error);
    console.error('[AI Council] Error message:', error?.message);
    console.error('[AI Council] Error stack:', error?.stack);

    const errorMsg = error?.message || 'Unknown error';
    await ctx.reply(`⚠️ AI Council相談中にエラーが発生しましたが、実装は継続します。\n\nエラー詳細: ${errorMsg}`);
  }
}

/**
 * Check if message is an implementation request
 */
function isImplementationRequest(message: string): boolean {
  const implementationKeywords = [
    '実装',
    '開発',
    '作成',
    '構築',
    '追加',
    'を作って',
    'を作る',
    'を実装',
    'を開発',
    'を構築',
    'システム',
    '機能',
    'API',
    'エンドポイント',
    'データベース',
    'テーブル',
    'マイグレーション',
  ];

  const lowerMessage = message.toLowerCase();

  // Check for implementation keywords
  const hasKeyword = implementationKeywords.some(keyword =>
    message.includes(keyword)
  );

  // Check for imperative patterns (命令形)
  const hasImperativePattern = /[てで](ください|欲しい|くれ|お願い)/.test(message) ||
    /[をに](作|実装|開発|構築|追加)/.test(message);

  return hasKeyword && hasImperativePattern;
}

/**
 * Check if we should skip consultation
 */
function shouldSkipConsultation(message: string): boolean {
  const skipKeywords = [
    '急いで',
    'すぐに',
    '即座に',
    '今すぐ',
    '相談不要',
    '相談なし',
    '直接',
  ];

  // Check for simple queries (not implementation)
  const simpleQueryKeywords = [
    '教えて',
    '何',
    'どう',
    'いつ',
    'どこ',
    'なぜ',
    '？',
    '?',
  ];

  const hasSkipKeyword = skipKeywords.some(keyword => message.includes(keyword));
  const isSimpleQuery = simpleQueryKeywords.some(keyword => message.includes(keyword)) &&
    message.length < 50; // Short questions are likely simple queries

  return hasSkipKeyword || isSimpleQuery;
}

/**
 * Simple hash function for deduplication
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}
