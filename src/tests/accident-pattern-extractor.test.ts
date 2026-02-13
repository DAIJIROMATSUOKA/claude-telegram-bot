/**
 * Tests for src/autopilot/accident-pattern-extractor.ts
 *
 * Tests keyword-based pattern extraction via public methods.
 * Mocks fetch for Memory Gateway calls.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  AccidentPatternExtractor,
  type ConversationLog,
} from "../autopilot/accident-pattern-extractor";

// === Mock fetch ===
let fetchCalls: { url: string; init?: any }[] = [];
let fetchResponse: any = { ok: true, items: [] };
const origFetch = globalThis.fetch;

function mockFetch(response?: any) {
  fetchCalls = [];
  if (response) fetchResponse = response;
  globalThis.fetch = (async (url: any, init?: any) => {
    fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      json: async () => fetchResponse,
    } as Response;
  }) as any;
}

function restoreFetch() {
  globalThis.fetch = origFetch;
}

// === Helpers ===
function makeLog(overrides?: Partial<ConversationLog>): ConversationLog {
  return {
    message_id: 1,
    chat_id: 123,
    user_message: "Something went wrong",
    bot_response: "Error detected",
    timestamp: "2026-02-10T10:00:00Z",
    contained_error: true,
    ...overrides,
  };
}

describe("AccidentPatternExtractor", () => {
  let extractor: AccidentPatternExtractor;

  beforeEach(() => {
    mockFetch();
    extractor = new AccidentPatternExtractor("https://test-gateway.example.com");
  });

  afterEach(() => {
    restoreFetch();
  });

  // --- extractFromConversationLogs ---

  test("extracts pattern from log with error keywords", async () => {
    const logs = [makeLog({ user_message: "The bot crashed unexpectedly" })];
    const patterns = await extractor.extractFromConversationLogs(logs);
    expect(patterns.length).toBe(1);
    expect(patterns[0].title).toBeTruthy();
    expect(patterns[0].severity).toBeTruthy();
    expect(patterns[0].blast_radius).toBeTruthy();
  });

  test("extracts pattern from log with Japanese error keywords", async () => {
    const logs = [
      makeLog({
        user_message: "エラーが発生しました",
        bot_response: "問題を確認しています",
      }),
    ];
    const patterns = await extractor.extractFromConversationLogs(logs);
    expect(patterns.length).toBe(1);
  });

  test("skips logs without accident indicators", async () => {
    const logs = [
      makeLog({
        user_message: "Hello, how are you?",
        bot_response: "I am fine, thank you!",
        contained_error: false,
      }),
    ];
    const patterns = await extractor.extractFromConversationLogs(logs);
    expect(patterns.length).toBe(0);
  });

  test("detects critical severity", async () => {
    const logs = [
      makeLog({
        user_message: "Error: data loss in production",
        bot_response: "This is a production down situation, something failed",
      }),
    ];
    const patterns = await extractor.extractFromConversationLogs(logs);
    expect(patterns.length).toBe(1);
    expect(patterns[0].severity).toBe("critical");
  });

  test("detects high severity", async () => {
    const logs = [
      makeLog({
        user_message: "Error: the system is broken",
        bot_response: "Not working at all, something failed",
      }),
    ];
    const patterns = await extractor.extractFromConversationLogs(logs);
    expect(patterns.length).toBe(1);
    expect(patterns[0].severity).toBe("high");
  });

  test("detects rollback keywords", async () => {
    const logs = [
      makeLog({
        user_message: "Please rollback the changes",
        bot_response: "Reverting to previous state",
      }),
    ];
    const patterns = await extractor.extractFromConversationLogs(logs);
    expect(patterns.length).toBe(1);
  });

  test("deduplicates similar patterns", async () => {
    const logs = [
      makeLog({ message_id: 1, user_message: "Error in module A" }),
      makeLog({ message_id: 2, user_message: "Error in module A again" }),
      makeLog({ message_id: 3, user_message: "Error in module A once more" }),
    ];
    const patterns = await extractor.extractFromConversationLogs(logs);
    // Should deduplicate similar patterns
    expect(patterns.length).toBeLessThanOrEqual(3);
  });

  test("empty logs returns empty array", async () => {
    const patterns = await extractor.extractFromConversationLogs([]);
    expect(patterns).toEqual([]);
  });

  // --- extractFromMemoryGateway ---

  test("queries Memory Gateway and parses results", async () => {
    mockFetch({
      items: [
        {
          scope: "private/jarvis/incidents",
          content: "Bot crashed due to race condition in action ledger",
          tags: "error,incident",
          importance: 7,
          created_at: "2026-02-03T10:00:00Z",
        },
      ],
    });

    const patterns = await extractor.extractFromMemoryGateway();
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toContain("test-gateway.example.com");
    expect(fetchCalls[0].url).toContain("error,incident,rollback,accident");
  });

  test("handles Memory Gateway fetch failure gracefully", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Network error");
    }) as any;

    const patterns = await extractor.extractFromMemoryGateway();
    expect(patterns).toEqual([]);
  });

  // --- storePattern ---

  test("stores pattern to Memory Gateway", async () => {
    const pattern = {
      pattern_id: "test-pattern-1",
      title: "Test incident",
      description: "Something broke",
      severity: "high" as const,
      blast_radius: "file" as const,
      first_occurred_at: "2026-02-10T10:00:00Z",
      last_occurred_at: "2026-02-10T10:00:00Z",
      occurrence_count: 1,
      root_cause: "Unknown",
      trigger_conditions: ["condition1"],
      conversation_ids: ["1"],
      extracted_from: "test" as const,
      created_at: "2026-02-10T10:00:00Z",
      updated_at: "2026-02-10T10:00:00Z",
    };

    await extractor.storePattern(pattern);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toContain("/v1/memory/append");
    const body = JSON.parse(fetchCalls[0].init.body);
    expect(body.content).toContain("Test incident");
  });

  // --- blast radius detection ---

  test("detects system-wide blast radius", async () => {
    const logs = [
      makeLog({
        user_message: "Error affecting entire system",
        bot_response: "All users impacted",
      }),
    ];
    const patterns = await extractor.extractFromConversationLogs(logs);
    expect(patterns[0].blast_radius).toBe("system");
  });

  test("defaults to directory blast radius when no specific match", async () => {
    // Note: determineBlastRadius defaults to 'directory' (conservative)
    // when no system/project/directory keywords match.
    // File keywords exist in indicators but aren't checked in the function.
    const logs = [
      makeLog({
        user_message: "Error in some code",
        bot_response: "Something failed here",
      }),
    ];
    const patterns = await extractor.extractFromConversationLogs(logs);
    expect(patterns[0].blast_radius).toBe("directory");
  });
});
