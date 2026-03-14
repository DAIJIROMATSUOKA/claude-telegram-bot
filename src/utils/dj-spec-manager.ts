/**
 * dj-spec-manager.ts — DJ Judgment Spec & Decision Log
 *
 * Restored from F9 archive (2026-03-14). All sessionKey dependencies removed.
 * Pure file operations: DJ-SPEC.md + DJ-DECISIONS.ndjson
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const HOME = homedir();
const DOCS_DIR = join(HOME, "claude-telegram-bot/docs");
const SPEC_PATH = join(DOCS_DIR, "DJ-SPEC.md");
const DECISIONS_PATH = join(DOCS_DIR, "DJ-DECISIONS.ndjson");

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

---

## 5. JARVIS委任範囲

- 自動対応してよい範囲: （DJが記入）
- 必ずDJ確認が必要な範囲: （DJが記入）
`;

export function initSpec(): boolean {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
  if (!existsSync(SPEC_PATH)) {
    writeFileSync(SPEC_PATH, INITIAL_SPEC, "utf-8");
    return true;
  }
  return false;
}

export function readSpec(): string {
  initSpec();
  return readFileSync(SPEC_PATH, "utf-8");
}

export function getSpecSections(): SpecSection[] {
  const text = readSpec();
  const sections: SpecSection[] = [];
  const lines = text.split("\n");
  let currentTitle = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^## \d+\.\s+(.+)/);
    if (h2Match) {
      if (currentTitle) {
        sections.push({ title: currentTitle, content: currentContent.join("\n").trim() });
      }
      currentTitle = h2Match[1]!;
      currentContent = [];
    } else if (currentTitle) {
      currentContent.push(line);
    }
  }
  if (currentTitle) {
    sections.push({ title: currentTitle, content: currentContent.join("\n").trim() });
  }
  return sections;
}

export function updateSpecSection(sectionNum: string, content: string): boolean {
  try {
    const text = readSpec();
    const sections = getSpecSections();
    const idx = parseInt(sectionNum) - 1;
    if (idx < 0 || idx >= sections.length) return false;

    const section = sections[idx]!;
    const sectionHeader = `## ${parseInt(sectionNum)}. ${section.title}`;
    const headerIdx = text.indexOf(sectionHeader);
    if (headerIdx === -1) return false;

    // Find next section header or end of file
    const afterHeader = text.indexOf("\n", headerIdx);
    const nextSectionMatch = text.substring(afterHeader + 1).match(/\n## \d+\./);
    const endIdx = nextSectionMatch
      ? afterHeader + 1 + nextSectionMatch.index!
      : text.length;

    const newText =
      text.substring(0, afterHeader + 1) +
      "\n" + content + "\n\n" +
      text.substring(endIdx);

    writeFileSync(SPEC_PATH, newText, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function logDecision(opts: {
  context: string;
  decision: string;
  reason: string;
  rejectedAlternatives?: string;
  projectId?: string;
  source?: string;
}): Decision {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
  const entry: Decision = {
    date: new Date().toISOString(),
    context: opts.context,
    decision: opts.decision,
    reason: opts.reason,
    rejected_alternatives: opts.rejectedAlternatives,
    project_id: opts.projectId,
    source: opts.source || "telegram",
  };
  appendFileSync(DECISIONS_PATH, JSON.stringify(entry) + "\n");
  return entry;
}

export function getRecentDecisions(n = 5, projectFilter?: string): Decision[] {
  try {
    if (!existsSync(DECISIONS_PATH)) return [];
    const lines = readFileSync(DECISIONS_PATH, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.trim());
    let decisions: Decision[] = lines.map((l) => JSON.parse(l));
    if (projectFilter) {
      decisions = decisions.filter(
        (d) => d.project_id?.toUpperCase() === projectFilter.toUpperCase()
      );
    }
    return decisions.slice(-n).reverse();
  } catch {
    return [];
  }
}

export function countDecisions(): number {
  try {
    if (!existsSync(DECISIONS_PATH)) return 0;
    return readFileSync(DECISIONS_PATH, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}
