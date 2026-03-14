/**
 * Obsidian Writer - Append to daily notes
 * Writes directly to Obsidian vault on M1 filesystem
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";

const VAULT_PATH =
  process.env.OBSIDIAN_VAULT ||
  "/Users/daijiromatsuokam1/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian";

/**
 * Get today's daily note path (JST)
 */
function getDailyNotePath(): string {
  const now = new Date();
  // JST = UTC+9
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const dir = join(VAULT_PATH, String(y), m);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${y}-${m}-${d}.md`);
}

/**
 * Ensure daily note exists with section headers
 */
function ensureDailyNote(path: string): void {
  if (!existsSync(path)) {
    const date = path.split("/").pop()?.replace(".md", "") || "";
    const template = `# ${date}\n\n## 🎙 Voice Inbox\n\n## 📋 Tasks\n\n## 📰 News\n`;
    writeFileSync(path, template, "utf-8");
    console.log(`[Obsidian] Created daily note: ${path}`);
  }
}

/**
 * Append content to a specific section in the daily note
 */
function appendToSection(path: string, section: string, content: string): void {
  ensureDailyNote(path);

  let note = readFileSync(path, "utf-8");
  const sectionHeader = `## ${section}`;
  const idx = note.indexOf(sectionHeader);

  if (idx === -1) {
    // Section not found, append it
    note += `\n${sectionHeader}\n${content}\n`;
  } else {
    // Find next section or end of file
    const afterHeader = idx + sectionHeader.length;
    const nextSection = note.indexOf("\n## ", afterHeader);
    const insertAt = nextSection === -1 ? note.length : nextSection;

    // Insert content before next section
    note = note.substring(0, insertAt) + `\n${content}` + note.substring(insertAt);
  }

  writeFileSync(path, note, "utf-8");
}

/**
 * Archive a Telegram message to Obsidian daily note
 */
export async function archiveToObsidian(
  telegramMsgId: number | undefined,
  chatId: number | undefined,
  direction: "in" | "out",
  source: string,
  content: string,
  actionTaken: string
): Promise<void> {
  try {
    const path = getDailyNotePath();
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const time = jst.toISOString().substring(11, 16); // HH:MM

    const icon =
      {
        gmail: "📧",
        line: "💬",
        slack: "🔔",
        apple: "📱",
        calendar: "📅",
        reminder: "⏰",
      }[source] || "📨";

    const dirIcon = direction === "in" ? "←" : "→";
    // Skip daily note Telegram Log (replaced by Daily Briefing)
    // Route to project notes if M-numbers detected
    const routed = await routeToProjectNotes(content, source, actionTaken);
    if (routed.length > 0) {
      const newProjects = routed.filter(r => r.startsWith("NEW:"));
      if (newProjects.length > 0) {
        console.log(`[Obsidian] New project notes created: ${newProjects.map(r => r.replace("NEW:", "")).join(", ")}`);
      }
    }
  } catch (error) {
    console.error("[Obsidian] Archive error:", error);
    // Non-fatal: don't break inbox flow
  }
}

/**
 * Append news to daily note
 */
export async function appendNews(title: string, summary: string, url?: string): Promise<void> {
  try {
    const path = getDailyNotePath();
    const link = url ? ` [→](${url})` : "";
    const entry = `- **${title}**${link}\n  ${summary}`;
    appendToSection(path, "📰 News", entry);
  } catch (error) {
    console.error("[Obsidian] News append error:", error);
  }
}

/**
 * Append memo to daily note (from Telegram 。command)
 */
export function appendMemo(text: string): void {
  try {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const y = jst.getUTCFullYear();
    const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(jst.getUTCDate()).padStart(2, "0");
    const path = join(VAULT_PATH, String(y), m, `${y}-${m}-${d}.md`);
    // Ensure directory exists
    const dir = join(VAULT_PATH, String(y), m);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const time = jst.toISOString().substring(11, 16);
    const entry = `- ${time} ${text}`;
    appendToSection(path, "📝 メモ", entry);
    console.log(`[Obsidian] Memo: ${text.substring(0, 50)}`);
  } catch (error) {
    console.error('[Obsidian] Memo error:', error);
  }
}

/**
 * Append task to daily note (from Telegram 、command)
 */
export function appendTask(text: string): void {
  try {
    const path = getDailyNotePath();
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const time = jst.toISOString().substring(11, 16);
    const entry = `- [ ] ${time} ${text}`;
    appendToSection(path, '📋 Tasks', entry);
    console.log(`[Obsidian] Task: ${text.substring(0, 50)}`);
  } catch (error) {
    console.error('[Obsidian] Task error:', error);
  }
}


// === PROJECT ROUTING ===

const WORK_DIR = join(VAULT_PATH, "40_Work");

/**
 * Extract M-number project IDs from text (e.g. M1311, M1318)
 */
export function detectProjectNumbers(text: string): string[] {
  const matches = text.match(/M\d{4}/g);
  if (!matches) return [];
  return [...new Set(matches)]; // dedupe
}

/**
 * Find existing project note by M-number
 */
function findProjectNote(projectNum: string): string | null {
  if (!existsSync(WORK_DIR)) return null;
  const files = require("fs").readdirSync(WORK_DIR) as string[];
  const match = files.find((f: string) => f.startsWith(projectNum) && f.endsWith(".md"));
  return match ? join(WORK_DIR, match) : null;
}

/**
 * Create a new project note from template
 */
function createProjectNote(projectNum: string, contextHint: string): string {
  if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR, { recursive: true });
  
  // Try to extract client name from context (e.g. "M1318_2026/03/10" or surrounding text)
  let clientHint = "";
  // Common patterns: 〇〇様, 株式会社〇〇, 有限会社〇〇
  const clientMatch = contextHint.match(/(株式会社|有限会社|合同会社)?[\u3000-\u9FFF]{2,10}(様|殿)/);
  if (clientMatch) {
    clientHint = clientMatch[0].replace(/様|殿/, "").replace(/株式会社|有限会社|合同会社/, "").trim();
  }
  
  const fileName = clientHint 
    ? `${projectNum}_${clientHint}.md`
    : `${projectNum}.md`;
  const filePath = join(WORK_DIR, fileName);
  
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = jst.toISOString().substring(0, 10);
  
  const template = `---
tags:
  - 案件
番号: "${projectNum}"
客先: "${clientHint}"
担当: ""
ステータス: 進行中
開始日: ${dateStr}
納期: ""
---

# ${projectNum}${clientHint ? " " + clientHint : ""}

## 概要


## メモ


## ログ
- ${dateStr} 案件ノート自動作成（Telegram検出）
`;
  
  writeFileSync(filePath, template, "utf-8");
  console.log(`[Obsidian] Created project note: ${fileName}`);
  return filePath;
}

/**
 * Route a message to project note(s) based on detected M-numbers
 * Called from archiveToObsidian and text handler
 */
export async function routeToProjectNotes(
  content: string,
  source: string,
  actionTaken?: string
): Promise<string[]> {
  const routed: string[] = [];
  try {
    const projectNums = detectProjectNumbers(content);
    if (projectNums.length === 0) return routed;
    
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const time = jst.toISOString().substring(0, 16).replace("T", " ");
    
    const icon = { gmail: "📧", line: "💬", slack: "🔔", apple: "📱", calendar: "📅", telegram: "💬" }[source] || "📨";
    const action = actionTaken ? `[${actionTaken}] ` : "";
    const summary = content.substring(0, 150).replace(/\n/g, " ");
    const entry = `- ${time} ${icon} ${action}${summary}`;
    
    for (const pNum of projectNums) {
      try {
        let notePath = findProjectNote(pNum);
        let isNew = false;
        
        if (!notePath) {
          notePath = createProjectNote(pNum, content);
          isNew = true;
        }
        
        // Append to log section
        let note = readFileSync(notePath, "utf-8");
        const logIdx = note.indexOf("## ログ");
        if (logIdx !== -1) {
          const nextSection = note.indexOf("\n## ", logIdx + 5);
          const insertAt = nextSection === -1 ? note.length : nextSection;
          note = note.substring(0, insertAt) + "\n" + entry + note.substring(insertAt);
        } else {
          note += "\n## ログ\n" + entry + "\n";
        }
        writeFileSync(notePath, note, "utf-8");
        
        if (isNew) {
          routed.push(`NEW:${pNum}`);
          // Notify DJ via Telegram
          try {
            const token = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_ALLOWED_USERS;
            if (token && chatId) {
              const msg = `New project detected: ${pNum} - note created in Obsidian 40_Work/`;
              await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: msg }),
              });
            }
          } catch { /* non-fatal */ }
        } else {
          routed.push(pNum);
        }
      } catch (err) {
        console.error(`[Obsidian] Project route error for ${pNum}:`, err);
        // Non-fatal: continue with other project numbers
      }
    }
  } catch (error) {
    console.error("[Obsidian] Project routing error:", error);
    // Non-fatal
  }
  return routed;
}
