/**
 * Tests for src/utils/red-team.ts
 *
 * Pure logic tests - no external dependencies to mock.
 */
import { describe, test, expect } from "bun:test";
import { RedTeamValidator, validateProposal, defaultRedTeam } from "../utils/red-team";
import type { PluginProposal } from "../autopilot/types";

function makeProposal(overrides?: Partial<PluginProposal>): PluginProposal {
  return {
    task: {
      id: "T-001",
      type: "test",
      title: "Test Task",
      description: "A test task description",
      reason: "Testing",
      confidence: 0.9,
      impact: "low",
      created_at: "2026-02-13T00:00:00Z",
      status: "pending",
      source_plugin: "test",
    },
    action_plan: ["Step 1: Prepare", "Step 2: Execute", "Step 3: Verify results"],
    estimated_duration: "5m",
    risks: ["Potential timeout if network is slow"],
    approval_required: false,
    ...overrides,
  };
}

describe("RedTeamValidator", () => {
  const validator = new RedTeamValidator();

  // --- Approval ---

  test("approves low-impact high-confidence proposal", () => {
    const result = validator.validate(makeProposal());
    expect(result.approved).toBe(true);
    expect(result.risk_score).toBeLessThan(0.5);
  });

  test("rejects proposal with empty action plan", () => {
    const result = validator.validate(
      makeProposal({ action_plan: [] }),
    );
    expect(result.approved).toBe(false);
    expect(result.issues.some((i) => i.category === "completeness")).toBe(true);
  });

  test("rejects critical impact with low confidence", () => {
    const result = validator.validate(
      makeProposal({
        task: {
          ...makeProposal().task,
          impact: "critical",
          confidence: 0.5,
        },
      }),
    );
    expect(result.approved).toBe(false);
    expect(result.issues.some((i) => i.severity === "critical")).toBe(true);
  });

  test("rejects critical task without approval_required", () => {
    const result = validator.validate(
      makeProposal({
        task: {
          ...makeProposal().task,
          impact: "critical",
          confidence: 0.95,
        },
        approval_required: false,
      }),
    );
    expect(result.approved).toBe(false);
    expect(result.issues.some((i) => i.message.includes("approval"))).toBe(true);
  });

  // --- Risk Assessment ---

  test("warns when no risks for non-low impact", () => {
    const result = validator.validate(
      makeProposal({
        task: { ...makeProposal().task, impact: "medium" },
        risks: [],
      }),
    );
    expect(result.issues.some((i) => i.category === "risk")).toBe(true);
  });

  test("no risk warning for low impact with empty risks", () => {
    const result = validator.validate(
      makeProposal({ risks: [] }),
    );
    const riskIssues = result.issues.filter(
      (i) => i.category === "risk" && i.message.includes("No risks identified"),
    );
    expect(riskIssues.length).toBe(0);
  });

  test("flags vague risk descriptions", () => {
    const result = validator.validate(
      makeProposal({ risks: ["short"] }),
    );
    expect(result.issues.some((i) => i.message.includes("vague"))).toBe(true);
  });

  // --- Action Plan ---

  test("warns about single-step action plan", () => {
    const result = validator.validate(
      makeProposal({ action_plan: ["Do everything"] }),
    );
    expect(result.issues.some((i) => i.message.includes("one step"))).toBe(true);
  });

  test("warns about missing verification steps for non-low impact", () => {
    const result = validator.validate(
      makeProposal({
        task: { ...makeProposal().task, impact: "medium" },
        action_plan: ["Step 1: Deploy", "Step 2: Done"],
      }),
    );
    expect(result.issues.some((i) => i.message.includes("verification"))).toBe(true);
  });

  test("no verification warning when plan includes test step", () => {
    const result = validator.validate(
      makeProposal({
        task: { ...makeProposal().task, impact: "high" },
        action_plan: ["Step 1: Deploy", "Step 2: Run test suite"],
        risks: ["Deployment failure possible, rollback plan ready"],
      }),
    );
    const verifyIssues = result.issues.filter((i) => i.message.includes("verification"));
    expect(verifyIssues.length).toBe(0);
  });

  // --- Rollback ---

  test("error when high-impact has no rollback", () => {
    const result = validator.validate(
      makeProposal({
        task: { ...makeProposal().task, impact: "high" },
        action_plan: ["Step 1: Deploy", "Step 2: Verify"],
        risks: ["Something could go wrong"],
      }),
    );
    expect(result.issues.some((i) => i.category === "rollback")).toBe(true);
  });

  test("no rollback error when action plan includes rollback", () => {
    const result = validator.validate(
      makeProposal({
        task: { ...makeProposal().task, impact: "high" },
        action_plan: ["Step 1: Deploy", "Step 2: Verify", "Step 3: Rollback if needed"],
        risks: ["Deployment could fail"],
      }),
    );
    const rollbackIssues = result.issues.filter((i) => i.category === "rollback");
    expect(rollbackIssues.length).toBe(0);
  });

  // --- Dependencies ---

  test("warns about external deps without timeout", () => {
    const result = validator.validate(
      makeProposal({
        task: {
          ...makeProposal().task,
          description: "Call external API to fetch data",
        },
      }),
    );
    expect(result.issues.some((i) => i.category === "dependency")).toBe(true);
  });

  test("no dep warning when timeout mentioned", () => {
    const result = validator.validate(
      makeProposal({
        task: {
          ...makeProposal().task,
          description: "Call external API with timeout and retry logic",
        },
      }),
    );
    const depIssues = result.issues.filter((i) => i.category === "dependency");
    expect(depIssues.length).toBe(0);
  });

  // --- Risk Score ---

  test("risk score increases with impact level", () => {
    const low = validator.validate(
      makeProposal({ task: { ...makeProposal().task, impact: "low" } }),
    );
    const high = validator.validate(
      makeProposal({
        task: { ...makeProposal().task, impact: "high" },
        action_plan: ["Deploy", "Check", "Rollback if needed"],
        risks: ["Deployment could fail with rollback"],
      }),
    );
    expect(high.risk_score).toBeGreaterThan(low.risk_score);
  });

  test("risk score capped at 1.0", () => {
    const result = validator.validate(
      makeProposal({
        task: { ...makeProposal().task, impact: "critical", confidence: 0.1 },
        action_plan: [],
        risks: [],
      }),
    );
    expect(result.risk_score).toBeLessThanOrEqual(1.0);
  });

  // --- Confidence Adjustment ---

  test("positive adjustment when no issues", () => {
    const result = validator.validate(makeProposal());
    expect(result.confidence_adjustment).toBeGreaterThanOrEqual(0);
  });

  test("negative adjustment with issues", () => {
    const result = validator.validate(
      makeProposal({
        task: { ...makeProposal().task, impact: "critical", confidence: 0.5 },
      }),
    );
    expect(result.confidence_adjustment).toBeLessThan(0);
  });

  test("adjustment clamped to [-0.2, 0.1]", () => {
    const result = validator.validate(
      makeProposal({
        task: { ...makeProposal().task, impact: "critical", confidence: 0.1 },
        action_plan: [],
        risks: [],
      }),
    );
    expect(result.confidence_adjustment).toBeGreaterThanOrEqual(-0.2);
    expect(result.confidence_adjustment).toBeLessThanOrEqual(0.1);
  });

  // --- Summary ---

  test("summary includes risk score", () => {
    const result = validator.validate(makeProposal());
    expect(result.summary).toContain("Risk score:");
  });

  test("rejected summary includes critical/error counts", () => {
    const result = validator.validate(
      makeProposal({
        task: { ...makeProposal().task, impact: "critical", confidence: 0.5 },
      }),
    );
    expect(result.summary).toContain("❌");
  });

  // --- Module exports ---

  test("defaultRedTeam is a RedTeamValidator instance", () => {
    expect(defaultRedTeam).toBeInstanceOf(RedTeamValidator);
  });

  test("validateProposal convenience function works", () => {
    const result = validateProposal(makeProposal());
    expect(result.approved).toBe(true);
    expect(typeof result.risk_score).toBe("number");
  });
});
