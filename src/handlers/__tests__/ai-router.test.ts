import { describe, test, expect, mock, beforeEach } from "bun:test";

// --- Mocks ---

mock.module("../../constants", () => ({
  CMD_TIMEOUT_LONG_MS: 30000,
  COUNCIL_TIMEOUT_MS: 210000,
}));

const mockLogger = {
  info: mock(() => {}),
  error: mock(() => {}),
  warn: mock(() => {}),
  debug: mock(() => {}),
};
mock.module("../../utils/logger", () => ({ logger: mockLogger }));

const mockFetchWithTimeout = mock(() =>
  Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
);
mock.module("../../utils/fetch-with-timeout", () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}));

// --- Import module under test ---
import {
  parseRoutePrefix,
  getAIDisplayName,
  callMemoryGateway,
  type AIProvider,
} from "../ai-router";

beforeEach(() => {
  mockFetchWithTimeout.mockClear();
  mockLogger.info.mockClear();
  mockLogger.error.mockClear();
  mockLogger.warn.mockClear();
});

// ─── parseRoutePrefix ───

describe("parseRoutePrefix", () => {
  test("routes 'gpt: question' to gpt provider", () => {
    const result = parseRoutePrefix("gpt: what is AI?");
    expect(result.provider).toBe("gpt");
    expect(result.prompt).toBe("what is AI?");
  });

  test("routes 'gemini: question' to gemini provider", () => {
    const result = parseRoutePrefix("gemini: explain quantum");
    expect(result.provider).toBe("gemini");
    expect(result.prompt).toBe("explain quantum");
  });

  test("routes 'croppy: question' to croppy provider", () => {
    const result = parseRoutePrefix("croppy: hello");
    expect(result.provider).toBe("croppy");
    expect(result.prompt).toBe("hello");
  });

  test("routes 'all: question' to all provider", () => {
    const result = parseRoutePrefix("all: compare AIs");
    expect(result.provider).toBe("all");
    expect(result.prompt).toBe("compare AIs");
  });

  test("routes 'council: question' to council provider", () => {
    const result = parseRoutePrefix("council: discuss strategy");
    expect(result.provider).toBe("council");
    expect(result.prompt).toBe("discuss strategy");
  });

  test("defaults to jarvis when no prefix", () => {
    const result = parseRoutePrefix("just a normal message");
    expect(result.provider).toBe("jarvis");
    expect(result.prompt).toBe("just a normal message");
  });

  test("is case-insensitive for prefix", () => {
    const result = parseRoutePrefix("GPT: uppercase prefix");
    expect(result.provider).toBe("gpt");
    expect(result.prompt).toBe("uppercase prefix");
  });

  test("handles prefix with extra whitespace", () => {
    const result = parseRoutePrefix("  gemini:   spaced out  ");
    expect(result.provider).toBe("gemini");
    expect(result.prompt).toBe("spaced out");
  });

  test("does not match partial prefix in middle of text", () => {
    const result = parseRoutePrefix("I used gpt: yesterday");
    expect(result.provider).toBe("jarvis");
  });

  test("handles empty string", () => {
    const result = parseRoutePrefix("");
    expect(result.provider).toBe("jarvis");
    expect(result.prompt).toBe("");
  });
});

// ─── getAIDisplayName ───

describe("getAIDisplayName", () => {
  test("returns Jarvis for jarvis provider", () => {
    expect(getAIDisplayName("jarvis")).toContain("Jarvis");
  });

  test("returns display name for gpt", () => {
    expect(getAIDisplayName("gpt")).toContain("チャッピー");
  });

  test("returns display name for gemini", () => {
    expect(getAIDisplayName("gemini")).toContain("ジェミー");
  });

  test("returns display name for croppy", () => {
    expect(getAIDisplayName("croppy")).toContain("クロッピー");
  });

  test("returns display name for all", () => {
    expect(getAIDisplayName("all")).toContain("All AIs");
  });

  test("returns display name for council", () => {
    expect(getAIDisplayName("council")).toContain("Council");
  });

  test("returns Unknown AI for unknown provider", () => {
    expect(getAIDisplayName("unknown" as AIProvider)).toBe("Unknown AI");
  });
});

// ─── callMemoryGateway ───

describe("callMemoryGateway", () => {
  test("returns data on successful GET request", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ results: [1, 2, 3] }), { status: 200 }))
    );
    const result = await callMemoryGateway("/v1/test", "GET");
    expect(result.data).toEqual({ results: [1, 2, 3] });
    expect(result.error).toBeUndefined();
  });

  test("returns data on successful POST request with body", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
    );
    const result = await callMemoryGateway("/v1/db/query", "POST", { sql: "SELECT 1" });
    expect(result.data).toEqual({ success: true });
    const callArgs = mockFetchWithTimeout.mock.calls[0] as any[];
    const opts = callArgs[1] as any;
    expect(JSON.parse(opts.body)).toEqual({ sql: "SELECT 1" });
  });

  test("returns error on HTTP failure", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve(new Response("Not Found", { status: 404, statusText: "Not Found" }))
    );
    const result = await callMemoryGateway("/v1/missing", "GET");
    expect(result.error).toContain("404");
  });

  test("returns error on network exception", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.reject(new Error("Connection refused"))
    );
    const result = await callMemoryGateway("/v1/test", "GET");
    expect(result.error).toBe("Connection refused");
  });
});
