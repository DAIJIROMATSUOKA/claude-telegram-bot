/**
 * project-context-builder.ts — F3: Initial Context Gathering for Project Chats
 *
 * Gathers context from multiple sources for project chat initialization:
 * 1. Dropbox folder (always available, fast)
 * 2. Obsidian project notes (always available, fast)
 * 3. Access DB (optional, requires Parallels, slow)
 *
 * Graceful degradation: each source is independent, failures don't block others.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { execSync } from "child_process";

// ─── Types ────────────────────────────────────────────────────

export interface ProjectContext {
  projectId: string;
  /** Dropbox folder info */
  dropbox: {
    folderName: string | null;
    subfolders: string[];
    files: Array<{ name: string; sizeMB: string }>;
    totalFiles: number;
  };
  /** Obsidian project note content */
  obsidian: {
    exists: boolean;
    path: string | null;
    content: string | null;
    /** Extracted metadata from frontmatter */
    meta: Record<string, string>;
  };
  /** Access DB data (null if unavailable) */
  accessDb: {
    available: boolean;
    projectName: string | null;
    customerName: string | null;
    deliveryDest: string | null;
    startDate: string | null;
    latestQuote: string | null;
    error: string | null;
  };
}

// ─── Constants ────────────────────────────────────────────────

const HOME = homedir();
const DROPBOX_PROJECT_DIR = `${HOME}/Machinelab Dropbox/machinelab/プロジェクト`;
const OBSIDIAN_WORK_DIR = `${HOME}/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyObsidian/40_Work`;
const ACCESS_DB_SOURCE = `${HOME}/Machinelab Dropbox/Matsuoka Daijiro/MLDatabase.accdb`;
const ACCESS_DB_DESKTOP = `${HOME}/Desktop/MLDatabase.accdb`;

// ─── Dropbox Context ─────────────────────────────────────────

function gatherDropboxContext(projectId: string): ProjectContext["dropbox"] {
  const result: ProjectContext["dropbox"] = {
    folderName: null,
    subfolders: [],
    files: [],
    totalFiles: 0,
  };

  if (!existsSync(DROPBOX_PROJECT_DIR)) return result;

  // Find folder
  let folderPath: string | null = null;

  if (projectId.startsWith("M")) {
    // M-number: direct match in root
    const entries = readdirSync(DROPBOX_PROJECT_DIR);
    const match = entries.find((e) => e.startsWith(projectId));
    if (match) {
      result.folderName = match;
      folderPath = join(DROPBOX_PROJECT_DIR, match);
    }
  } else {
    // PrNo: year folder
    const yearPrefix = projectId.substring(0, 2);
    const yearDir = join(DROPBOX_PROJECT_DIR, yearPrefix);
    if (existsSync(yearDir)) {
      const entries = readdirSync(yearDir);
      const match = entries.find((e) => e.startsWith(projectId));
      if (match) {
        result.folderName = `${yearPrefix}/${match}`;
        folderPath = join(yearDir, match);
      }
    }
  }

  if (!folderPath || !existsSync(folderPath)) return result;

  // Scan folder
  try {
    const entries = readdirSync(folderPath);
    for (const entry of entries) {
      try {
        const stat = statSync(join(folderPath, entry));
        if (stat.isDirectory()) {
          result.subfolders.push(entry);
        } else {
          result.files.push({
            name: entry,
            sizeMB: (stat.size / 1024 / 1024).toFixed(1),
          });
        }
      } catch {
        result.files.push({ name: entry, sizeMB: "?" });
      }
    }
    result.totalFiles = result.files.length;
  } catch (e) {
    console.error(`[ContextBuilder] Dropbox scan error: ${e}`);
  }

  return result;
}

// ─── Obsidian Context ────────────────────────────────────────

function gatherObsidianContext(projectId: string): ProjectContext["obsidian"] {
  const result: ProjectContext["obsidian"] = {
    exists: false,
    path: null,
    content: null,
    meta: {},
  };

  if (!existsSync(OBSIDIAN_WORK_DIR)) return result;

  try {
    const entries = readdirSync(OBSIDIAN_WORK_DIR);
    const match = entries.find((e) => e.startsWith(projectId) && e.endsWith(".md"));

    if (!match) return result;

    const filePath = join(OBSIDIAN_WORK_DIR, match);
    const content = readFileSync(filePath, "utf-8");

    result.exists = true;
    result.path = filePath;
    result.content = content.length > 5000 ? content.substring(0, 5000) + "\n...(truncated)" : content;

    // Parse frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      for (const line of fmMatch[1].split("\n")) {
        const kv = line.match(/^(\S+):\s*"?([^"]*)"?\s*$/);
        if (kv) result.meta[kv[1]] = kv[2];
      }
    }
  } catch (e) {
    console.error(`[ContextBuilder] Obsidian read error: ${e}`);
  }

  return result;
}

// ─── Access DB Context ───────────────────────────────────────

function gatherAccessContext(projectId: string): ProjectContext["accessDb"] {
  const result: ProjectContext["accessDb"] = {
    available: false,
    projectName: null,
    customerName: null,
    deliveryDest: null,
    startDate: null,
    latestQuote: null,
    error: null,
  };

  // Check if Parallels VM is running
  try {
    const vmList = execSync("prlctl list --all 2>/dev/null", {
      encoding: "utf-8",
      timeout: 5000,
    });
    if (!vmList.includes("running")) {
      result.error = "Parallels VM not running";
      return result;
    }
  } catch {
    result.error = "Parallels not available";
    return result;
  }

  // Copy DB to Desktop if needed
  try {
    if (existsSync(ACCESS_DB_SOURCE)) {
      execSync(`cp '${ACCESS_DB_SOURCE}' '${ACCESS_DB_DESKTOP}'`, { timeout: 10000 });
    } else {
      result.error = "DB file not found in Dropbox";
      return result;
    }
  } catch (e) {
    result.error = `DB copy failed: ${e}`;
    return result;
  }

  // Build query based on project ID type
  let whereClause: string;
  if (projectId.startsWith("M")) {
    // M-number: search by project name containing M-number
    const mNum = projectId.replace("M", "");
    whereClause = `[プロジェクト名] LIKE '*M${mNum}*' OR [プロジェクト名] LIKE '*${projectId}*'`;
  } else {
    // PrNo: search by プロジェクトNo
    whereClause = `[プロジェクトNo] = '${projectId}'`;
  }

  // Build PowerShell script
  const ps1Content = `
$ErrorActionPreference = "Stop"
$dbPath = "\\\\Mac\\Home\\Desktop\\MLDatabase.accdb"
try {
    $access = New-Object -ComObject Access.Application
    $access.OpenCurrentDatabase($dbPath)

    # Query project data
    $sql = "SELECT TOP 1 [プロジェクトNo], [プロジェクト名], [開始日], [販売先ID], [納品先ID] FROM [プロジェクトデータ] WHERE ${whereClause}"
    $rs = $access.CurrentDb().OpenRecordset($sql)

    if (-not $rs.EOF) {
        $prNo = $rs.Fields("プロジェクトNo").Value
        $prName = $rs.Fields("プロジェクト名").Value
        $startDate = $rs.Fields("開始日").Value
        $custId = $rs.Fields("販売先ID").Value
        $destId = $rs.Fields("納品先ID").Value

        # Get customer name
        $custName = ""
        if ($custId) {
            $rs2 = $access.CurrentDb().OpenRecordset("SELECT [販売先] FROM [販売先] WHERE [販売先ID] = $custId")
            if (-not $rs2.EOF) { $custName = $rs2.Fields("販売先").Value }
            $rs2.Close()
        }

        # Get delivery destination
        $destName = ""
        if ($destId) {
            $rs3 = $access.CurrentDb().OpenRecordset("SELECT [納品先] FROM [納品先] WHERE [納品先ID] = $destId")
            if (-not $rs3.EOF) { $destName = $rs3.Fields("納品先").Value }
            $rs3.Close()
        }

        # Get latest quote
        $quoteSql = "SELECT TOP 1 [見積書No], [件名], [見積日] FROM [見積書] WHERE [プロジェクトID] = " + $rs.Fields("プロジェクトID").Value + " ORDER BY [見積日] DESC"
        $quoteInfo = ""
        try {
            $rs4 = $access.CurrentDb().OpenRecordset($quoteSql)
            if (-not $rs4.EOF) {
                $quoteInfo = "No." + $rs4.Fields("見積書No").Value + " " + $rs4.Fields("件名").Value + " (" + $rs4.Fields("見積日").Value + ")"
            }
            $rs4.Close()
        } catch {}

        Write-Host "PRNO=$prNo"
        Write-Host "NAME=$prName"
        Write-Host "START=$startDate"
        Write-Host "CUSTOMER=$custName"
        Write-Host "DEST=$destName"
        Write-Host "QUOTE=$quoteInfo"
    } else {
        Write-Host "NOTFOUND"
    }
    $rs.Close()
    $access.CloseCurrentDatabase()
    $access.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($access) | Out-Null
} catch {
    Write-Host "ERROR=$($_.Exception.Message)"
}
`.trim();

  try {
    // Write ps1 with UTF-8 BOM
    const bomScript = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(ps1Content, "utf-8"),
    ]);
    const scriptPath = `${HOME}/Desktop/access-context-query.ps1`;
    require("fs").writeFileSync(scriptPath, bomScript);

    // Execute via Parallels
    const output = execSync(
      `prlctl exec 'DJ'\\''s Windows 11' powershell.exe -ExecutionPolicy Bypass -File '\\\\Mac\\Home\\Desktop\\access-context-query.ps1'`,
      { encoding: "utf-8", timeout: 30000 },
    ).trim();

    if (output.includes("NOTFOUND")) {
      result.error = "Project not found in Access DB";
      return result;
    }

    if (output.includes("ERROR=")) {
      result.error = output.match(/ERROR=(.*)/)?.[1] || "Unknown error";
      return result;
    }

    // Parse output
    for (const line of output.split("\n")) {
      const [key, ...valParts] = line.split("=");
      const val = valParts.join("=").trim();
      if (!val) continue;
      switch (key.trim()) {
        case "NAME": result.projectName = val; break;
        case "CUSTOMER": result.customerName = val; break;
        case "DEST": result.deliveryDest = val; break;
        case "START": result.startDate = val; break;
        case "QUOTE": result.latestQuote = val; break;
      }
    }
    result.available = true;
  } catch (e: any) {
    result.error = e.message?.substring(0, 200) || "Query execution failed";
  }

  return result;
}

// ─── Context Builder ─────────────────────────────────────────

export function buildProjectContext(projectId: string, opts?: {
  skipAccessDb?: boolean;
}): ProjectContext {
  return {
    projectId,
    dropbox: gatherDropboxContext(projectId),
    obsidian: gatherObsidianContext(projectId),
    accessDb: opts?.skipAccessDb ? {
      available: false,
      projectName: null,
      customerName: null,
      deliveryDest: null,
      startDate: null,
      latestQuote: null,
      error: "skipped",
    } : gatherAccessContext(projectId),
  };
}

/**
 * Format context into a prompt string for chat injection
 */
export function formatContextPrompt(ctx: ProjectContext): string {
  const lines: string[] = [
    `これは案件 ${ctx.projectId} の専用チャットです。以下の情報を記憶してください。`,
    "",
  ];

  // Dropbox section
  if (ctx.dropbox.folderName) {
    lines.push(`## Dropboxフォルダ: ${ctx.dropbox.folderName}`);
    if (ctx.dropbox.subfolders.length > 0) {
      lines.push(`📁 サブフォルダ: ${ctx.dropbox.subfolders.join(", ")}`);
    }
    if (ctx.dropbox.files.length > 0) {
      const fileList = ctx.dropbox.files.slice(0, 15).map((f) => f.name).join(", ");
      lines.push(`📄 ファイル (${ctx.dropbox.totalFiles}件): ${fileList}`);
      if (ctx.dropbox.totalFiles > 15) lines.push(`  (他 ${ctx.dropbox.totalFiles - 15} 件)`);
    }
    lines.push("");
  }

  // Access DB section
  if (ctx.accessDb.available) {
    lines.push("## ACCESS DB情報");
    if (ctx.accessDb.projectName) lines.push(`案件名: ${ctx.accessDb.projectName}`);
    if (ctx.accessDb.customerName) lines.push(`販売先: ${ctx.accessDb.customerName}`);
    if (ctx.accessDb.deliveryDest) lines.push(`納品先: ${ctx.accessDb.deliveryDest}`);
    if (ctx.accessDb.startDate) lines.push(`開始日: ${ctx.accessDb.startDate}`);
    if (ctx.accessDb.latestQuote) lines.push(`最新見積: ${ctx.accessDb.latestQuote}`);
    lines.push("");
  } else if (ctx.accessDb.error && ctx.accessDb.error !== "skipped") {
    lines.push(`## ACCESS DB: 取得不可 (${ctx.accessDb.error})`);
    lines.push("");
  }

  // Obsidian section
  if (ctx.obsidian.exists && ctx.obsidian.content) {
    lines.push("## Obsidianノート（既存）");
    // Only include frontmatter meta, not full content (too long)
    if (Object.keys(ctx.obsidian.meta).length > 0) {
      for (const [k, v] of Object.entries(ctx.obsidian.meta)) {
        if (v) lines.push(`${k}: ${v}`);
      }
    }
    // Include log section if short enough
    const logSection = ctx.obsidian.content.match(/## ログ\n([\s\S]*?)(?=\n## |$)/);
    if (logSection && logSection[1].length < 1000) {
      lines.push("");
      lines.push("### 直近のログ");
      lines.push(logSection[1].trim());
    }
    lines.push("");
  }

  // Instructions
  lines.push("## 役割");
  lines.push("- この案件に関する全情報を蓄積する");
  lines.push("- Gmail/LINE/iMessage等からの自動転送メッセージを受け取る");
  lines.push("- DJからの質問に案件の全文脈を踏まえて回答する");
  lines.push("");
  lines.push("以上の情報を記憶してください。今後このチャットに案件の情報が随時追加されます。「了解」とだけ返答してください。");

  return lines.join("\n");
}
