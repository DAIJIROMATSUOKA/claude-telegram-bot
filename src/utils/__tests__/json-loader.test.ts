import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadJsonFile } from "../json-loader";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

const TEST_DIR = "/tmp/json-loader-test";
const TEST_FILE = join(TEST_DIR, "test.json");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  try { unlinkSync(TEST_FILE); } catch {}
});

describe("loadJsonFile", () => {
  it("loads valid JSON file", () => {
    writeFileSync(TEST_FILE, JSON.stringify({ name: "test", count: 42 }));
    const result = loadJsonFile<{ name: string; count: number }>(TEST_FILE);
    expect(result).toEqual({ name: "test", count: 42 });
  });

  it("loads JSON array", () => {
    writeFileSync(TEST_FILE, JSON.stringify([1, 2, 3]));
    const result = loadJsonFile<number[]>(TEST_FILE);
    expect(result).toEqual([1, 2, 3]);
  });

  it("returns fallback when file not found", () => {
    const result = loadJsonFile("/tmp/json-loader-test/nonexistent.json", { default: true });
    expect(result).toEqual({ default: true });
  });

  it("returns fallback for invalid JSON", () => {
    writeFileSync(TEST_FILE, "not valid json {{{");
    const result = loadJsonFile(TEST_FILE, {});
    expect(result).toEqual({});
  });

  it("throws when file not found and no fallback", () => {
    expect(() => loadJsonFile("/tmp/json-loader-test/nonexistent.json")).toThrow("JSON file not found");
  });

  it("throws when invalid JSON and no fallback", () => {
    writeFileSync(TEST_FILE, "broken");
    expect(() => loadJsonFile(TEST_FILE)).toThrow();
  });

  it("returns null fallback correctly", () => {
    const result = loadJsonFile("/tmp/json-loader-test/nonexistent.json", null);
    expect(result).toBeNull();
  });

  it("returns empty array fallback", () => {
    const result = loadJsonFile("/tmp/json-loader-test/nonexistent.json", []);
    expect(result).toEqual([]);
  });
});
