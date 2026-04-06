import { describe, test, expect, mock, beforeEach } from "bun:test";

// --- Mocks (before importing module under test) ---

const mockAcquire = mock(() => Promise.resolve());
mock.module("../../utils/rate-limiter", () => ({
  gatewayRateLimiter: { acquire: mockAcquire },
}));

const mockWithRetry = mock((fn: () => Promise<any>) => fn());
mock.module("../../utils/retry", () => ({
  withRetry: mockWithRetry,
}));

// Mock global fetch
const mockFetch = mock(() =>
  Promise.resolve(new Response(JSON.stringify({ success: true, results: [{ id: 1 }], meta: {} }), { status: 200 }))
);
const originalFetch = globalThis.fetch;

// --- Import module under test ---
import { gatewayQuery } from "../gateway-db";

beforeEach(() => {
  mockAcquire.mockClear();
  mockWithRetry.mockClear();
  mockWithRetry.mockImplementation((fn: () => Promise<any>) => fn());
  mockFetch.mockReset();
  mockFetch.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ success: true, results: [{ id: 1 }], meta: {} }), { status: 200 }))
  );
  globalThis.fetch = mockFetch as any;
});

describe("gatewayQuery", () => {
  test("executes SELECT query and returns results", async () => {
    const result = await gatewayQuery("SELECT * FROM users WHERE id = ?", [1]);
    expect(result).not.toBeNull();
    expect(result!.results).toEqual([{ id: 1 }]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0]! as any[];
    expect(callArgs[0]).toContain("/v1/db/query");
    const body = JSON.parse((callArgs[1] as any).body);
    expect(body.sql).toBe("SELECT * FROM users WHERE id = ?");
    expect(body.params).toEqual([1]);
  });

  test("executes INSERT query", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, results: [], meta: { changes: 1 } }), { status: 200 }))
    );
    const result = await gatewayQuery("INSERT INTO users (name) VALUES (?)", ["DJ"]);
    expect(result).not.toBeNull();
    expect(result!.meta).toEqual({ changes: 1 });
  });

  test("executes UPDATE query", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, results: [], meta: { changes: 2 } }), { status: 200 }))
    );
    const result = await gatewayQuery("UPDATE users SET name = ? WHERE id = ?", ["NewName", 1]);
    expect(result).not.toBeNull();
    expect(result!.meta).toEqual({ changes: 2 });
  });

  test("executes DELETE query", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, results: [], meta: { changes: 1 } }), { status: 200 }))
    );
    const result = await gatewayQuery("DELETE FROM users WHERE id = ?", [5]);
    expect(result).not.toBeNull();
  });

  test("returns null on network failure", async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error("Network error")));
    mockWithRetry.mockImplementation(async (fn: () => Promise<any>) => { throw new Error("Network error"); });
    const result = await gatewayQuery("SELECT 1");
    expect(result).toBeNull();
  });

  test("returns null on HTTP error", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500 }))
    );
    mockWithRetry.mockImplementation(async (fn: () => Promise<any>) => {
      const res = await fn();
      return res;
    });
    // The function catches the thrown error and returns null
    mockWithRetry.mockImplementation(async () => { throw new Error("HTTP 500"); });
    const result = await gatewayQuery("SELECT 1");
    expect(result).toBeNull();
  });

  test("returns null when query fails (success: false)", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false, error: "invalid SQL" }), { status: 200 }))
    );
    mockWithRetry.mockImplementation(async (fn: () => Promise<any>) => {
      return fn();
    });
    // success: false throws, which gets caught
    const result = await gatewayQuery("INVALID SQL");
    expect(result).toBeNull();
  });

  test("handles empty results correctly", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, results: [], meta: {} }), { status: 200 }))
    );
    const result = await gatewayQuery("SELECT * FROM users WHERE id = 999");
    expect(result).not.toBeNull();
    expect(result!.results).toEqual([]);
  });

  test("acquires rate limiter before query", async () => {
    await gatewayQuery("SELECT 1");
    expect(mockAcquire).toHaveBeenCalledWith("query");
    expect(mockAcquire).toHaveBeenCalledTimes(1);
  });

  test("sends correct headers including API key", async () => {
    await gatewayQuery("SELECT 1");
    const callArgs = mockFetch.mock.calls[0]! as any[];
    const opts = callArgs[1] as any;
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.headers).toHaveProperty("X-API-Key");
  });
});
