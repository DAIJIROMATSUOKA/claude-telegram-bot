import { describe, test, expect, mock, spyOn, beforeEach, afterAll } from "bun:test";
import * as streamingModule from "../streaming";

// ── Mock session ──
const mockSession = {
  isActive: false,
  isRunning: false,
  sessionId: "sess-test-123",
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
  resumeSession: mock((_id: string) => [true, "Resumed"] as [boolean, string]),
  sendMessageStreaming: mock(() => Promise.resolve("Claude response")),
  consumeInterruptFlag: mock(() => false),
  startProcessing: mock(() => mock(() => {})),
};

mock.module("../../session", () => ({ session: mockSession }));

mock.module("../../config", () => ({
  ALLOWED_USERS: [123456],
  WORKING_DIR: "/test/dir",
  RESTART_FILE: "/tmp/test-restart",
}));

mock.module("../../security", () => ({
  isAuthorized: (userId: number | undefined, _allowed: number[]) => userId === 123456,
  rateLimiter: {
    check: mock((_userId: number) => [true, null] as [boolean, number | null]),
  },
}));

// ── Mock utils ──
mock.module("../../utils", () => ({
  auditLog: mock(() => Promise.resolve()),
  auditLogRateLimit: mock(() => Promise.resolve()),
  checkInterrupt: mock((text: string) => Promise.resolve(text)),
  startTypingIndicator: mock(() => ({ stop: mock(() => {}) })),
}));

mock.module("../../utils/typing", () => ({
  sendTyping: mock(() => {}),
}));

mock.module("../../utils/error-notify", () => ({
  notifyError: mock(() => Promise.resolve()),
}));

mock.module("../../utils/logger", () => ({
  logger: {
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  },
}));

// ── Mock streaming ──
const createStatusCallbackSpy = spyOn(streamingModule, "createStatusCallback").mockImplementation(
  () => mock(() => Promise.resolve()) as any
);

// ── Mock control tower ──
mock.module("../../utils/control-tower-db", () => ({
  controlTowerDB: {
    startActionTrace: mock(() => "trace-id-1"),
    completeActionTrace: mock(() => {}),
  },
}));

mock.module("../../utils/redaction-filter", () => ({
  redactSensitiveData: mock((text: string) => ({ sanitized: text, redacted: false })),
}));

mock.module("../../utils/phase-detector", () => ({
  checkPhaseCompletionApproval: mock(() => Promise.resolve()),
}));

mock.module("../../utils/chat-history", () => ({
  saveChatMessage: mock(() => Promise.resolve()),
  cleanupOldHistory: mock(() => Promise.resolve()),
}));

mock.module("../../utils/jarvis-context", () => ({
  autoDetectAndUpdateWorkMode: mock(() => Promise.resolve()),
}));

mock.module("../../utils/focus-mode", () => ({
  isFocusModeEnabled: mock(() => Promise.resolve(false)),
  bufferNotification: mock(() => Promise.resolve()),
}));

mock.module("../../utils/web-search", () => ({
  maybeEnrichWithWebSearch: mock((msg: string) => Promise.resolve(msg)),
}));

mock.module("../../utils/x-summary", () => ({
  maybeEnrichWithXSummary: mock((msg: string) => Promise.resolve(msg)),
}));

mock.module("../../utils/metrics", () => ({
  recordMessageMetrics: mock(() => {}),
}));

mock.module("../../utils/tower-renderer", () => ({
  setClaudeStatus: mock(() => {}),
}));

mock.module("../../utils/tower-manager", () => ({
  updateTower: mock(() => Promise.resolve()),
}));

mock.module("../../utils/pending-task", () => ({
  savePendingTask: mock(() => {}),
  clearPendingTask: mock(() => {}),
}));

mock.module("../../utils/croppy-context", () => ({
  formatCroppyDebugOutput: mock(() => Promise.resolve("<b>debug output</b>")),
}));

// ── Mock session bridge (CLI, non-Chrome) ──
const mockHasActiveSession = mock((_userId: number) => false);
const mockSendToSession = mock((_userId: number, _msg: string) => Promise.resolve("AI response"));
const mockSplitTelegramMessage = mock((text: string) => [text]);

mock.module("../../utils/session-bridge", () => ({
  hasActiveSession: mockHasActiveSession,
  sendToSession: mockSendToSession,
  splitTelegramMessage: mockSplitTelegramMessage,
}));

// ── Mock handlers ──
const mockHandleInboxReply = mock((_ctx: any) => Promise.resolve(false));
mock.module("../inbox", () => ({
  handleInboxReply: mockHandleInboxReply,
  handleInboxCallback: mock(() => Promise.resolve(false)),
}));

const mockEnrichMessage = mock((_msg: string, _userId: number) =>
  Promise.resolve({ message: _msg, enrichmentMs: 10 })
);
mock.module("../pipeline/enrichment", () => ({
  enrichMessage: mockEnrichMessage,
}));

const mockRunPostProcess = mock((_opts: any) => Promise.resolve());
mock.module("../pipeline/post-process", () => ({
  runPostProcess: mockRunPostProcess,
  getSessionMsgCount: mock(() => 0),
}));

const mockRouteToProjectNotes = mock((_msg: string, _source: string) => Promise.resolve());
const mockAppendMemo = mock((_text: string) => {});
const mockAppendTask = mock((_text: string) => {});
mock.module("../../services/obsidian-writer", () => ({
  routeToProjectNotes: mockRouteToProjectNotes,
  appendMemo: mockAppendMemo,
  appendTask: mockAppendTask,
  archiveToObsidian: mock(() => Promise.resolve()),
  detectProjectNumbers: mock(() => []),
}));

const mockHandleAgentTask = mock((_prompt: string, _chatId: number, _api: any) => Promise.resolve());
mock.module("../agent-task", () => ({
  handleAgentTask: mockHandleAgentTask,
}));

const mockHandleDeadlineInput = mock((_ctx: any) => Promise.resolve(false));
mock.module("../deadline-input", () => ({
  handleDeadlineInput: mockHandleDeadlineInput,
}));

const mockHandleLinePost = mock((_ctx: any) => Promise.resolve());
mock.module("../line-post", () => ({
  handleLinePost: mockHandleLinePost,
}));

const mockHandleMailSend = mock((_ctx: any) => Promise.resolve());
mock.module("../mail-send", () => ({
  handleMailSend: mockHandleMailSend,
}));

const mockHandleImsgSend = mock((_ctx: any) => Promise.resolve());
mock.module("../imsg-send", () => ({
  handleImsgSend: mockHandleImsgSend,
}));

mock.module("../line-schedule", () => ({
  handleLineSchedule: mock(() => Promise.resolve()),
}));

// ── Import module under test AFTER all mocks ──
import { handleText } from "../text";

// ── Helpers ──
function makeMockCtx(opts: {
  text?: string;
  userId?: number;
  chatId?: number;
  username?: string;
  replyToMessage?: any;
}) {
  const userId = opts.userId ?? 123456;
  const chatId = opts.chatId ?? 100;
  const replyFn = mock(() => Promise.resolve({ message_id: 999, chat: { id: chatId } }));
  return {
    from: { id: userId, username: opts.username || "testuser" },
    chat: { id: chatId },
    message: {
      text: opts.text,
      message_id: 42,
      reply_to_message: opts.replyToMessage ?? undefined,
    },
    reply: replyFn,
    api: {
      editMessageText: mock(() => Promise.resolve()),
      deleteMessage: mock(() => Promise.resolve()),
      sendMessage: mock(() => Promise.resolve({ message_id: 998, chat: { id: chatId } })),
    },
  } as any;
}

function repliedWith(ctx: any, substr: string): boolean {
  return ctx.reply.mock.calls.some(
    (c: any[]) => typeof c[0] === "string" && c[0].includes(substr)
  );
}

function resetAllMocks() {
  mockSession.startProcessing.mockClear();
  mockSession.sendMessageStreaming.mockClear();
  mockHandleInboxReply.mockClear();
  mockHandleInboxReply.mockImplementation(() => Promise.resolve(false));
  mockHasActiveSession.mockClear();
  mockHasActiveSession.mockImplementation(() => false);
  mockSendToSession.mockClear();
  mockSendToSession.mockImplementation(() => Promise.resolve("AI response"));
  mockHandleAgentTask.mockClear();
  mockHandleDeadlineInput.mockClear();
  mockHandleDeadlineInput.mockImplementation(() => Promise.resolve(false));
  mockRouteToProjectNotes.mockClear();
  mockRouteToProjectNotes.mockImplementation(() => Promise.resolve());
  mockEnrichMessage.mockClear();
  mockEnrichMessage.mockImplementation((_msg: string) => Promise.resolve({ message: _msg, enrichmentMs: 10 }));
  mockRunPostProcess.mockClear();
  mockHandleLinePost.mockClear();
  mockHandleMailSend.mockClear();
  mockHandleImsgSend.mockClear();
  mockSplitTelegramMessage.mockClear();
  mockSplitTelegramMessage.mockImplementation((text: string) => [text]);
}

afterAll(() => {
  createStatusCallbackSpy.mockRestore();
});

// ── Tests ──

describe("handleText", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ── 1. Plain-text routing (Phase4-B: AI relay discontinued) ──
  describe("plain text routing", () => {
    test("plain text with no active session replies with B hint (no AI relay)", async () => {
      const ctx = makeMockCtx({ text: "hello world" });
      await handleText(ctx);
      // B behavior: short hint pointing to Claude Code, no claude.ai relay
      expect(repliedWith(ctx, "Claude Code")).toBe(true);
      expect(mockSendToSession).not.toHaveBeenCalled();
    });

    test("routes to AI session (CLI) when active session exists", async () => {
      mockHasActiveSession.mockImplementation(() => true);
      const ctx = makeMockCtx({ text: "tell me about the code" });
      await handleText(ctx);
      expect(mockSendToSession).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalled();
    });
  });

  // ── 2. Security: blocked user rejection ──
  describe("security", () => {
    test("unauthorized user receives rejection message", async () => {
      const ctx = makeMockCtx({ text: "hello", userId: 999999 });
      await handleText(ctx);
      expect(ctx.reply).toHaveBeenCalledTimes(1);
      expect(ctx.reply.mock.calls[0][0]).toContain("Unauthorized");
    });

    test("authorized user does not get rejection", async () => {
      const ctx = makeMockCtx({ text: "hello", userId: 123456 });
      await handleText(ctx);
      const replies = ctx.reply.mock.calls.map((c: any) => c[0]);
      const hasUnauthorized = replies.some((r: string) => typeof r === "string" && r.includes("Unauthorized"));
      expect(hasUnauthorized).toBe(false);
    });
  });

  // ── 3. Rate limiting behavior ──
  describe("rate limiting", () => {
    test("rate-limited user receives wait message", async () => {
      const { rateLimiter } = await import("../../security");
      (rateLimiter.check as any).mockImplementation(() => [false, 5.0]);

      const ctx = makeMockCtx({ text: "hello" });
      await handleText(ctx);
      const replies = ctx.reply.mock.calls.map((c: any) => c[0]);
      const hasRateLimit = replies.some((r: string) => typeof r === "string" && r.includes("Rate limited"));
      expect(hasRateLimit).toBe(true);

      // Restore
      (rateLimiter.check as any).mockImplementation(() => [true, null]);
    });
  });

  // ── 4. Chunk splitting for long AI-session responses ──
  describe("chunk splitting", () => {
    test("AI session splits long responses using splitTelegramMessage", async () => {
      mockHasActiveSession.mockImplementation(() => true);
      mockSendToSession.mockImplementation(() => Promise.resolve("A".repeat(5000)));
      mockSplitTelegramMessage.mockImplementation((text: string) => [
        text.substring(0, 4096),
        text.substring(4096),
      ]);

      const ctx = makeMockCtx({ text: "generate a long response" });
      await handleText(ctx);

      expect(mockSplitTelegramMessage).toHaveBeenCalled();
      expect(ctx.reply.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 5. Edge cases ──
  describe("edge cases", () => {
    test("missing message text returns early", async () => {
      const ctx = {
        from: { id: 123456, username: "testuser" },
        chat: { id: 100 },
        message: { text: undefined, message_id: 42 },
        reply: mock(() => Promise.resolve()),
        api: {
          editMessageText: mock(() => Promise.resolve()),
          deleteMessage: mock(() => Promise.resolve()),
          sendMessage: mock(() => Promise.resolve({ message_id: 1, chat: { id: 100 } })),
        },
      } as any;
      await handleText(ctx);
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    test("missing userId returns early", async () => {
      const ctx = {
        from: undefined,
        chat: { id: 100 },
        message: { text: "hello", message_id: 42 },
        reply: mock(() => Promise.resolve()),
        api: {
          editMessageText: mock(() => Promise.resolve()),
          deleteMessage: mock(() => Promise.resolve()),
          sendMessage: mock(() => Promise.resolve({ message_id: 1, chat: { id: 100 } })),
        },
      } as any;
      await handleText(ctx);
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    test("missing chatId returns early", async () => {
      const ctx = {
        from: { id: 123456, username: "testuser" },
        chat: undefined,
        message: { text: "hello", message_id: 42 },
        reply: mock(() => Promise.resolve()),
        api: {
          editMessageText: mock(() => Promise.resolve()),
          deleteMessage: mock(() => Promise.resolve()),
          sendMessage: mock(() => Promise.resolve({ message_id: 1, chat: { id: 100 } })),
        },
      } as any;
      await handleText(ctx);
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    test("empty string after checkInterrupt returns early (no AI)", async () => {
      const { checkInterrupt } = await import("../../utils");
      (checkInterrupt as any).mockImplementation(() => Promise.resolve("   "));

      const ctx = makeMockCtx({ text: "will become empty" });
      await handleText(ctx);
      expect(mockSendToSession).not.toHaveBeenCalled();
      expect(repliedWith(ctx, "Claude Code")).toBe(false);

      // Restore
      (checkInterrupt as any).mockImplementation((t: string) => Promise.resolve(t));
    });
  });

  // ── 6. Memo mode ──
  describe("memo mode (。prefix)", () => {
    test("memo mode deletes user message and sends confirmation", async () => {
      const ctx = makeMockCtx({ text: "。buy groceries" });
      await handleText(ctx);
      expect(ctx.api.deleteMessage).toHaveBeenCalledWith(100, 42);
      expect(ctx.api.sendMessage).toHaveBeenCalledWith(100, expect.stringContaining("✓"));
    });

    test("memo with empty content still sends confirmation", async () => {
      const ctx = makeMockCtx({ text: "。" });
      await handleText(ctx);
      expect(ctx.api.deleteMessage).toHaveBeenCalled();
      expect(ctx.api.sendMessage).toHaveBeenCalled();
    });

    test("memo mode does not route to AI session", async () => {
      const ctx = makeMockCtx({ text: "。remember this" });
      await handleText(ctx);
      expect(mockSendToSession).not.toHaveBeenCalled();
      expect(repliedWith(ctx, "Claude Code")).toBe(false);
    });
  });

  // ── 7. Task mode ──
  describe("task mode (、prefix)", () => {
    test("task mode deletes user message and sends checkbox confirmation", async () => {
      const ctx = makeMockCtx({ text: "、fix the bug in text.ts" });
      await handleText(ctx);
      expect(ctx.api.deleteMessage).toHaveBeenCalledWith(100, 42);
      expect(ctx.api.sendMessage).toHaveBeenCalledWith(100, expect.stringContaining("✓"));
    });

    test("task mode does not route to AI", async () => {
      const ctx = makeMockCtx({ text: "、do something" });
      await handleText(ctx);
      expect(mockSendToSession).not.toHaveBeenCalled();
      expect(repliedWith(ctx, "Claude Code")).toBe(false);
    });
  });

  // ── 8. Reply routing to inbox ──
  describe("inbox reply routing", () => {
    test("reply to message triggers handleInboxReply check", async () => {
      const ctx = makeMockCtx({
        text: "got it",
        replyToMessage: {
          from: { id: 444, is_bot: false, first_name: "Someone" },
          text: "Original notification",
          message_id: 60,
        },
      });
      await handleText(ctx);
      expect(mockHandleInboxReply).toHaveBeenCalled();
    });

    test("returns early when handleInboxReply returns true", async () => {
      mockHandleInboxReply.mockImplementation(() => Promise.resolve(true));
      const ctx = makeMockCtx({
        text: "archive this",
        replyToMessage: {
          from: { id: 444, is_bot: false, first_name: "Someone" },
          text: "Notification content",
          message_id: 61,
        },
      });
      await handleText(ctx);
      expect(mockSendToSession).not.toHaveBeenCalled();
      expect(repliedWith(ctx, "Claude Code")).toBe(false);
    });
  });

  // ── 9. [AGENT] prefix ──
  describe("[AGENT] prefix handling", () => {
    test("[AGENT] prefix triggers handleAgentTask", async () => {
      const ctx = makeMockCtx({ text: "[AGENT] run full analysis" });
      await handleText(ctx);
      expect(mockHandleAgentTask).toHaveBeenCalledWith(
        "run full analysis",
        100,
        expect.anything()
      );
    });

    test("[AGENT] with empty body does not trigger agent task", async () => {
      const ctx = makeMockCtx({ text: "[AGENT]   " });
      await handleText(ctx);
      expect(mockHandleAgentTask).not.toHaveBeenCalled();
    });

    test("[AGENT] returns early without AI relay", async () => {
      const ctx = makeMockCtx({ text: "[AGENT] do something" });
      await handleText(ctx);
      expect(mockSendToSession).not.toHaveBeenCalled();
      expect(repliedWith(ctx, "Claude Code")).toBe(false);
    });
  });

  // ── 10. M-number project routing ──
  describe("M-number project routing", () => {
    test("routeToProjectNotes is called for regular messages", async () => {
      const ctx = makeMockCtx({ text: "M1300 design review" });
      await handleText(ctx);
      expect(mockRouteToProjectNotes).toHaveBeenCalledWith("M1300 design review", "telegram");
    });

    test("routeToProjectNotes failure does not break message flow", async () => {
      mockRouteToProjectNotes.mockImplementation(() => { throw new Error("Obsidian down"); });
      const ctx = makeMockCtx({ text: "M1317 progress update" });
      // Should not throw, and still reach B hint
      await handleText(ctx);
      expect(repliedWith(ctx, "Claude Code")).toBe(true);
    });
  });

  // ── 11. Special commands (/line, /mail, /imsg) ──
  describe("special commands", () => {
    test("/line routes to handleLinePost", async () => {
      const ctx = makeMockCtx({ text: "/line hello group" });
      await handleText(ctx);
      expect(mockHandleLinePost).toHaveBeenCalled();
    });

    test("/mail routes to handleMailSend", async () => {
      const ctx = makeMockCtx({ text: "/mail send report" });
      await handleText(ctx);
      expect(mockHandleMailSend).toHaveBeenCalled();
    });

    test("/imsg routes to handleImsgSend", async () => {
      const ctx = makeMockCtx({ text: "/imsg hey there" });
      await handleText(ctx);
      expect(mockHandleImsgSend).toHaveBeenCalled();
    });

    test("special commands call stopProcessing", async () => {
      const stopFn = mock(() => {});
      mockSession.startProcessing.mockImplementation(() => stopFn);
      const ctx = makeMockCtx({ text: "/line test" });
      await handleText(ctx);
      expect(stopFn).toHaveBeenCalled();
    });
  });

  // ── 12. Croppy debug routing ──
  describe("croppy debug", () => {
    test("croppy: debug returns debug output", async () => {
      const ctx = makeMockCtx({ text: "croppy: debug" });
      await handleText(ctx);
      expect(ctx.reply).toHaveBeenCalled();
      const replyArgs = ctx.reply.mock.calls[0];
      expect(replyArgs[1]).toEqual({ parse_mode: "HTML" });
    });
  });

  // ── 13. handleDeadlineInput ──
  describe("deadline input", () => {
    test("returns early when handleDeadlineInput returns true", async () => {
      mockHandleDeadlineInput.mockImplementation(() => Promise.resolve(true));
      const ctx = makeMockCtx({ text: "M1300の納期2026/03/31" });
      await handleText(ctx);
      expect(mockSendToSession).not.toHaveBeenCalled();
      expect(repliedWith(ctx, "Claude Code")).toBe(false);
    });

    test("continues when handleDeadlineInput returns false", async () => {
      mockHandleDeadlineInput.mockImplementation(() => Promise.resolve(false));
      const ctx = makeMockCtx({ text: "M1300 is progressing" });
      await handleText(ctx);
      expect(mockRouteToProjectNotes).toHaveBeenCalled();
    });
  });

  // ── 14. Reply context enrichment ──
  describe("reply context", () => {
    test("prepends reply context to message for non-bot replies", async () => {
      const ctx = makeMockCtx({
        text: "I agree",
        replyToMessage: {
          from: { id: 555, is_bot: false, first_name: "Alice" },
          text: "Original message from Alice",
          message_id: 80,
        },
      });
      await handleText(ctx);
      const callArgs = mockRouteToProjectNotes.mock.calls[0];
      if (callArgs) {
        const enrichedMsg = callArgs[0] as string;
        expect(enrichedMsg).toContain("Alice");
        expect(enrichedMsg).toContain("Original message from Alice");
      }
    });

    test("auto-deletes bot reply-to message", async () => {
      const ctx = makeMockCtx({
        text: "follow up",
        replyToMessage: {
          from: { id: 999, is_bot: true },
          text: "Bot response",
          message_id: 81,
        },
      });
      await handleText(ctx);
      expect(ctx.api.deleteMessage).toHaveBeenCalledWith(100, 81);
    });
  });
});
