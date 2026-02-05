/**
 * AI_MEMORY自動整理スクリプト（Claude CLI版）
 *
 * 毎日深夜2時に実行:
 * 1. INBOXセクションを読み取り
 * 2. 重複を削除
 * 3. 重要な情報を上位セクションに昇格
 * 4. INBOXを短く保つ
 */

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { execSync } from 'child_process';

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

/**
 * Google Docs APIクライアント取得
 */
async function getDocsClient(credentialsPath: string) {
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
 * ドキュメント全体を取得
 */
async function getDocumentContent(docsClient: any, documentId: string): Promise<string> {
  const doc = await docsClient.documents.get({ documentId });

  let content = '';
  for (const element of doc.data.body.content || []) {
    if (element.paragraph) {
      for (const textElement of element.paragraph.elements || []) {
        if (textElement.textRun) {
          content += textElement.textRun.content;
        }
      }
    }
  }

  return content;
}

/**
 * ドキュメント全体を置き換え
 */
async function replaceDocumentContent(
  docsClient: any,
  documentId: string,
  newContent: string
): Promise<void> {
  // 1. ドキュメントの現在の長さを取得
  const doc = await docsClient.documents.get({ documentId });
  const endIndex = doc.data.body.content[doc.data.body.content.length - 1].endIndex - 1;

  // 2. 全文削除してから新規挿入
  await docsClient.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          deleteContentRange: {
            range: {
              startIndex: 1,
              endIndex: endIndex,
            },
          },
        },
        {
          insertText: {
            text: newContent,
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
 * Claude CLIを使ってAI_MEMORYを整理
 */
async function organizeMemoryWithClaudeCLI(currentContent: string): Promise<string> {
  const systemPrompt = `あなたはAI共有メモリ（AI_MEMORY）の整理を担当するアシスタントです。

**役割:**
1. INBOXセクションの内容を分析
2. 重複する情報を統合
3. 重要な確定情報を適切なセクションに移動
4. INBOXを最新50エントリ以内に保つ
5. 全体の構造を維持しながら整理

**整理基準:**
- ✅ 確定した情報 → 適切なセクションへ昇格
- ✅ 重複情報 → 統合または削除
- ✅ 一時的なメモ → 7日以上経過したら削除
- ✅ プロジェクト関連 → 「現在のプロジェクト」セクションへ
- ✅ 自動化・環境設定 → 該当セクションへ

**保持する構造:**
- 基本情報
- 環境
- 現在のプロジェクト
- 自動化済み
- Jarvisの機能
- 重要な発見
- INBOX（最新50件まで）

**CRITICAL INSTRUCTION:**
整理後の完全なドキュメント内容（Markdown形式）のみを返してください。
「整理しました」「以下が整理後の内容です」などのメタ情報は絶対に含めず、ドキュメント本文のみを出力してください。`;

  // 一時ファイルにコンテンツを保存
  const tempPath = '/tmp/ai-memory-content.md';
  await Bun.write(tempPath, currentContent);

  // Claude CLIで整理実行
  // --print: 非インタラクティブモード
  // --system-prompt: システムプロンプト指定
  // --dangerously-skip-permissions: 自動実行（サンドボックス環境）
  const command = `claude --print --system-prompt "${systemPrompt}" --dangerously-skip-permissions "このファイル ${tempPath} の内容を整理してください。整理後のMarkdown本文のみを出力してください。"`;

  try {
    const organizedContent = execSync(command, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 180000, // 3分
      cwd: '/Users/daijiromatsuokam1', // 作業ディレクトリ
    });

    return organizedContent.trim() || currentContent;
  } catch (error) {
    console.error('[Memory Organizer] Claude CLI error:', error);
    return currentContent;
  }
}

/**
 * メイン処理: AI_MEMORY整理
 */
export async function organizeMemory(
  credentialsPath: string,
  documentId: string
): Promise<{ success: boolean; changes: string }> {
  try {
    console.log('[Memory Organizer] 🧹 Starting AI_MEMORY organization...');

    // 1. ドキュメント取得
    const docsClient = await getDocsClient(credentialsPath);
    const currentContent = await getDocumentContent(docsClient, documentId);

    console.log(`[Memory Organizer] 📄 Current content length: ${currentContent.length} chars`);

    // 2. Claude CLIで整理
    console.log('[Memory Organizer] 🤖 Organizing with Claude CLI...');
    const organizedContent = await organizeMemoryWithClaudeCLI(currentContent);

    console.log(`[Memory Organizer] 📝 Organized content length: ${organizedContent.length} chars`);

    // 3. 変更がある場合のみ更新
    if (organizedContent.trim() === currentContent.trim()) {
      console.log('[Memory Organizer] ✨ No changes needed - memory is already organized');
      return {
        success: true,
        changes: 'No changes - already organized',
      };
    }

    // 4. ドキュメント更新
    await replaceDocumentContent(docsClient, documentId, organizedContent);

    const changesSummary = `Organized: ${currentContent.length} → ${organizedContent.length} chars`;
    console.log(`[Memory Organizer] ✅ ${changesSummary}`);

    return {
      success: true,
      changes: changesSummary,
    };

  } catch (error) {
    console.error('[Memory Organizer] ❌ Error:', error);
    return {
      success: false,
      changes: `Error: ${error}`,
    };
  }
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

  console.log('🧹 Starting AI_MEMORY organization...');
  organizeMemory(credentialsPath, documentId)
    .then((result) => {
      if (result.success) {
        console.log(`✅ Organization complete: ${result.changes}`);
      } else {
        console.error(`❌ Organization failed: ${result.changes}`);
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('❌ Unexpected error:', error);
      process.exit(1);
    });
}
