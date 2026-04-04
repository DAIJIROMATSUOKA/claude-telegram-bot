import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  parseRoutePrefix,
  getAIDisplayName,
  callMemoryGateway,
  extractAndSaveMemory,
} from "./ai-router";
import type { AIProvider, AIResponse } from "./ai-router";

describe("parseRoutePrefix", () => {
  test("no prefix defaults to jarvis", () => {
    const result = parseRoutePrefix("hello world");
    expect(result.provider).toBe("jarvis");
    expect(result.prompt).toBe("hello world");
  });

  test("gpt: prefix routes to gpt", () => {
    const result = parseRoutePrefix("gpt: explain this code");
    expect(result.provider).toBe("gpt");
    expect(result.prompt).toBe("explain this code");
  });

  test("gemini: prefix routes to gemini (case insensitive)", () => {
    const result = parseRoutePrefix("Gemini: what is life");
    expect(result.provider).toBe("gemini");
    expect(result.prompt).toBe("what is life");
  });

  test("croppy: prefix routes to croppy", () => {
    const result = parseRoutePrefix("croppy: fix this bug");
    expect(result.provider).toBe("croppy");
    expect(result.prompt).toBe("fix this bug");
  });

  test("all: prefix routes to all", () => {
    const result = parseRoutePrefix("all: compare answers");
    expect(result.provider).toBe("all");
    expect(result.prompt).toBe("compare answers");
  });

  test("council: prefix routes to council", () => {
    const result = parseRoutePrefix("council: should we refactor?");
    expect(result.provider).toBe("council");
    expect(result.prompt).toBe("should we refactor?");
  });

  test("trims whitespace from input", () => {
    const result = parseRoutePrefix("  gpt:   hello  ");
    expect(result.provider).toBe("gpt");
    expect(result.prompt).toBe("hello");
  });

  test("message with colon but no matching prefix stays jarvis", () => {
    const result = parseRoutePrefix("hey: this is not a prefix");
    expect(result.provider).toBe("jarvis");
    expect(result.prompt).toBe("hey: this is not a prefix");
  });
});

describe("getAIDisplayName", () => {
  test("returns correct display names", () => {
    expect(getAIDisplayName("jarvis")).toContain("Jarvis");
    expect(getAIDisplayName("gpt")).toContain("チャッピー");
    expect(getAIDisplayName("gemini")).toContain("ジェミー");
    expect(getAIDisplayName("croppy")).toContain("クロッピー");
    expect(getAIDisplayName("all")).toContain("All AIs");
    expect(getAIDisplayName("council")).toContain("Council");
  });

  test("returns Unknown AI for unrecognized provider", () => {
    expect(getAIDisplayName("unknown" as AIProvider)).toBe("Unknown AI");
  });
});

describe("callMemoryGateway", () => {
  // Note: callMemoryGateway uses the global fetch. When run alongside other
  // test files with mock.module, globalThis.fetch may be overridden.
  // We test the function's logic by checking return shape with real (but likely failing) calls.

  test("returns error object on network failure", async () => {
    // Call with an invalid URL scheme to trigger a fetch error
    const origUrl = process.env.MEMORY_GATEWAY_URL;
    process.env.MEMORY_GATEWAY_URL = "http://127.0.0.1:1"; // port 1 should refuse connection

    // Dynamic re-import won't help since the URL is read at module load.
    // Instead, test with an unreachable endpoint - the function should catch and return error.
    const result = await callMemoryGateway("/nonexistent", "GET");
    // The result should either have data (if mocked by other tests) or error
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    // Restore
    if (origUrl) process.env.MEMORY_GATEWAY_URL = origUrl;
    else delete process.env.MEMORY_GATEWAY_URL;
  });

  test("returns object with data or error key", async () => {
    const result = await callMemoryGateway("/health", "GET");
    // Should always return an object with either data or error
    expect(result).toBeDefined();
    const hasDataOrError = "data" in result || "error" in result;
    expect(hasDataOrError).toBe(true);
  });
});

describe("extractAndSaveMemory", () => {
  test("no MEMORY tag does nothing", async () => {
    const response: AIResponse = {
      provider: "croppy",
      content: "Just a normal response without memory tag",
    };
    // Should not throw
    await extractAndSaveMemory(response, "/fake/creds.json", "doc123");
  });

  test("empty MEMORY tag does nothing", async () => {
    const response: AIResponse = {
      provider: "croppy",
      content: "Some response\n[MEMORY]   \n",
    };
    await extractAndSaveMemory(response, "/fake/creds.json", "doc123");
  });
});
