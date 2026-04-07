import { describe, test, expect, mock, beforeEach, beforeAll } from "bun:test";

// --- Mocks ---
// Strategy: mock config FULLY (prevents config.ts top-level await/EPERM from running),
// let real security.ts load (it imports from mocked config), control auth via ALLOWED_USERS.

mock.module("../../config", () => ({
  ALLOWED_USERS: [123456],
  // Needed by security.ts
  ALLOWED_PATHS: ["/tmp", "/home"],
  BLOCKED_PATTERNS: [],
  RATE_LIMIT_ENABLED: false,
  RATE_LIMIT_REQUESTS: 100,
  RATE_LIMIT_WINDOW: 60,
  TEMP_PATHS: ["/tmp/"],
  WORKING_DIR: "/tmp/test",
  SAFETY_PROMPT: "",
  TELEGRAM_MESSAGE_LIMIT: 4096,
  TELEGRAM_SAFE_LIMIT: 4000,
  STREAMING_THROTTLE_MS: 500,
  BUTTON_LABEL_MAX_LENGTH: 30,
  AUDIT_LOG_PATH: "/tmp/test-audit.log",
  AUDIT_LOG_JSON: false,
  QUERY_TIMEOUT_MS: 180000,
  THINKING_KEYWORDS: [],
  THINKING_DEEP_KEYWORDS: [],
  MEDIA_GROUP_TIMEOUT: 1000,
}));

mock.module("../../utils/logger", () => ({
  createLogger: () => ({
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
  }),
}));

const mockLoadJsonFile = mock((_path: string, fallback: any) => fallback);
mock.module("../../utils/json-loader", () => ({ loadJsonFile: mockLoadJsonFile }));

// Mutable exec state — controls what promisify(exec) resolves/rejects with.
// util.promisify(exec) uses exec[util.promisify.custom] when present.
const execState = {
  stdout: "command output",
  stderr: "",
  error: null as Error | null,
};

const mockExecFn: any = mock(
  (_cmd: string, _opts: any, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    if (execState.error) cb(execState.error, "", "");
    else cb(null, execState.stdout, execState.stderr);
  }
);

// Add promisify.custom so promisify(exec) resolves with { stdout, stderr }
// (same as the real child_process.exec which uses this symbol)
mockExecFn[Symbol.for("nodejs.util.promisify.custom")] = async (_cmd: string, _opts: any) => {
  if (execState.error) throw execState.error;
  return { stdout: execState.stdout, stderr: execState.stderr };
};

mock.module("child_process", () => ({
  exec: mockExecFn,
  // Include spawn so node:child_process mock compatibility is maintained across test files
  spawn: mock((..._args: any[]) => null),
}));

// Use dynamic import in beforeAll to guarantee all mocks are applied before module loads
let handleScout: (ctx: any) => Promise<void>;

beforeAll(async () => {
  const mod = await import("../scout-command");
  handleScout = mod.handleScout;
});

function makeCtx(text: string, userId = 123456) {
  return {
    from: { id: userId },
    message: { text },
    reply: mock(() => Promise.resolve({ message_id: 1, chat: { id: 789 } })),
    chat: { id: 789 },
    api: {},
  } as any;
}

const sampleActions = [
  { number: 1, label: "Deploy to staging", command: "echo deploy", safe: true },
  { number: 2, label: "Run backup", command: "echo backup" },
];

beforeEach(() => {
  mockLoadJsonFile.mockReset();
  mockLoadJsonFile.mockImplementation((_path: string, fallback: any) => fallback);
  execState.stdout = "command output";
  execState.stderr = "";
  execState.error = null;
});

describe("handleScout - list actions (/scout)", () => {
  test("replies with 'no actions' message when actions file is empty", async () => {
    const ctx = makeCtx("/scout");

    await handleScout(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply.mock.calls[0] as any[])[0] as string;
    expect(replyText).toContain("推奨アクションなし");
  });

  test("shows numbered action list with labels when actions exist", async () => {
    mockLoadJsonFile.mockImplementation(() => sampleActions);
    const ctx = makeCtx("/scout");

    await handleScout(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply.mock.calls[0] as any[])[0] as string;
    expect(replyText).toContain("Deploy to staging");
    expect(replyText).toContain("Run backup");
    expect(replyText).toContain("/scout N");
  });

  test("marks safe actions with robot emoji and non-safe with person emoji", async () => {
    mockLoadJsonFile.mockImplementation(() => sampleActions);
    const ctx = makeCtx("/scout");

    await handleScout(ctx);

    const replyText = (ctx.reply.mock.calls[0] as any[])[0] as string;
    expect(replyText).toContain("🤖"); // safe: true
    expect(replyText).toContain("👤"); // safe: false (undefined)
  });
});

describe("handleScout - execute action (/scout N)", () => {
  test("executes action and replies with stdout output", async () => {
    mockLoadJsonFile.mockImplementation(() => sampleActions);
    execState.stdout = "Deployment successful!";
    execState.stderr = "";

    const ctx = makeCtx("/scout 1");

    await handleScout(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(2);
    const progressMsg = (ctx.reply.mock.calls[0] as any[])[0] as string;
    expect(progressMsg).toContain("実行中");
    expect(progressMsg).toContain("Deploy to staging");

    const resultMsg = (ctx.reply.mock.calls[1] as any[])[0] as string;
    expect(resultMsg).toContain("✅");
    expect(resultMsg).toContain("Deployment successful!");
  });

  test("replies with error message on command execution failure", async () => {
    mockLoadJsonFile.mockImplementation(() => sampleActions);
    execState.error = new Error("command not found: badcmd");

    const ctx = makeCtx("/scout 1");

    await handleScout(ctx);

    const replies = ctx.reply.mock.calls.map((c: any[]) => c[0] as string) as string[];
    const errorReply = replies.find((r: string) => r.includes("❌"));
    expect(errorReply).toBeDefined();
    expect(errorReply).toContain("command not found");
  });

  test("replies with 'not found' when action number does not exist", async () => {
    mockLoadJsonFile.mockImplementation(() => sampleActions);
    const ctx = makeCtx("/scout 99");

    await handleScout(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect((ctx.reply.mock.calls[0] as any[])[0]).toContain("見つかりません");
  });

  test("replies with format hint when argument is not a valid number", async () => {
    mockLoadJsonFile.mockImplementation(() => sampleActions);
    const ctx = makeCtx("/scout notanumber");

    await handleScout(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect((ctx.reply.mock.calls[0] as any[])[0]).toContain("番号を指定");
  });

  test("includes stderr in reply when command produces stderr output", async () => {
    mockLoadJsonFile.mockImplementation(() => sampleActions);
    execState.stdout = "main output";
    execState.stderr = "warning: deprecated usage";

    const ctx = makeCtx("/scout 1");

    await handleScout(ctx);

    const resultMsg = (ctx.reply.mock.calls[1] as any[])[0] as string;
    expect(resultMsg).toContain("STDERR");
    expect(resultMsg).toContain("deprecated");
  });
});

describe("handleScout - authorization", () => {
  test("silently ignores unauthorized user IDs", async () => {
    // userId 999999 is not in ALLOWED_USERS: [123456]
    const ctx = makeCtx("/scout", 999999);

    await handleScout(ctx);

    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
