/**
 * orchestrator-init.ts — F5: Orchestrator Singleton & Inbox Chat Management
 *
 * Initializes the orchestrator on bot startup.
 * Creates Inbox chat on claude.ai if it doesn't exist.
 * Provides singleton access for text.ts and other handlers.
 *
 * Config: ~/.claude-orchestrator-config.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { ClaudeAIClient, SessionExpiredError } from "./claude-ai-client";
import { ProjectChatManager } from "./project-chat-manager";
import { Orchestrator } from "./orchestrator";

// ─── Types ────────────────────────────────────────────────────

interface OrchestratorConfig {
  inbox_chat_uuid: string | null;
  inbox_chat_name: string;
  project_uuid: string | null; // claude.ai project UUID (if using Projects)
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────

const CONFIG_PATH = `${homedir()}/.claude-orchestrator-config.json`;
const INBOX_CHAT_NAME = "🦞 Inbox Router";

// ─── Singleton ────────────────────────────────────────────────

let _orchestrator: Orchestrator | null = null;
let _client: ClaudeAIClient | null = null;
let _projectMgr: ProjectChatManager | null = null;
let _initialized = false;

// ─── Config Persistence ─────────────────────────────────────

function loadConfig(): OrchestratorConfig {
  if (!existsSync(CONFIG_PATH)) {
    return {
      inbox_chat_uuid: null,
      inbox_chat_name: INBOX_CHAT_NAME,
      project_uuid: null,
      created_at: new Date().toISOString(),
    };
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {
      inbox_chat_uuid: null,
      inbox_chat_name: INBOX_CHAT_NAME,
      project_uuid: null,
      created_at: new Date().toISOString(),
    };
  }
}

function saveConfig(config: OrchestratorConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

// ─── Initialization ─────────────────────────────────────────

/**
 * Initialize the orchestrator. Safe to call multiple times (idempotent).
 * @param onSessionExpired - callback when sessionKey expires (e.g. Telegram notify)
 */
export async function initOrchestrator(onSessionExpired?: () => void): Promise<Orchestrator> {
  if (_orchestrator && _initialized) return _orchestrator;

  try {
    // 1. Create client
    _client = new ClaudeAIClient(undefined, onSessionExpired);

    // 2. Create project manager
    _projectMgr = new ProjectChatManager(_client);

    // 3. Load or create Inbox chat
    const config = loadConfig();

    // Verify existing Inbox chat is still accessible
    if (config.inbox_chat_uuid) {
      try {
        await _client.getConversation(config.inbox_chat_uuid);
        console.log(`[Orchestrator] Inbox chat verified: ${config.inbox_chat_uuid}`);
      } catch (e) {
        if (e instanceof SessionExpiredError) throw e;
        // Chat deleted or inaccessible — will recreate
        console.warn(`[Orchestrator] Inbox chat ${config.inbox_chat_uuid} inaccessible, will recreate`);
        config.inbox_chat_uuid = null;
      }
    }

    // Create Inbox chat if needed
    if (!config.inbox_chat_uuid) {
      console.log("[Orchestrator] Creating Inbox chat on claude.ai...");
      const conv = await _client.createConversation({
        name: INBOX_CHAT_NAME,
        model: "claude-sonnet-4-6", // Sonnet for routing (quota saving)
        project_uuid: config.project_uuid || undefined,
      });

      config.inbox_chat_uuid = conv.uuid;
      config.created_at = new Date().toISOString();
      saveConfig(config);

      // Inject system instructions
      await _client.postFirstMessage({
        conversationUuid: conv.uuid,
        prompt: INBOX_SYSTEM_PROMPT,
        model: "claude-sonnet-4-6",
      });

      console.log(`[Orchestrator] Inbox chat created: ${conv.uuid}`);
    }

    // 4. Create orchestrator
    _orchestrator = new Orchestrator({
      client: _client,
      projectMgr: _projectMgr,
      inboxChatUuid: config.inbox_chat_uuid,
    });

    _initialized = true;
    console.log("[Orchestrator] Initialized successfully");
    return _orchestrator;
  } catch (e) {
    console.error("[Orchestrator] Init failed:", e);
    // Return a no-op orchestrator that only does code-layer routing
    if (!_client) _client = new ClaudeAIClient(undefined, onSessionExpired);
    if (!_projectMgr) _projectMgr = new ProjectChatManager(_client);
    _orchestrator = new Orchestrator({
      client: _client,
      projectMgr: _projectMgr,
      inboxChatUuid: null, // No Inbox → code-only routing
    });
    _initialized = true;
    return _orchestrator;
  }
}

/**
 * Get the orchestrator singleton. Returns null if not yet initialized.
 */
export function getOrchestrator(): Orchestrator | null {
  return _orchestrator;
}

/**
 * Get the client singleton (for direct API calls from handlers).
 */
export function getClaudeAIClient(): ClaudeAIClient | null {
  return _client;
}

/**
 * Get the project manager singleton.
 */
export function getProjectChatManager(): ProjectChatManager | null {
  return _projectMgr;
}

/**
 * Check if orchestrator is initialized and has Inbox chat.
 */
export function isOrchestratorReady(): boolean {
  return _initialized && _orchestrator !== null;
}

/**
 * Reset orchestrator (for testing or re-init after config change).
 */
export function resetOrchestrator(): void {
  _orchestrator = null;
  _client = null;
  _projectMgr = null;
  _initialized = false;
}

// ─── Inbox System Prompt ────────────────────────────────────

const INBOX_SYSTEM_PROMPT = `あなたは「Inboxルーター」です。役割は受信メッセージを分析し、適切な案件チャットへのルーティング先を判断することです。

## ルール
1. メッセージ内容から案件番号（M+4桁）またはプロジェクト番号（年2桁+3桁連番）を推定する
2. 確信度(confidence)を0.0〜1.0で付与する
3. 判断不能な場合はnullを返す

## 出力形式
必ず以下のJSON形式のみで応答してください。それ以外のテキストは不要です:
{"project_id": "M1317", "confidence": 0.8, "reason": "白菜検査に関する内容"}

## 例
- メール「美山成田工場のカメラ設置について」→ {"project_id": "M1317", "confidence": 0.85, "reason": "美山成田工場 = M1317 カット白菜検査"}
- LINE「煮炊き釜の試作サンプル送ります」→ {"project_id": "M1319", "confidence": 0.9, "reason": "煮炊き釜 = M1319 中西製作所"}
- メール「来週の打合せ日程調整」→ {"project_id": null, "confidence": 0, "reason": "案件特定不能、一般的な日程調整"}
- DJ「先週のHammerspoonチャットを確認」→ {"project_id": null, "confidence": 0, "reason": "search:Hammerspoon", "search": true}

了解したら「了解」とだけ返答してください。`;
