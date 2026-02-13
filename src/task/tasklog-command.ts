/**
 * /tasklog - View Task Orchestrator run history
 *
 * Usage:
 *   /tasklog              - List recent 5 runs
 *   /tasklog <run_id>     - Show run summary detail
 *   /tasklog <run_id> events - Show event log
 */

import type { Context } from "grammy";
import { listRecentRuns, readRunSummary, readRunEvents } from "./run-logger";
import type { RunSummary } from "./run-logger";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function statusIcon(status: string): string {
  if (status === "all_passed") return "\u2705";
  if (status === "partial") return "\u26a0\ufe0f";
  return "\u274c";
}

function fmtDur(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

function fmtRunLine(r: RunSummary): string {
  const date = r.started_at.slice(5, 16).replace("T", " ");
  return (
    `${statusIcon(r.final_status)} <code>${esc(r.run_id.slice(0, 35))}</code>\n` +
    `   ${date} | ${r.passed_tasks}/${r.total_tasks} passed | ${fmtDur(r.total_duration_seconds)}`
  );
}

function fmtDetail(r: RunSummary): string {
  const lines: string[] = [
    `<b>${statusIcon(r.final_status)} ${esc(r.run_id)}</b>`,
    "",
    `Plan: <code>${esc(r.plan_id)}</code>`,
    `Title: ${esc(r.title)}`,
    `Started: ${r.started_at.slice(0, 19).replace("T", " ")}`,
    `Duration: ${fmtDur(r.total_duration_seconds)}`,
    `Result: ${r.passed_tasks}/${r.total_tasks} passed`,
    "",
  ];

  for (const t of r.task_results) {
    const icon = t.status === "passed" ? "\u2705" : "\u274c";
    lines.push(
      `${icon} <code>${esc(t.task_id)}</code> (${fmtDur(t.duration_seconds)}, exit=${t.exit_code})`,
    );
    if (t.violations.length > 0) {
      lines.push(`   Violations: ${esc(t.violations.join(", "))}`);
    }
    if (t.changed_files.length > 0) {
      const files = t.changed_files.slice(0, 5).map(esc).join(", ");
      lines.push(`   Files: ${files}${t.changed_files.length > 5 ? "..." : ""}`);
    }
  }

  return lines.join("\n");
}

export async function handleTaskLogCommand(ctx: Context): Promise<void> {
  const text = (ctx.message?.text || "").trim();
  const args = text.replace(/^\/tasklog\s*/, "").trim();

  if (!args) {
    const runs = listRecentRuns(5);
    if (runs.length === 0) {
      await ctx.reply("\ud83d\udcdd \u5b9f\u884c\u5c65\u6b74\u306a\u3057\u3002/task \u3067TaskPlan\u3092\u5b9f\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
      return;
    }
    const header = `\ud83d\udccb <b>Recent Task Runs</b> (${runs.length})\n\n`;
    const body = runs.map(fmtRunLine).join("\n\n");
    const footer = "\n\n\ud83d\udca1 <code>/tasklog run_id</code> \u3067\u8a73\u7d30\u8868\u793a";
    await ctx.reply(header + body + footer, { parse_mode: "HTML" });
    return;
  }

  const parts = args.split(/\s+/);
  const runId = parts[0];
  const showEvents = parts[1] === "events";

  if (showEvents) {
    const events = readRunEvents(runId);
    if (events.length === 0) {
      await ctx.reply(`\u274c Run not found: <code>${esc(runId)}</code>`, { parse_mode: "HTML" });
      return;
    }

    const lines = events.map((e) => {
      const time = e.timestamp.slice(11, 19);
      const dataStr = Object.keys(e.data).length > 0
        ? " " + JSON.stringify(e.data).slice(0, 120)
        : "";
      return `${time} ${e.event}${dataStr}`;
    });

    const joined = lines.join("\n");
    let msg = `\ud83d\uddd2 <b>Events: ${esc(runId.slice(0, 35))}</b>\n\n<code>${esc(joined).slice(0, 3500)}</code>`;
    if (joined.length > 3500) {
      msg += "\n\n(truncated)";
    }
    await ctx.reply(msg, { parse_mode: "HTML" });
    return;
  }

  const summary = readRunSummary(runId);
  if (!summary) {
    await ctx.reply(`\u274c Run not found: <code>${esc(runId)}</code>`, { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(fmtDetail(summary), { parse_mode: "HTML" });
}
