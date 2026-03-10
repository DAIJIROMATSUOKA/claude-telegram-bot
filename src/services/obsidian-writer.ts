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
  return join(dir, `${d}.md`);
}

/**
 * Ensure daily note exists with section headers
 */
function ensureDailyNote(path: string): void {
  if (!existsSync(path)) {
    const date = path.split("/").pop()?.replace(".md", "") || "";
    const template = `# ${date}\n\n## 📋 Tasks\n\n## 📰 News\n\n## 💬 Telegram Log\n`;
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
    const entry = `- ${time} ${icon}${dirIcon} [${actionTaken}] ${content.substring(0, 200).replace(/\n/g, " ")}`;

    appendToSection(path, "💬 Telegram Log", entry);
    console.log(`[Obsidian] Archived: ${source}/${actionTaken} (msg:${telegramMsgId})`);
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
    const path = join(VAULT_PATH, String(y), m, d + ".md");
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
