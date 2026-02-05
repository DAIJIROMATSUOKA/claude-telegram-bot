#!/usr/bin/env node
/**
 * 朝のブリーフィングジョブ
 * cron経由で実行される
 */

import { ProactiveSecretary } from '../services/proactive-secretary.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .envファイルを読み込み
dotenv.config({ path: join(__dirname, '../../.env') });

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const allowedUsers = process.env.TELEGRAM_ALLOWED_USERS;

  if (!botToken || !allowedUsers) {
    console.error('[MorningBriefing] Error: TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USERS must be set');
    process.exit(1);
  }

  // TELEGRAM_ALLOWED_USERSから最初のユーザーIDを取得
  const chatId = allowedUsers.split(',')[0].trim();

  const secretary = new ProactiveSecretary(botToken, chatId);

  try {
    await secretary.morningBriefing();
    console.log('[MorningBriefing] Success');
    process.exit(0);
  } catch (error) {
    console.error('[MorningBriefing] Failed:', error);
    process.exit(1);
  }
}

main();
