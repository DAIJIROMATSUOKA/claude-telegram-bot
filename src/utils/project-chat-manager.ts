/**
 * project-chat-manager.ts — F2: Project ↔ claude.ai Chat UUID Mapping
 *
 * Maps M-numbers (M1317) and PrNo (26005) to claude.ai chat UUIDs.
 * Auto-creates chats on first access with Dropbox folder context injection.
 *
 * Storage: ~/.claude-project-chat-mapping.json
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ClaudeAIClient, type Model, type CompletionResult } from "./claude-ai-client";
import { buildProjectContext, formatContextPrompt } from "./project-context-builder";

// ─── Types ────────────────────────────────────────────────────

export interface ProjectChatEntry {
  chat_uuid: string;
  chat_name: string;
  model: Model;
  created_at: string;
  dropbox_folder: string;
  project_uuid?: string; // claude.ai project UUID (if in a project)
  /** Chain for auto-handoff: previous chat UUIDs */
  previous_uuids?: string[];
}

export interface ProjectChatMapping {
  [projectId: string]: ProjectChatEntry;
}

// ─── Constants ────────────────────────────────────────────────

const MAPPING_FILE = `${homedir()}/.claude-project-chat-mapping.json`;
const DROPBOX_PROJECT_DIR = `${homedir()}/Machinelab Dropbox/machinelab/プロジェクト`;

// M-number pattern: M1000-M9999
const M_NUMBER_RE = /M\d{4}/g;
// Year-folder PrNo pattern: 26005, 25010, etc.
const PRNO_RE = /\b(1[89]|2[0-9])\d{3}\b/g;

// ─── Manager ─────────────────────────────────────────────────

export class ProjectChatManager {
  private mapping: ProjectChatMapping;
  private client: ClaudeAIClient;
  private defaultModel: Model;

  constructor(client: ClaudeAIClient, defaultModel: Model = "claude-opus-4-6") {
    this.client = client;
    this.defaultModel = defaultModel;
    this.mapping = ProjectChatManager.loadMapping();
  }

  // ─── Mapping Persistence ──────────────────────────────────

  static loadMapping(): ProjectChatMapping {
    if (!existsSync(MAPPING_FILE)) return {};
    try {
      return JSON.parse(readFileSync(MAPPING_FILE, "utf-8"));
    } catch {
      return {};
    }
  }

  private save(): void {
    writeFileSync(MAPPING_FILE, JSON.stringify(this.mapping, null, 2), "utf-8");
  }

  // ─── Project Number Detection (reuses obsidian-writer logic) ─

  /** Extract M-numbers from text */
  static detectMNumbers(text: string): string[] {
    const matches = text.match(M_NUMBER_RE);
    if (!matches) return [];
    return [...new Set(matches)];
  }

  /** Extract PrNo from text (year-folder style: 26005) */
  static detectPrNumbers(text: string): string[] {
    const matches = text.match(PRNO_RE);
    if (!matches) return [];
    // Filter: must be a valid year prefix (18-26) + 3-digit seq
    return [...new Set(matches.filter((m) => {
      const year = parseInt(m.substring(0, 2));
      return year >= 18 && year <= 30;
    }))];
  }

  /** Detect all project IDs (M-numbers take priority) */
  static detectProjectIds(text: string): string[] {
    const mNums = ProjectChatManager.detectMNumbers(text);
    if (mNums.length > 0) return mNums;
    return ProjectChatManager.detectPrNumbers(text);
  }

  // ─── Dropbox Folder Resolution ────────────────────────────

  /** Find Dropbox folder for a project ID */
  static findDropboxFolder(projectId: string): string | null {
    if (!existsSync(DROPBOX_PROJECT_DIR)) return null;

    // M-number: direct match in root
    if (projectId.startsWith("M")) {
      const entries = readdirSync(DROPBOX_PROJECT_DIR);
      const match = entries.find((e) => e.startsWith(projectId));
      return match || null;
    }

    // PrNo: search in year folder (first 2 digits = year)
    const yearPrefix = projectId.substring(0, 2);
    const yearDir = join(DROPBOX_PROJECT_DIR, yearPrefix);
    if (!existsSync(yearDir)) return null;

    const entries = readdirSync(yearDir);
    const match = entries.find((e) => e.startsWith(projectId));
    return match ? `${yearPrefix}/${match}` : null;
  }

  /** Get folder contents summary for context injection */
  static getFolderSummary(folderName: string): string {
    const fullPath = folderName.includes("/")
      ? join(DROPBOX_PROJECT_DIR, folderName)
      : join(DROPBOX_PROJECT_DIR, folderName);

    if (!existsSync(fullPath)) return "(フォルダ未検出)";

    try {
      const entries = readdirSync(fullPath);
      const dirs: string[] = [];
      const files: string[] = [];

      for (const entry of entries.slice(0, 50)) {
        try {
          const stat = statSync(join(fullPath, entry));
          if (stat.isDirectory()) {
            dirs.push(entry);
          } else {
            const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
            files.push(`${entry} (${sizeMB}MB)`);
          }
        } catch {
          files.push(entry);
        }
      }

      const lines: string[] = [];
      if (dirs.length > 0) lines.push(`📁 サブフォルダ: ${dirs.join(", ")}`);
      if (files.length > 0) lines.push(`📄 ファイル: ${files.slice(0, 20).join(", ")}`);
      if (entries.length > 50) lines.push(`(他 ${entries.length - 50} 件)`);

      return lines.join("\n") || "(空フォルダ)";
    } catch {
      return "(フォルダ読み取りエラー)";
    }
  }

  // ─── Chat Management ──────────────────────────────────────

  /** Get chat UUID for a project (returns null if not mapped) */
  getChat(projectId: string): ProjectChatEntry | null {
    return this.mapping[projectId] || null;
  }

  /** Get or create chat for a project */
  async getOrCreateChat(projectId: string, opts?: {
    model?: Model;
    projectUuid?: string;
    skipContextInjection?: boolean;
  }): Promise<ProjectChatEntry> {
    // Return existing
    const existing = this.mapping[projectId];
    if (existing) return existing;

    // Resolve Dropbox folder
    const folderName = ProjectChatManager.findDropboxFolder(projectId) || "";
    const chatName = folderName || projectId;
    const model = opts?.model || this.defaultModel;

    // Create chat on claude.ai
    const conv = await this.client.createConversation({
      name: chatName,
      model,
      project_uuid: opts?.projectUuid,
    });

    const entry: ProjectChatEntry = {
      chat_uuid: conv.uuid,
      chat_name: chatName,
      model,
      created_at: new Date().toISOString(),
      dropbox_folder: folderName,
      project_uuid: opts?.projectUuid,
    };

    // Save mapping immediately (before context injection, in case it fails)
    this.mapping[projectId] = entry;
    this.save();

    // Inject initial context
    if (!opts?.skipContextInjection && folderName) {
      try {
        await this.injectInitialContext(conv.uuid, projectId, folderName, model);
      } catch (e) {
        console.error(`[ProjectChatMgr] Context injection failed for ${projectId}:`, e);
        // Chat still created and mapped — context can be injected later
      }
    }

    console.log(`[ProjectChatMgr] Created chat: ${projectId} → ${conv.uuid} (${chatName})`);
    return entry;
  }

  /** Inject initial context into a newly created project chat (F3) */
  private async injectInitialContext(
    chatUuid: string,
    projectId: string,
    folderName: string,
    model: Model,
  ): Promise<void> {
    const ctx = buildProjectContext(projectId);
    const prompt = formatContextPrompt(ctx);

    await this.client.postFirstMessage({
      conversationUuid: chatUuid,
      prompt,
      model,
    });
  }

  // ─── Routing ──────────────────────────────────────────────

  /** Route a message to the appropriate project chat(s) */
  async routeMessage(opts: {
    text: string;
    source: string;
    senderHint?: string;
  }): Promise<Array<{ projectId: string; entry: ProjectChatEntry; result: CompletionResult }>> {
    const projectIds = ProjectChatManager.detectProjectIds(opts.text);
    if (projectIds.length === 0) return [];

    const results: Array<{ projectId: string; entry: ProjectChatEntry; result: CompletionResult }> = [];

    for (const pid of projectIds) {
      try {
        const entry = await this.getOrCreateChat(pid);

        const icon = { gmail: "📧", line: "💬", slack: "🔔", apple: "📱", telegram: "💬" }[opts.source] || "📨";
        const sender = opts.senderHint ? ` (${opts.senderHint})` : "";
        const prompt = `${icon} ${opts.source}${sender}:\n${opts.text}`;

        const result = await this.client.postMessage({
          conversationUuid: entry.chat_uuid,
          prompt,
          model: entry.model,
        });

        results.push({ projectId: pid, entry, result });
      } catch (e) {
        console.error(`[ProjectChatMgr] Route failed for ${pid}:`, e);
      }
    }

    return results;
  }

  // ─── Auto-Handoff Support ─────────────────────────────────

  /** Replace chat UUID for a project (used by auto-handoff) */
  replaceChat(projectId: string, newChatUuid: string, summary?: string): void {
    const existing = this.mapping[projectId];
    if (!existing) return;

    const previousUuids = existing.previous_uuids || [];
    previousUuids.push(existing.chat_uuid);

    this.mapping[projectId] = {
      ...existing,
      chat_uuid: newChatUuid,
      previous_uuids: previousUuids,
    };
    this.save();

    console.log(`[ProjectChatMgr] Handoff: ${projectId} → ${newChatUuid} (prev: ${previousUuids.length} chats)`);
  }

  // ─── Utilities ────────────────────────────────────────────

  /** List all mapped projects */
  listAll(): ProjectChatMapping {
    return { ...this.mapping };
  }

  /** Remove a mapping (does NOT delete the chat) */
  removeMapping(projectId: string): boolean {
    if (!this.mapping[projectId]) return false;
    delete this.mapping[projectId];
    this.save();
    return true;
  }

  /** Get all project IDs */
  getProjectIds(): string[] {
    return Object.keys(this.mapping);
  }

  /** Reload mapping from disk */
  reload(): void {
    this.mapping = ProjectChatManager.loadMapping();
  }
}
