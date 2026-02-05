/**
 * Gemini Tasks Sync Handler
 * GeminiがGoogle Tasksに作成した「MEMORY:+」タスクを監視し、AI_MEMORYに反映
 */

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

interface TaskItem {
  id: string;
  title: string;
  notes?: string;
  status: string;
  updated: string;
}

interface GoogleCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
  universe_domain: string;
}

const MEMORY_PREFIX = 'MEMORY:+';
const TASK_LIST_NAME = 'Jarvis Memory Queue';

/**
 * Google Tasks APIクライアント取得
 */
async function getTasksClient(credentialsPath: string) {
  const credentialsContent = await Bun.file(credentialsPath).text();
  const credentials: GoogleCredentials = JSON.parse(credentialsContent);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/tasks'],
  });

  const authClient = await auth.getClient();
  return google.tasks({ version: 'v1', auth: authClient as OAuth2Client });
}

/**
 * Google Docs APIクライアント取得
 */
export async function getDocsClient(credentialsPath: string) {
  const credentialsContent = await Bun.file(credentialsPath).text();
  const credentials: GoogleCredentials = JSON.parse(credentialsContent);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/documents'],
  });

  const authClient = await auth.getClient();
  return google.docs({ version: 'v1', auth: authClient as OAuth2Client });
}

/**
 * タスクリストIDを取得または作成
 */
async function getOrCreateTaskList(tasksClient: any): Promise<string> {
  // 既存のタスクリストを検索
  const taskLists = await tasksClient.tasklists.list();
  const existingList = taskLists.data.items?.find(
    (list: any) => list.title === TASK_LIST_NAME
  );

  if (existingList) {
    return existingList.id;
  }

  // 新規作成
  const newList = await tasksClient.tasklists.insert({
    requestBody: {
      title: TASK_LIST_NAME,
    },
  });

  return newList.data.id;
}

/**
 * MEMORY:+ で始まるタスクを取得
 */
async function getMemoryTasks(tasksClient: any, taskListId: string): Promise<TaskItem[]> {
  const response = await tasksClient.tasks.list({
    tasklist: taskListId,
    showCompleted: false,
    maxResults: 100,
  });

  const tasks = response.data.items || [];
  return tasks
    .filter((task: any) => task.title?.startsWith(MEMORY_PREFIX))
    .map((task: any) => ({
      id: task.id,
      title: task.title,
      notes: task.notes,
      status: task.status,
      updated: task.updated,
    }));
}

/**
 * AI_MEMORYに追記
 */
async function appendToMemory(
  docsClient: any,
  documentId: string,
  content: string
): Promise<void> {
  const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const formattedContent = `\n---\n**追加: ${timestamp}** (via Gemini)\n${content}\n`;

  await docsClient.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            text: formattedContent,
            location: {
              index: 1,
            },
          },
        },
      ],
    },
  });
}

/**
 * タスクを完了にする
 */
async function completeTask(
  tasksClient: any,
  taskListId: string,
  taskId: string
): Promise<void> {
  await tasksClient.tasks.update({
    tasklist: taskListId,
    task: taskId,
    requestBody: {
      id: taskId,
      status: 'completed',
    },
  });
}

/**
 * メイン処理: Tasks → AI_MEMORY同期
 */
export async function syncGeminiTasks(
  credentialsPath: string,
  documentId: string
): Promise<{ processed: number; errors: string[] }> {
  const errors: string[] = [];
  let processed = 0;

  try {
    const tasksClient = await getTasksClient(credentialsPath);
    const docsClient = await getDocsClient(credentialsPath);

    // タスクリスト取得/作成
    const taskListId = await getOrCreateTaskList(tasksClient);

    // MEMORY:+ タスクを取得
    const memoryTasks = await getMemoryTasks(tasksClient, taskListId);

    console.log(`[Gemini Tasks Sync] Found ${memoryTasks.length} memory tasks`);

    for (const task of memoryTasks) {
      try {
        // タイトルから「MEMORY:+」を除去
        const content = task.title.replace(MEMORY_PREFIX, '').trim();

        // ノートがあれば含める
        const fullContent = task.notes
          ? `${content}\n\n${task.notes}`
          : content;

        // AI_MEMORYに追記
        await appendToMemory(docsClient, documentId, fullContent);

        // タスクを完了にする
        await completeTask(tasksClient, taskListId, task.id);

        console.log(`[Gemini Tasks Sync] ✅ Processed: ${content}`);
        processed++;
      } catch (error) {
        const errorMsg = `Failed to process task "${task.title}": ${error}`;
        console.error(`[Gemini Tasks Sync] ❌ ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    console.log(`[Gemini Tasks Sync] Completed: ${processed} processed, ${errors.length} errors`);
  } catch (error) {
    const errorMsg = `Sync failed: ${error}`;
    console.error(`[Gemini Tasks Sync] ❌ ${errorMsg}`);
    errors.push(errorMsg);
  }

  return { processed, errors };
}

/**
 * CLI実行用
 */
if (import.meta.main) {
  const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH ||
    '/Users/daijiromatsuokam1/jarvis-docs-credentials.json';
  const documentId = process.env.AI_MEMORY_DOC_ID || '';

  if (!documentId) {
    console.error('❌ AI_MEMORY_DOC_ID environment variable is required');
    process.exit(1);
  }

  console.log('🔄 Starting Gemini Tasks sync...');
  syncGeminiTasks(credentialsPath, documentId)
    .then((result) => {
      console.log(`✅ Sync complete: ${result.processed} tasks processed`);
      if (result.errors.length > 0) {
        console.error(`⚠️  ${result.errors.length} errors occurred:`);
        result.errors.forEach((err) => console.error(`  - ${err}`));
      }
    })
    .catch((error) => {
      console.error('❌ Sync failed:', error);
      process.exit(1);
    });
}
