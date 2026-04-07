import { describe, test, expect, mock, spyOn, beforeEach, afterEach, afterAll } from "bun:test";
import { unlinkSync, existsSync, writeFileSync, readFileSync } from "fs";
import * as jsonLoaderModule from "../../utils/json-loader";

// --- Mocks ---

const loadJsonFileSpy = spyOn(jsonLoaderModule, "loadJsonFile").mockImplementation(
  (path: string, fallback?: any) => {
    try {
      const content = readFileSync(path, "utf-8");
      return JSON.parse(content);
    } catch (e) {
      return fallback ?? null;
    }
  }
);

// --- Import module under test ---
import {
  MAX_BUFFER,
  getLock,
  createHandoffLock,
  removeHandoffLock,
  getBufferCount,
} from "../domain-buffer";

const TEST_DOMAIN = "test-domain-unit";
const LOCK_FILE = `/tmp/domain-lock-${TEST_DOMAIN}.json`;
const BUFFER_FILE = `/tmp/domain-buffer-${TEST_DOMAIN}.jsonl`;

function cleanup() {
  try { unlinkSync(LOCK_FILE); } catch (e) {}
  try { unlinkSync(BUFFER_FILE); } catch (e) {}
  try { unlinkSync("/tmp/domain-relay-tab.lock"); } catch (e) {}
}

beforeEach(cleanup);
afterEach(cleanup);

describe("MAX_BUFFER", () => {
  test("is defined and is 10", () => {
    expect(MAX_BUFFER).toBe(10);
  });
});

describe("createHandoffLock / getLock / removeHandoffLock", () => {
  test("creates a handoff lock for domain", () => {
    createHandoffLock(TEST_DOMAIN);
    expect(existsSync(LOCK_FILE)).toBe(true);
    const lock = getLock(TEST_DOMAIN);
    expect(lock).not.toBeNull();
    expect(lock!.type).toBe("handoff");
    expect(lock!.domain).toBe(TEST_DOMAIN);
    expect(lock!.pid).toBe(process.pid);
  });

  test("removes handoff lock", () => {
    createHandoffLock(TEST_DOMAIN);
    expect(existsSync(LOCK_FILE)).toBe(true);
    removeHandoffLock(TEST_DOMAIN);
    expect(existsSync(LOCK_FILE)).toBe(false);
  });

  test("getLock returns null when no lock exists", () => {
    const lock = getLock(TEST_DOMAIN);
    expect(lock).toBeNull();
  });

  test("getLock detects stale handoff lock (>600s)", () => {
    // Write a stale lock (old timestamp)
    const staleData = {
      type: "handoff",
      pid: 99999999, // non-existent PID
      since: new Date(Date.now() - 700_000).toISOString(),
      domain: TEST_DOMAIN,
    };
    writeFileSync(LOCK_FILE, JSON.stringify(staleData));
    const lock = getLock(TEST_DOMAIN);
    expect(lock).toBeNull(); // Should be cleaned up
  });
});

describe("getBufferCount", () => {
  test("returns 0 when no buffer file exists", () => {
    expect(getBufferCount(TEST_DOMAIN)).toBe(0);
  });

  test("returns correct count for buffered messages", () => {
    const entries = [
      JSON.stringify({ ts: new Date().toISOString(), text: "msg1" }),
      JSON.stringify({ ts: new Date().toISOString(), text: "msg2" }),
      JSON.stringify({ ts: new Date().toISOString(), text: "msg3" }),
    ];
    writeFileSync(BUFFER_FILE, entries.join("\n") + "\n");
    expect(getBufferCount(TEST_DOMAIN)).toBe(3);
  });

  test("returns 0 for empty buffer file", () => {
    // Ensure clean state first
    try { unlinkSync(BUFFER_FILE); } catch (e) {}
    writeFileSync(BUFFER_FILE, "");
    expect(getBufferCount(TEST_DOMAIN)).toBe(0);
  });
});

describe("domain buffer integration", () => {
  test("buffer capacity matches MAX_BUFFER constant", () => {
    expect(MAX_BUFFER).toBe(10);
  });

  test("lock paths are domain-specific", () => {
    createHandoffLock("domain-a");
    createHandoffLock("domain-b");
    expect(existsSync("/tmp/domain-lock-domain-a.json")).toBe(true);
    expect(existsSync("/tmp/domain-lock-domain-b.json")).toBe(true);
    removeHandoffLock("domain-a");
    removeHandoffLock("domain-b");
  });
});

afterAll(() => {
  loadJsonFileSpy.mockRestore();
});
