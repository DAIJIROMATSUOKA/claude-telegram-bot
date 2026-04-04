import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock heavy dependencies
const mockSession = {
  isActive: false,
  isRunning: false,
  sessionId: "sess-abc12345",
  queryStarted: null as Date | null,
  currentTool: null as string | null,
  lastTool: null as string | null,
  lastActivity: null as Date | null,
  lastUsage: null as any,
  lastError: null as string | null,
  lastErrorTime: null as Date | null,
  stop: mock(() => Promise.resolve(true)),
  kill: mock(() => Promise.resolve()),
  clearStopRequested: mock(() => {}),
  resumeSession: mock((id: string) => [true, `Resumed ${id}`] as [boolean, string]),
  sendMessageStreaming: mock(() => Promise.resolve("ok")),
  consumeInterruptFlag: mock(() => false),
};

mock.module("../session", () => ({ session: mockSession }));

mock.module("../config", () => ({
  ALLOWED_USERS: [123456],
  WORKING_DIR: "/test/dir",
  RESTART_FILE: "/tmp/test-restart",
}));

mock.module("../security", () => ({
  isAuthorized: (userId: number | undefined, _allowed: number[]) => userId === 123456,
}));

mock.module("../utils/chat-history", () => ({
  getChatHistory: mock(() => Promise.resolve([])),
}));

mock.module("../utils/session-summary", () => ({
  saveSessionSummary: mock(() => Promise.resolve()),
}));

mock.module("./ai-router", () => ({
  callMemoryGateway: mock(() => Promise.resolve({ data: {} })),
}));

mock.module("../utils/focus-mode", () => ({
  enableFocusMode: mock(() => {}),
  disableFocusMode: mock(() => {}),
  deliverBufferedNotifications: mock(() => Promise.resolve()),
  isFocusModeEnabled: mock(() => false),
}));

mock.module("../utils/metrics", () => ({
  formatMetricsForStatus: mock(() => "metrics data"),
}));

mock.module("../utils/uptime", () => ({
  getUptime: mock(() => "1h 30m"),
}));

mock.module("../utils/circuit-breaker", () => ({
  memoryGatewayBreaker: {
    getStatus: mock(() => ({ state: "CLOSED", successRate: 100 })),
  },
  geminiBreaker: {
    getStatus: mock(() => ({ state: "CLOSED", successRate: 95 })),
  },
}));

mock.module("../utils/bg-task-manager", () => ({
  getBgTaskSummary: mock(() => ({ total: 0, successes: 0, recentFailures: [] })),
}));

mock.module("../utils/tower-manager", () => ({
  updateTower: mock(() => Promise.resolve()),
}));

import { handleStart, handleStatus, handleNew, handleStop } from "./commands";

function makeMockCtx(text: string, userId: number = 123456) {
  return {
    from: { id: userId, username: "testuser" },
    chat: { id: 100 },
    message: { text },
    reply: mock(() => Promise.resolve()),
  } as any;
}

describe("handleStart", () => {
  test("unauthorized user gets rejection", async () => {
    const ctx = makeMockCtx("/start", 999);
    await handleStart(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain("Unauthorized");
  });

  test("authorized user gets welcome message with commands", async () => {
    const ctx = makeMockCtx("/start");
    await handleStart(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("Claude Telegram Bot");
    expect(msg).toContain("/new");
    expect(msg).toContain("/stop");
    expect(msg).toContain("/status");
  });

  test("shows active session when session is active", async () => {
    mockSession.isActive = true;
    const ctx = makeMockCtx("/start");
    await handleStart(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("Active session");
    mockSession.isActive = false;
  });
});

describe("handleStatus", () => {
  beforeEach(() => {
    mockSession.isActive = false;
    mockSession.isRunning = false;
    mockSession.lastError = null;
    mockSession.lastUsage = null;
    mockSession.lastActivity = null;
    mockSession.queryStarted = null;
    mockSession.currentTool = null;
    mockSession.lastTool = null;
  });

  test("unauthorized user gets rejection", async () => {
    const ctx = makeMockCtx("/status", 999);
    await handleStatus(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain("Unauthorized");
  });

  test("shows idle status when no session", async () => {
    const ctx = makeMockCtx("/status");
    await handleStatus(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("Bot Status");
    expect(msg).toContain("Session: None");
    expect(msg).toContain("Query: Idle");
  });

  test("shows active session info", async () => {
    mockSession.isActive = true;
    mockSession.sessionId = "abcdef1234567890";
    const ctx = makeMockCtx("/status");
    await handleStatus(ctx);
    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("Session: Active");
    expect(msg).toContain("abcdef12");
  });

  test("shows running query with elapsed time", async () => {
    mockSession.isRunning = true;
    mockSession.queryStarted = new Date(Date.now() - 5000);
    mockSession.currentTool = "Read(file.ts)";
    const ctx = makeMockCtx("/status");
    await handleStatus(ctx);
    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("Query: Running");
    expect(msg).toContain("Read(file.ts)");
    mockSession.isRunning = false;
  });

  test("shows circuit breaker status", async () => {
    const ctx = makeMockCtx("/status");
    await handleStatus(ctx);
    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("Circuit Breakers");
    expect(msg).toContain("MemoryGW");
    expect(msg).toContain("Gemini");
  });

  test("shows uptime", async () => {
    const ctx = makeMockCtx("/status");
    await handleStatus(ctx);
    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("Uptime: 1h 30m");
  });
});

describe("handleNew", () => {
  test("unauthorized user gets rejection", async () => {
    const ctx = makeMockCtx("/new", 999);
    await handleNew(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("Unauthorized");
  });

  test("clears session and replies", async () => {
    mockSession.isRunning = false;
    mockSession.isActive = false;
    const ctx = makeMockCtx("/new");
    await handleNew(ctx);
    expect(mockSession.kill).toHaveBeenCalled();
    expect(ctx.reply.mock.calls[0][0]).toContain("Session cleared");
  });

  test("stops running query before clearing", async () => {
    mockSession.isRunning = true;
    mockSession.stop.mockClear();
    const ctx = makeMockCtx("/new");
    await handleNew(ctx);
    expect(mockSession.stop).toHaveBeenCalled();
    mockSession.isRunning = false;
  });
});

describe("handleStop", () => {
  test("unauthorized user gets rejection", async () => {
    const ctx = makeMockCtx("/stop", 999);
    await handleStop(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("Unauthorized");
  });
});
