/**
 * dj-spec-manager.ts — F9: DJ Judgment Spec & Decision Log
 *
 * Two-layer structure (3AI debate decision, 2026-03-14):
 *   DJ-SPEC.md    — Current decision criteria (versioned, monthly review)
 *   DJ-DECISIONS.ndjson — Individual decision log (append-only casebook)
 *
 * Design principle: "If it can't be written down, it can't be delegated to AI yet."
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { execSync } from "child_process";

// ─── Constants ────────────────────────────────────────────────

const HOME = homedir();
const DOCS_DIR = join(HOME, "claude-telegram-bot/docs");
const SPEC_PATH = join(DOCS_DIR, "DJ-SPEC.md");
const DECISIONS_PATH = join(DOCS_DIR, "DJ-DECISIONS.ndjson");

// ─── Types ────────────────────────────────────────────────────

export interface Decision {
  date: string;
  context: string;
  decision: string;
  reason: string;
  rejected_alternatives?: string;
  project_id?: string;
  source?: string;
}

export interface SpecSection {
  title: string;
  content: string;
}

// ─── Initial DJ-SPEC Template ───────────────────────────────

const INITIAL_SPEC = `# DJ判断基準仕様書 (DJ-SPEC)
**最終更新:** ${new Date().toISOString().substring(0, 10)}
**バージョン:** 1.0

---

## 1. 案件の優先順位

### 最優先
- （DJが記入: 例「伊藤ハム案件は最優先」）

### 通常
- 受注済み案件は納期順

### 後回し可
- 見積段階で確度が低い案件

---

## 2. 見積・価格判断

- 粗利率の基準: （DJが記入: 例「35%以下なら断る」）
- 値引き許容範囲: （DJが記入）
- 特別対応の条件: （DJが記入: 例「リピート顧客は10%値引きOK」）

---

## 3. 技術判断

- 採用する技術の基準: （DJが記入）
- 外注に出す判断基準: （DJが記入）
- 内海さん（PLC）への依頼基準: （DJが記入）

---

## 4. コミュニケーション

- 顧客への返信速度: （DJが記入: 例「24時間以内」）
- エスカレーション基準: （DJが記入: 例「事故・リコール関連は即座に」）
- 営業時間外の対応: （DJが記入）

---

## 5. システム運用

- 従量課金API: 絶対禁止
- Opus使用: 設計判断のみ、ルーティング等はSonnet
- 夜間自律改善: 22:00-03:00、usage 70%超でスキップ
- sessionKey失効時: 手動復旧2分以内

---

## 更新履歴

- ${new Date().toISOString().substring(0, 10)} v1.0 初版作成（3AIディベートの設計決定に基づく）
`;

// ─── Spec Management ────────────────────────────────────────

/** Initialize DJ-SPEC.md if not exists */
export function initSpec(): boolean {
  if (existsSync(SPEC_PATH)) return false;
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
  writeFileSync(SPEC_PATH, INITIAL_SPEC, "utf-8");
  return true;
}

/** Read the full spec */
export function readSpec(): string {
  if (!existsSync(SPEC_PATH)) {
    initSpec();
  }
  return readFileSync(SPEC_PATH, "utf-8");
}

/** Get spec sections as structured data */
export function getSpecSections(): SpecSection[] {
  const content = readSpec();
  const sections: SpecSection[] = [];
  const parts = content.split(/^## /m);

  for (const part of parts.slice(1)) {
    const lines = part.split("\n");
    const title = lines[0].trim();
    const body = lines.slice(1).join("\n").trim();
    sections.push({ title, content: body });
  }

  return sections;
}

/** Update a specific section by title number (e.g. "1" for "1. 案件の優先順位") */
export function updateSpecSection(sectionNum: string, newContent: string): boolean {
  let content = readSpec();
  const regex = new RegExp(`(## ${sectionNum}\\.\\s+[^\\n]+\\n)([\\s\\S]*?)(?=\\n## |\\n---\\n## 更新履歴|$)`);
  const match = content.match(regex);

  if (!match) return false;

  const header = match[1];
  content = content.replace(regex, `${header}\n${newContent}\n\n`);

  // Update timestamp
  content = content.replace(
    /\*\*最終更新:\*\* .+/,
    `**最終更新:** ${new Date().toISOString().substring(0, 10)}`,
  );

  writeFileSync(SPEC_PATH, content, "utf-8");

  // Git commit
  try {
    execSync(
      `cd "${join(HOME, "claude-telegram-bot")}" && git add docs/DJ-SPEC.md && git commit -m "docs: update DJ-SPEC section ${sectionNum}" --no-verify`,
      { timeout: 10000 },
    );
  } catch {
    // Non-fatal
  }

  return true;
}

/** Append to the update history */
function appendUpdateHistory(entry: string): void {
  let content = readSpec();
  const historyMarker = "## 更新履歴\n";
  const idx = content.indexOf(historyMarker);
  if (idx === -1) return;

  const insertPos = idx + historyMarker.length;
  const date = new Date().toISOString().substring(0, 10);
  content = content.substring(0, insertPos) + `\n- ${date} ${entry}` + content.substring(insertPos);
  writeFileSync(SPEC_PATH, content, "utf-8");
}

// ─── Decision Log ───────────────────────────────────────────

/** Log a decision to DJ-DECISIONS.ndjson */
export function logDecision(decision: Decision): void {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });

  const entry = {
    ...decision,
    date: decision.date || new Date().toISOString(),
  };

  appendFileSync(DECISIONS_PATH, JSON.stringify(entry, null, 0) + "\n", "utf-8");
}

/** Read recent decisions */
export function getRecentDecisions(count = 10): Decision[] {
  if (!existsSync(DECISIONS_PATH)) return [];

  try {
    const lines = readFileSync(DECISIONS_PATH, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.trim());

    return lines
      .slice(-count)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Decision[];
  } catch {
    return [];
  }
}

/** Search decisions by keyword */
export function searchDecisions(keyword: string): Decision[] {
  if (!existsSync(DECISIONS_PATH)) return [];

  try {
    const lines = readFileSync(DECISIONS_PATH, "utf-8").trim().split("\n").filter((l) => l.trim());
    const kw = keyword.toLowerCase();

    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as Decision;
        } catch {
          return null;
        }
      })
      .filter((d): d is Decision => {
        if (!d) return false;
        const text = `${d.context} ${d.decision} ${d.reason} ${d.project_id || ""}`.toLowerCase();
        return text.includes(kw);
      })
      .slice(-20); // Max 20 results
  } catch {
    return [];
  }
}

/** Count total decisions */
export function countDecisions(): number {
  if (!existsSync(DECISIONS_PATH)) return 0;
  try {
    return readFileSync(DECISIONS_PATH, "utf-8").trim().split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

/** Check if a decision pattern should be promoted to spec */
export function findPromotionCandidates(minOccurrences = 3): Array<{ pattern: string; count: number; examples: Decision[] }> {
  const decisions = getRecentDecisions(50);
  if (decisions.length < minOccurrences) return [];

  // Simple keyword frequency analysis
  const keywords = new Map<string, Decision[]>();

  for (const d of decisions) {
    // Extract significant phrases from decision text
    const phrases = (d.decision || "").match(/[\u3000-\u9FFF]{2,}|[a-zA-Z]{4,}/g) || [];
    for (const phrase of phrases) {
      const key = phrase.toLowerCase();
      if (!keywords.has(key)) keywords.set(key, []);
      keywords.get(key)!.push(d);
    }
  }

  return Array.from(keywords.entries())
    .filter(([_, examples]) => examples.length >= minOccurrences)
    .map(([pattern, examples]) => ({ pattern, count: examples.length, examples: examples.slice(0, 3) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}
