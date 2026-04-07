import { describe, test, expect, mock, beforeEach, beforeAll } from "bun:test";

// --- Mocks (paths relative to THIS test file in src/services/__tests__/) ---
// To reach src/services/jarvis-memory → ../jarvis-memory
// To reach src/utils/logger → ../../utils/logger

const mockGetProfile = mock(async () => ({}));
const mockRouteMemoryByConfidence = mock(async () => "stored" as "stored" | "pending");
const mockUpsertProject = mock(async () => {});
const mockSaveConversationSummary = mock(async () => {});
const mockStoreEmbedding = mock(async () => true);

mock.module("../jarvis-memory", () => ({
  getProfile: mockGetProfile,
  routeMemoryByConfidence: mockRouteMemoryByConfidence,
  upsertProject: mockUpsertProject,
  saveConversationSummary: mockSaveConversationSummary,
  storeEmbedding: mockStoreEmbedding,
}));

mock.module("ulidx", () => ({
  ulid: () => "01TESTULID00000000000000001",
}));

mock.module("../../utils/logger", () => ({
  createLogger: () => ({
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
  }),
}));

// Helper: create a mock ChildProcess that emits events via setTimeout
function createMockChildProcess(stdoutData: string, exitCode: number) {
  const stdoutHandlers: Array<(data: Buffer) => void> = [];
  const stderrHandlers: Array<(data: Buffer) => void> = [];
  const closeHandlers: Array<(code: number | null) => void> = [];

  return {
    stdin: {
      write: mock((_data: any) => true),
      end: mock(() => {
        setTimeout(() => {
          if (stdoutData) {
            stdoutHandlers.forEach((h) => h(Buffer.from(stdoutData)));
          }
          closeHandlers.forEach((h) => h(exitCode));
        }, 0);
      }),
    },
    stdout: {
      on: mock((event: string, handler: (data: Buffer) => void) => {
        if (event === "data") stdoutHandlers.push(handler);
      }),
    },
    stderr: {
      on: mock((event: string, handler: (data: Buffer) => void) => {
        if (event === "data") stderrHandlers.push(handler);
      }),
    },
    on: mock((event: string, handler: (code: number | null) => void) => {
      if (event === "close") closeHandlers.push(handler);
    }),
    kill: mock((_signal: string) => true),
  };
}

// Control which mock process spawn returns
let mockChildProcess: ReturnType<typeof createMockChildProcess> | null = null;

// Mock child_process (without node: prefix to avoid Bun built-in mock limitation)
mock.module("child_process", () => ({
  spawn: mock((_cmd: string, _args: any[], _opts: any) => mockChildProcess),
}));

// Also mock node:child_process since the source uses that specifier
mock.module("node:child_process", () => ({
  spawn: mock((_cmd: string, _args: any[], _opts: any) => mockChildProcess),
}));

// --- Dynamic import after mocks are set up ---
let extractAndStoreMemories: (uid: number, userMsg: string, asstMsg: string) => Promise<void>;

beforeAll(async () => {
  const mod = await import("../memory-extractor");
  extractAndStoreMemories = mod.extractAndStoreMemories;
});

const validGeminiResponse = JSON.stringify({
  facts: [
    { key: "company_name", value: "Machinelab", category: "work", confidence: 0.9 },
    { key: "favorite_language", value: "TypeScript", category: "tech", confidence: 0.8 },
  ],
  projects: [
    { id: "m1317", name: "伊藤ハム M1317", goals: "検査システム導入", status: "active" },
  ],
  summary: "DJがMachinelabの検査システム開発について説明した",
  topics: ["機械学習", "画像検査"],
  decisions: ["Keyence XGを採用"],
});

const LONG_USER_MSG = "私はMachinelabで検査システムを開発しています。TypeScriptが好きです。";
const LONG_ASST_MSG = "承知しました。Machinelabの検査システムについて説明します。";

beforeEach(() => {
  mockGetProfile.mockReset();
  mockRouteMemoryByConfidence.mockReset();
  mockUpsertProject.mockReset();
  mockSaveConversationSummary.mockReset();
  mockStoreEmbedding.mockReset();

  mockGetProfile.mockImplementation(async () => ({}));
  mockRouteMemoryByConfidence.mockImplementation(async () => "stored" as const);
  mockStoreEmbedding.mockImplementation(async () => true);

  mockChildProcess = null;
});

describe("extractAndStoreMemories", () => {
  test("returns early when both messages are shorter than MIN_MESSAGE_LENGTH", async () => {
    await extractAndStoreMemories(123, "hi", "ok");
    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  test("returns early when user message starts with /", async () => {
    await extractAndStoreMemories(
      123,
      "/status check",
      "Here is the current status of the system and all running processes."
    );
    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  test("stores facts and projects on successful Gemini extraction", async () => {
    mockChildProcess = createMockChildProcess(validGeminiResponse, 0);

    await extractAndStoreMemories(123, LONG_USER_MSG, LONG_ASST_MSG);

    // 2 facts with confidence >= 0.3
    expect(mockRouteMemoryByConfidence).toHaveBeenCalledTimes(2);
    // 1 project
    expect(mockUpsertProject).toHaveBeenCalledTimes(1);
    const projCall = (mockUpsertProject.mock.calls[0] as any[]);
    expect(projCall[0]).toBe("m1317");
    expect(projCall[1]).toBe("伊藤ハム M1317");
    // Summary saved
    expect(mockSaveConversationSummary).toHaveBeenCalledTimes(1);
    // Embedding stored
    expect(mockStoreEmbedding).toHaveBeenCalledTimes(1);
  });

  test("includes existing profile keys in Gemini prompt to avoid duplicates", async () => {
    mockGetProfile.mockImplementation(async () => ({
      company_name: "Machinelab",
      location: "Tokyo",
    }));

    const child = createMockChildProcess(validGeminiResponse, 0);
    mockChildProcess = child;

    await extractAndStoreMemories(123, LONG_USER_MSG, LONG_ASST_MSG);

    const writtenPrompt = (child.stdin.write.mock.calls[0] as any[])[0] as string;
    expect(writtenPrompt).toContain("company_name");
    expect(writtenPrompt).toContain("location");
    expect(writtenPrompt).toContain("既存プロファイルキー");
  });

  test("handles Gemini exit with non-zero code gracefully (no storage)", async () => {
    mockChildProcess = createMockChildProcess("", 1);

    await extractAndStoreMemories(123, LONG_USER_MSG, LONG_ASST_MSG);

    expect(mockRouteMemoryByConfidence).not.toHaveBeenCalled();
  });

  test("handles malformed JSON output from Gemini gracefully", async () => {
    mockChildProcess = createMockChildProcess("not valid json at all !!!", 0);

    await extractAndStoreMemories(123, LONG_USER_MSG, LONG_ASST_MSG);

    expect(mockRouteMemoryByConfidence).not.toHaveBeenCalled();
  });

  test("strips markdown code fences from Gemini output before parsing", async () => {
    const fencedOutput = "```json\n" + validGeminiResponse + "\n```";
    mockChildProcess = createMockChildProcess(fencedOutput, 0);

    await extractAndStoreMemories(123, LONG_USER_MSG, LONG_ASST_MSG);

    expect(mockRouteMemoryByConfidence).toHaveBeenCalledTimes(2);
  });

  test("skips facts with confidence below 0.3 threshold", async () => {
    const lowConfidenceResponse = JSON.stringify({
      facts: [
        { key: "uncertain_thing", value: "maybe", category: "general", confidence: 0.2 },
        { key: "definite_fact", value: "certain value", category: "work", confidence: 0.9 },
      ],
      projects: [],
      summary: "テスト用の要約文章です",
      topics: ["test"],
      decisions: [],
    });

    mockChildProcess = createMockChildProcess(lowConfidenceResponse, 0);

    await extractAndStoreMemories(123, LONG_USER_MSG, LONG_ASST_MSG);

    // Only 1 fact routed (confidence 0.9), the 0.2 one is skipped
    expect(mockRouteMemoryByConfidence).toHaveBeenCalledTimes(1);
    const routeCall = (mockRouteMemoryByConfidence.mock.calls[0] as any[]);
    expect(routeCall[0]).toBe("definite_fact");
  });

  test("normalizes unknown category to 'general'", async () => {
    const invalidCategoryResponse = JSON.stringify({
      facts: [
        { key: "some_key", value: "some_value", category: "completely_invalid", confidence: 0.9 },
      ],
      projects: [],
      summary: "",
      topics: [],
      decisions: [],
    });

    mockChildProcess = createMockChildProcess(invalidCategoryResponse, 0);

    await extractAndStoreMemories(123, LONG_USER_MSG, LONG_ASST_MSG);

    const routeCall = (mockRouteMemoryByConfidence.mock.calls[0] as any[]);
    // 3rd arg is category
    expect(routeCall[2]).toBe("general");
  });
});
