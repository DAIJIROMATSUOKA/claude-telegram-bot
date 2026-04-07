import { describe, test, expect, mock, spyOn, beforeEach, afterAll } from "bun:test";
import * as aiRouterModule from "../../handlers/ai-router";

// --- Mocks (before importing module under test) ---

const mockCallMemoryGateway = mock<(_path: string, _method: string, _body: any) => Promise<any>>(() =>
  Promise.resolve({ data: { results: [], meta: { changes: 0 } } })
);

const callMemoryGatewaySpy = spyOn(aiRouterModule, "callMemoryGateway").mockImplementation(
  (...args: any[]) => (mockCallMemoryGateway as any)(...args)
);

// Mock global fetch for embed server calls
const originalFetch = globalThis.fetch;
const mockFetch = mock(() =>
  Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
);

// --- Import module under test ---
import {
  ensureMemoryTables,
  getProfile,
  getProfileFull,
  upsertProfile,
  deleteProfileKey,
  getActiveProjects,
  upsertProject,
  deleteProject,
  addPendingMemory,
  getPendingMemories,
  approvePendingMemory,
  rejectPendingMemory,
  routeMemoryByConfidence,
  saveConversationSummary,
  getRecentSummaries,
  storeEmbedding,
  searchMemories,
  runVectorGC,
  runSummaryGC,
  runPendingGC,
  buildMemoryContext,
} from "../jarvis-memory";

beforeEach(() => {
  mockCallMemoryGateway.mockReset();
  mockCallMemoryGateway.mockImplementation(() =>
    Promise.resolve({ data: { results: [], meta: { changes: 0 } } })
  );
  mockFetch.mockReset();
  mockFetch.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
  );
  globalThis.fetch = mockFetch as any;
});

// ─── 1. Memory append: upsertProfile single entry ───

describe("upsertProfile", () => {
  test("inserts a new profile entry via callMemoryGateway", async () => {
    const result = await upsertProfile("name", "DJ", "identity", 0.9, "manual");
    expect(result).toBe(true);
    // manual source skips conflict check, goes straight to INSERT
    expect(mockCallMemoryGateway).toHaveBeenCalledWith(
      "/v1/db/query",
      "POST",
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO jarvis_user_profile"),
        params: ["name", "DJ", "identity", 0.9, "manual"],
      })
    );
  });

  test("extracted source checks existing and skips if manual-protected", async () => {
    // First call: conflict check returns manual source
    mockCallMemoryGateway.mockImplementationOnce(() =>
      Promise.resolve({
        data: { results: [{ source: "manual", confidence: 1.0 }] },
      })
    );
    const result = await upsertProfile("name", "New Name", "identity", 0.8, "extracted");
    expect(result).toBe(false);
  });

  test("extracted source skips if existing confidence is higher", async () => {
    mockCallMemoryGateway.mockImplementationOnce(() =>
      Promise.resolve({
        data: { results: [{ source: "extracted", confidence: 0.95 }] },
      })
    );
    const result = await upsertProfile("hobby", "coding", "general", 0.8, "extracted");
    expect(result).toBe(false);
  });

  test("extracted source overwrites if new confidence is higher", async () => {
    mockCallMemoryGateway.mockImplementationOnce(() =>
      Promise.resolve({
        data: { results: [{ source: "extracted", confidence: 0.5 }] },
      })
    );
    const result = await upsertProfile("hobby", "coding", "general", 0.9, "extracted");
    expect(result).toBe(true);
    // 2 calls: conflict check + actual upsert
    expect(mockCallMemoryGateway).toHaveBeenCalledTimes(2);
  });
});

// ─── 2. Memory append: batch profile updates ───

describe("batch profile updates", () => {
  test("multiple upsertProfile calls succeed independently", async () => {
    const results = await Promise.all([
      upsertProfile("k1", "v1", "general", 1.0, "manual"),
      upsertProfile("k2", "v2", "work", 1.0, "manual"),
      upsertProfile("k3", "v3", "identity", 1.0, "manual"),
    ]);
    expect(results).toEqual([true, true, true]);
    // Each manual insert = 1 call (no conflict check)
    expect(mockCallMemoryGateway).toHaveBeenCalledTimes(3);
  });
});

// ─── 3. Memory query: getProfile retrieval ───

describe("getProfile", () => {
  test("returns key-value map from gateway results", async () => {
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.resolve({
        data: {
          results: [
            { key: "name", value: "DJ", source: "manual", confidence: 1.0 },
            { key: "city", value: "Kashiwa", source: "extracted", confidence: 0.8 },
          ],
        },
      })
    );
    const profile = await getProfile();
    expect(profile).toEqual({ name: "DJ", city: "Kashiwa" });
  });

  test("returns empty object on error", async () => {
    mockCallMemoryGateway.mockImplementation(() => Promise.reject(new Error("down")));
    const profile = await getProfile();
    expect(profile).toEqual({});
  });
});

// ─── 4. Memory query: getProfileFull with metadata ───

describe("getProfileFull", () => {
  test("returns full profile rows with metadata", async () => {
    const rows = [
      { key: "name", value: "DJ", category: "identity", source: "manual", confidence: 1.0 },
    ];
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.resolve({ data: { results: rows } })
    );
    const result = await getProfileFull();
    expect(result).toEqual(rows);
    expect(result[0]!.source).toBe("manual");
    expect(result[0]!.category).toBe("identity");
  });

  test("returns empty array on error", async () => {
    mockCallMemoryGateway.mockImplementation(() => Promise.reject(new Error("fail")));
    const result = await getProfileFull();
    expect(result).toEqual([]);
  });
});

// ─── 5. Memory update: deleteProfileKey ───

describe("deleteProfileKey", () => {
  test("sends DELETE query for the given key", async () => {
    await deleteProfileKey("obsolete_key");
    expect(mockCallMemoryGateway).toHaveBeenCalledWith("/v1/db/query", "POST", {
      sql: "DELETE FROM jarvis_user_profile WHERE key = ?",
      params: ["obsolete_key"],
    });
  });
});

// ─── 6. Project management ───

describe("project management", () => {
  test("upsertProject sends correct SQL with JSON-encoded fields", async () => {
    await upsertProject("p1", "Test Project", {
      goals: "Ship v2",
      constraints: ["budget < 100K"],
      decisions: ["use Bun"],
      status: "active",
    });
    expect(mockCallMemoryGateway).toHaveBeenCalledWith(
      "/v1/db/query",
      "POST",
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO jarvis_projects"),
        params: [
          "p1",
          "Test Project",
          "active",
          "Ship v2",
          JSON.stringify(["budget < 100K"]),
          JSON.stringify(["use Bun"]),
        ],
      })
    );
  });

  test("getActiveProjects returns project list", async () => {
    const projects = [{ id: "p1", name: "Test", status: "active", goals: "Ship" }];
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.resolve({ data: { results: projects } })
    );
    const result = await getActiveProjects();
    expect(result).toEqual(projects);
  });

  test("getActiveProjects returns empty array on error", async () => {
    mockCallMemoryGateway.mockImplementation(() => Promise.reject(new Error("fail")));
    const result = await getActiveProjects();
    expect(result).toEqual([]);
  });

  test("deleteProject sends DELETE query", async () => {
    await deleteProject("p1");
    expect(mockCallMemoryGateway).toHaveBeenCalledWith("/v1/db/query", "POST", {
      sql: "DELETE FROM jarvis_projects WHERE id = ?",
      params: ["p1"],
    });
  });
});

// ─── 7. Pending memory: addPendingMemory, routeMemoryByConfidence ───

describe("pending memory routing", () => {
  test("addPendingMemory inserts with generated id", async () => {
    await addPendingMemory("fact", "fav_color", "blue", "preferences", 0.5, "conv123");
    expect(mockCallMemoryGateway).toHaveBeenCalledWith(
      "/v1/db/query",
      "POST",
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO jarvis_pending_memory"),
        params: expect.arrayContaining(["fact", "fav_color", "blue", "preferences", 0.5, "conv123"]),
      })
    );
  });

  test("routeMemoryByConfidence stores high-confidence facts directly", async () => {
    const result = await routeMemoryByConfidence("key1", "val1", "general", 0.9);
    expect(result).toBe("stored");
  });

  test("routeMemoryByConfidence sends medium-confidence to pending", async () => {
    const result = await routeMemoryByConfidence("key2", "val2", "general", 0.5, "conv1");
    expect(result).toBe("pending");
  });

  test("routeMemoryByConfidence skips very low confidence", async () => {
    const result = await routeMemoryByConfidence("key3", "val3", "general", 0.2);
    expect(result).toBe("skipped");
  });

  test("routeMemoryByConfidence: preferences bypass pending threshold", async () => {
    // confidence=0.5 for preferences should store directly (not pending)
    const result = await routeMemoryByConfidence("pref_key", "pref_val", "preferences", 0.5);
    expect(result).toBe("stored");
  });

  test("routeMemoryByConfidence: rules bypass pending threshold", async () => {
    const result = await routeMemoryByConfidence("rule_key", "rule_val", "rules", 0.6);
    expect(result).toBe("stored");
  });
});

// ─── 8. Pending approval/rejection ───

describe("pending approval and rejection", () => {
  test("approvePendingMemory promotes fact to profile and deletes pending", async () => {
    let callCount = 0;
    mockCallMemoryGateway.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // SELECT pending item
        return Promise.resolve({
          data: { results: [{ type: "fact", key: "color", value: "blue", category: "preferences", confidence: 0.6 }] },
        });
      }
      // subsequent calls: conflict check, upsert, delete
      return Promise.resolve({ data: { results: [], meta: { changes: 1 } } });
    });
    const result = await approvePendingMemory("pm_abc");
    expect(result).toBe(true);
  });

  test("approvePendingMemory returns false if pending item not found", async () => {
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.resolve({ data: { results: [] } })
    );
    const result = await approvePendingMemory("pm_nonexistent");
    expect(result).toBe(false);
  });

  test("approvePendingMemory promotes project type correctly", async () => {
    let callCount = 0;
    mockCallMemoryGateway.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          data: { results: [{ type: "project", key: "proj_new", value: "New Project", category: "work", confidence: 0.7 }] },
        });
      }
      return Promise.resolve({ data: { results: [], meta: { changes: 1 } } });
    });
    const result = await approvePendingMemory("pm_proj");
    expect(result).toBe(true);
  });

  test("rejectPendingMemory deletes and returns true when item existed", async () => {
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.resolve({ data: { meta: { changes: 1 } } })
    );
    const result = await rejectPendingMemory("pm_reject");
    expect(result).toBe(true);
  });

  test("rejectPendingMemory returns false when no item deleted", async () => {
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.resolve({ data: { meta: { changes: 0 } } })
    );
    const result = await rejectPendingMemory("pm_nonexistent");
    expect(result).toBe(false);
  });
});

// ─── 9. Conversation summaries ───

describe("conversation summaries", () => {
  test("saveConversationSummary sends INSERT OR REPLACE with JSON fields", async () => {
    await saveConversationSummary(
      "conv1",
      "Discussed project goals",
      ["goals", "timeline"],
      ["use Bun"],
      ["deadline is April"]
    );
    expect(mockCallMemoryGateway).toHaveBeenCalledWith(
      "/v1/db/query",
      "POST",
      expect.objectContaining({
        sql: expect.stringContaining("INSERT OR REPLACE INTO jarvis_conversation_summaries"),
        params: [
          "conv1",
          "Discussed project goals",
          JSON.stringify(["goals", "timeline"]),
          JSON.stringify(["use Bun"]),
          JSON.stringify(["deadline is April"]),
        ],
      })
    );
  });

  test("getRecentSummaries returns summaries ordered by date", async () => {
    const summaries = [
      { summary: "s1", topics_json: '["a"]', created_at: "2026-04-05" },
    ];
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.resolve({ data: { results: summaries } })
    );
    const result = await getRecentSummaries(3);
    expect(result).toEqual(summaries);
  });

  test("getRecentSummaries returns empty on error", async () => {
    mockCallMemoryGateway.mockImplementation(() => Promise.reject(new Error("fail")));
    const result = await getRecentSummaries();
    expect(result).toEqual([]);
  });
});

// ─── 10. Vector search ───

describe("vector search", () => {
  test("storeEmbedding calls embed server /store endpoint", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ stored: 1 })))
    );
    const result = await storeEmbedding("src1", "message", "hello world", { topic: "greet" });
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/store"),
      expect.objectContaining({ method: "POST" })
    );
  });

  test("storeEmbedding returns false when server returns stored=0", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ stored: 0 })))
    );
    const result = await storeEmbedding("src2", "message", "test");
    expect(result).toBe(false);
  });

  test("searchMemories returns results from embed server", async () => {
    const searchResults = [
      { text: "past convo", score: 0.85, source_id: "s1", metadata: {} },
    ];
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ results: searchResults })))
    );
    const result = await searchMemories("hello", 5, "message");
    expect(result).toEqual(searchResults);
  });

  test("searchMemories returns empty array when server is down", async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error("ECONNREFUSED")));
    const result = await searchMemories("hello");
    expect(result).toEqual([]);
  });
});

// ─── 11. Error handling ───

describe("error handling", () => {
  test("gateway down: getProfile returns empty object", async () => {
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.reject(new Error("Gateway unreachable"))
    );
    const result = await getProfile();
    expect(result).toEqual({});
  });

  test("gateway down: getActiveProjects returns empty array", async () => {
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.reject(new Error("Gateway unreachable"))
    );
    const result = await getActiveProjects();
    expect(result).toEqual([]);
  });

  test("invalid response: missing data field returns gracefully", async () => {
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.resolve({ unexpected: "format" })
    );
    const profile = await getProfile();
    expect(profile).toEqual({});
  });

  test("timeout: embed server abort returns null results", async () => {
    mockFetch.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("AbortError")), 10))
    );
    const result = await searchMemories("test");
    expect(result).toEqual([]);
  });

  test("ensureMemoryTables continues despite individual table creation failure", async () => {
    let callCount = 0;
    mockCallMemoryGateway.mockImplementation(() => {
      callCount++;
      if (callCount === 2) return Promise.reject(new Error("SQL error"));
      return Promise.resolve({ data: {} });
    });
    // Should not throw
    await ensureMemoryTables();
    // 4 tables = 4 calls
    expect(mockCallMemoryGateway).toHaveBeenCalledTimes(4);
  });
});

// ─── 12. Garbage collection ───

describe("garbage collection", () => {
  test("runVectorGC calls embed server /gc and returns deleted count", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ deleted: 42 })))
    );
    const result = await runVectorGC(90, 5000);
    expect(result).toBe(42);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/gc"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ max_age_days: 90, max_entries: 5000 }),
      })
    );
  });

  test("runVectorGC returns 0 on error", async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error("down")));
    const result = await runVectorGC();
    expect(result).toBe(0);
  });

  test("runSummaryGC deletes old summaries and returns count", async () => {
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.resolve({ data: { meta: { changes: 5 } } })
    );
    const result = await runSummaryGC(180);
    expect(result).toBe(5);
    expect(mockCallMemoryGateway).toHaveBeenCalledWith(
      "/v1/db/query",
      "POST",
      expect.objectContaining({
        sql: expect.stringContaining("DELETE FROM jarvis_conversation_summaries"),
        params: ["-180 days"],
      })
    );
  });

  test("runSummaryGC returns 0 on error", async () => {
    mockCallMemoryGateway.mockImplementation(() => Promise.reject(new Error("fail")));
    const result = await runSummaryGC();
    expect(result).toBe(0);
  });

  test("runPendingGC deletes old pending entries", async () => {
    mockCallMemoryGateway.mockImplementation(() =>
      Promise.resolve({ data: { meta: { changes: 3 } } })
    );
    const result = await runPendingGC(30);
    expect(result).toBe(3);
    expect(mockCallMemoryGateway).toHaveBeenCalledWith(
      "/v1/db/query",
      "POST",
      expect.objectContaining({
        sql: expect.stringContaining("DELETE FROM jarvis_pending_memory"),
        params: ["-30 days"],
      })
    );
  });

  test("runPendingGC returns 0 on error", async () => {
    mockCallMemoryGateway.mockImplementation(() => Promise.reject(new Error("fail")));
    const result = await runPendingGC();
    expect(result).toBe(0);
  });
});

// ─── 13. Context building ───

describe("buildMemoryContext", () => {
  test("builds context string with all sections", async () => {
    // Mock gateway calls for profile, projects, pending, summaries
    mockCallMemoryGateway.mockImplementation((_path: string, _method: string, body: any) => {
      const sql = body?.sql || "";
      if (sql.includes("jarvis_user_profile")) {
        return Promise.resolve({
          data: {
            results: [
              { key: "name", value: "DJ", category: "identity", source: "manual", confidence: 1.0 },
              { key: "response_style", value: "concise", category: "preferences", source: "manual", confidence: 1.0 },
            ],
          },
        });
      }
      if (sql.includes("jarvis_projects")) {
        return Promise.resolve({
          data: { results: [{ id: "p1", name: "M1317", status: "active", goals: "Ship" }] },
        });
      }
      if (sql.includes("jarvis_conversation_summaries")) {
        return Promise.resolve({
          data: {
            results: [
              { summary: "Discussed deployment", topics_json: '["deploy"]', created_at: "2026-04-05" },
            ],
          },
        });
      }
      if (sql.includes("jarvis_pending_memory")) {
        return Promise.resolve({
          data: { results: [{ id: "pm1", type: "fact", key: "k", value: "v" }] },
        });
      }
      return Promise.resolve({ data: { results: [] } });
    });

    // Mock vector search
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [{ text: "past context about deploy", score: 0.9, source_id: "s1", metadata: {} }],
          })
        )
      )
    );

    const ctx = await buildMemoryContext("deployment status");
    expect(ctx).toContain("[DJ PROFILE]");
    expect(ctx).toContain("name: DJ");
    expect(ctx).toContain("[DJ PREFERENCES");
    expect(ctx).toContain("response_style: concise");
    expect(ctx).toContain("[ACTIVE PROJECTS]");
    expect(ctx).toContain("M1317");
    expect(ctx).toContain("[RELEVANT PAST CONTEXT]");
    expect(ctx).toContain("[RECENT CONVERSATIONS]");
    expect(ctx).toContain("[PENDING MEMORIES: 1");
  });

  test("returns empty string when all sources are empty", async () => {
    // Default mock returns empty results
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ results: [] })))
    );
    const ctx = await buildMemoryContext("hello");
    expect(ctx).toBe("");
  });
});

afterAll(() => {
  callMemoryGatewaySpy.mockRestore();
});
