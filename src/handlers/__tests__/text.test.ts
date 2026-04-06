import { describe, test, expect, mock, beforeEach } from "bun:test";

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
const mockStreamingState = {
  replyToMessageId: undefined as number | undefined,
  toolMessages: [] as any[],
};
mock.module("../streaming", () => ({
  StreamingState: class {
    replyToMessageId = undefined;
    toolMessages: any[] = [];
  },
  createStatusCallback: mock(() => mock(() => {})),
}));

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

// ── Mock session bridge ──
const mockHasActiveSession = mock((_userId: number) => false);
const mockSendToSession = mock((_userId: number, _msg: string) => Promise.resolve("AI response"));
const mockSplitTelegramMessage = mock((text: string) => [text]);

mock.module("../../utils/session-bridge", () => ({
  hasActiveSession: mockHasActiveSession,
  sendToSession: mockSendToSession,
  splitTelegramMessage: mockSplitTelegramMessage,
}));

// ── Mock handlers ──
const mockHandleDomainRelay = mock((_ctx: any, _msg: string) => Promise.resolve(false));
mock.module("../domain-router", () => ({
  handleDomainRelay: mockHandleDomainRelay,
}));

const mockHandleInboxReply = mock((_ctx: any) => Promise.resolve(false));
mock.module("../inbox", () => ({
  handleInboxReply: mockHandleInboxReply,
  handleInboxCallback: mock(() => Promise.resolve(false)),
}));

const mockRelayDomain = mock((_domain: string, _msg: string, _onProgress?: any): Promise<string | null> => Promise.resolve("domain response"));
const mockGetLock = mock((_domain: string): null | { type: string; since: number } => null);
const mockGetBufferCount = mock((_domain: string) => 0);
mock.module("../../services/domain-buffer", () => ({
  relayDomain: mockRelayDomain,
  getLock: mockGetLock,
  getBufferCount: mockGetBufferCount,
  MAX_BUFFER: 10,
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

const mockGetChromeOrchestrator = mock(() => null);
mock.module("../orchestrator-chrome", () => ({
  getChromeOrchestrator: mockGetChromeOrchestrator,
  initChromeOrchestrator: mock(() => null),
}));

const mockDispatchToWorker = mock((_ctx: any, _msg: string, _opts?: any) => Promise.resolve());
const mockHandleBridgeReply = mock((_ctx: any) => Promise.resolve(false));
mock.module("../croppy-bridge", () => ({
  dispatchToWorker: mockDispatchToWorker,
  handleBridgeReply: mockHandleBridgeReply,
  registerBridgeReply: mock(() => {}),
}));

const mockHandleChatReply = mock((_ctx: any) => Promise.resolve(false));
mock.module("../claude-chat", () => ({
  handleChatReply: mockHandleChatReply,
  handleChatCommand: mock(() => Promise.resolve()),
  handlePostCommand: mock(() => Promise.resolve()),
  handleChatsCommand: mock(() => Promise.resolve()),
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

function resetAllMocks() {
  mockSession.startProcessing.mockClear();
  mockSession.sendMessageStreaming.mockClear();
  mockHandleDomainRelay.mockClear();
  mockHandleDomainRelay.mockImplementation(() => Promise.resolve(false));
  mockHandleInboxReply.mockClear();
  mockHandleInboxReply.mockImplementation(() => Promise.resolve(false));
  mockHandleChatReply.mockClear();
  mockHandleChatReply.mockImplementation(() => Promise.resolve(false));
  mockHandleBridgeReply.mockClear();
  mockHandleBridgeReply.mockImplementation(() => Promise.resolve(false));
  mockHasActiveSession.mockClear();
  mockHasActiveSession.mockImplementation(() => false);
  mockSendToSession.mockClear();
  mockSendToSession.mockImplementation(() => Promise.resolve("AI response"));
  mockGetChromeOrchestrator.mockClear();
  mockGetChromeOrchestrator.mockImplementation(() => null);
  mockDispatchToWorker.mockClear();
  mockHandleAgentTask.mockClear();
  mockHandleDeadlineInput.mockClear();
  mockHandleDeadlineInput.mockImplementation(() => Promise.resolve(false));
  mockRelayDomain.mockClear();
  mockRelayDomain.mockImplementation(() => Promise.resolve("domain response"));
  mockGetLock.mockClear();
  mockGetBufferCount.mockClear();
  mockRouteToProjectNotes.mockClear();
  mockEnrichMessage.mockClear();
  mockEnrichMessage.mockImplementation((_msg: string) => Promise.resolve({ message: _msg, enrichmentMs: 10 }));
  mockRunPostProcess.mockClear();
  mockHandleLinePost.mockClear();
  mockHandleMailSend.mockClear();
  mockHandleImsgSend.mockClear();
  mockSplitTelegramMessage.mockClear();
  mockSplitTelegramMessage.mockImplementation((text: string) => [text]);
}

// ── Tests ──

describe("handleText", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ── 1. Message routing: plain text to bridge/worker ──
  describe("plain text routing", () => {
    test("routes plain text to dispatchToWorker (bridge mode)", async () => {
      const ctx = makeMockCtx({ text: "hello world" });
      await handleText(ctx);
      expect(mockDispatchToWorker).toHaveBeenCalled();
      expect((mockDispatchToWorker.mock.calls[0] as any[])[1]).toBe("hello world");
    });

    test("routes to AI session when active session exists", async () => {
      mockHasActiveSession.mockImplementation(() => true);
      const ctx = makeMockCtx({ text: "tell me about the code" });
      await handleText(ctx);
      expect(mockSendToSession).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalled();
    });
  });

  // ── 2. Domain tag detection ──
  describe("domain tag detection in reply", () => {
    test("reply to bot message with domain tag routes to domain", async () => {
      const ctx = makeMockCtx({
        text: "follow up question",
        replyToMessage: {
          from: { id: 999, is_bot: true },
          text: "\u{1F4CB} [pc]\nSome previous response",
          message_id: 50,
        },
      });
      await handleText(ctx);
      expect(mockRelayDomain).toHaveBeenCalledWith("pc", expect.any(String), expect.any(Function));
    });

    test("reply to bot message with pin tag routes to domain", async () => {
      const ctx = makeMockCtx({
        text: "another question",
        replyToMessage: {
          from: { id: 999, is_bot: true },
          text: "\u{1F4CC} design\nSome response",
          message_id: 51,
        },
      });
      await handleText(ctx);
      expect(mockRelayDomain).toHaveBeenCalledWith("design", expect.any(String), expect.any(Function));
    });
  });

  // ── 3. Security: blocked user rejection ──
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
      // Should NOT have "Unauthorized" reply
      const replies = ctx.reply.mock.calls.map((c: any) => c[0]);
      const hasUnauthorized = replies.some((r: string) => typeof r === "string" && r.includes("Unauthorized"));
      expect(hasUnauthorized).toBe(false);
    });
  });

  // ── 4. Rate limiting behavior ──
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

  // ── 5. Chunk splitting for long messages ──
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
      // Should reply multiple chunks
      expect(ctx.reply.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 6. Edge cases ──
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

    test("empty string after checkInterrupt returns early", async () => {
      const { checkInterrupt } = await import("../../utils");
      (checkInterrupt as any).mockImplementation(() => Promise.resolve("   "));

      const ctx = makeMockCtx({ text: "will become empty" });
      await handleText(ctx);
      // Should not dispatch to worker since text is empty after interrupt check
      expect(mockDispatchToWorker).not.toHaveBeenCalled();

      // Restore
      (checkInterrupt as any).mockImplementation((t: string) => Promise.resolve(t));
    });
  });

  // ── 7. Memo mode ──
  describe("memo mode (。prefix)", () => {
    test("memo mode deletes user message and sends confirmation", async () => {
      const ctx = makeMockCtx({ text: "。buy groceries" });
      await handleText(ctx);
      // Should delete original message
      expect(ctx.api.deleteMessage).toHaveBeenCalledWith(100, 42);
      // Should send confirmation
      expect(ctx.api.sendMessage).toHaveBeenCalledWith(100, expect.stringContaining("✓"));
    });

    test("memo with empty content still sends confirmation", async () => {
      const ctx = makeMockCtx({ text: "。" });
      await handleText(ctx);
      expect(ctx.api.deleteMessage).toHaveBeenCalled();
      expect(ctx.api.sendMessage).toHaveBeenCalled();
    });

    test("memo mode does not route to AI session or bridge", async () => {
      const ctx = makeMockCtx({ text: "。remember this" });
      await handleText(ctx);
      expect(mockDispatchToWorker).not.toHaveBeenCalled();
      expect(mockSendToSession).not.toHaveBeenCalled();
    });
  });

  // ── 8. Task mode ──
  describe("task mode (、prefix)", () => {
    test("task mode deletes user message and sends checkbox confirmation", async () => {
      const ctx = makeMockCtx({ text: "、fix the bug in text.ts" });
      await handleText(ctx);
      expect(ctx.api.deleteMessage).toHaveBeenCalledWith(100, 42);
      expect(ctx.api.sendMessage).toHaveBeenCalledWith(100, expect.stringContaining("✓"));
    });

    test("task mode does not route to AI or bridge", async () => {
      const ctx = makeMockCtx({ text: "、do something" });
      await handleText(ctx);
      expect(mockDispatchToWorker).not.toHaveBeenCalled();
      expect(mockSendToSession).not.toHaveBeenCalled();
    });
  });

  // ── 9. Reply routing to inbox ──
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
      // Should not continue to bridge
      expect(mockDispatchToWorker).not.toHaveBeenCalled();
    });
  });

  // ── 10. Domain reply routing ──
  describe("domain reply routing", () => {
    test("domain reply sends BUFFERED status when domain is busy", async () => {
      mockRelayDomain.mockImplementation(() => Promise.resolve("BUFFERED"));
      mockGetLock.mockImplementation(() => ({ type: "handoff" as const, since: Date.now() }));
      mockGetBufferCount.mockImplementation(() => 3);

      const ctx = makeMockCtx({
        text: "next question",
        replyToMessage: {
          from: { id: 999, is_bot: true },
          text: "\u{1F4CB} [pc]\nPrevious answer",
          message_id: 70,
        },
      });
      await handleText(ctx);
      expect(ctx.api.editMessageText).toHaveBeenCalled();
      // The edit should contain buffer info
      const editCalls = ctx.api.editMessageText.mock.calls;
      const hasBufferMsg = editCalls.some((c: any[]) =>
        typeof c[2] === "string" && c[2].includes("3/10")
      );
      expect(hasBufferMsg).toBe(true);
    });

    test("domain reply with no response shows empty message", async () => {
      mockRelayDomain.mockImplementation(() => Promise.resolve(null));

      const ctx = makeMockCtx({
        text: "hello",
        replyToMessage: {
          from: { id: 999, is_bot: true },
          text: "\u{1F4CB} [pc]\nPrev",
          message_id: 71,
        },
      });
      await handleText(ctx);
      const editCalls = ctx.api.editMessageText.mock.calls;
      const hasNoResponse = editCalls.some((c: any[]) =>
        typeof c[2] === "string" && c[2].includes("\u5FDC\u7B54\u306A\u3057")
      );
      expect(hasNoResponse).toBe(true);
    });
  });

  // ── 11. [AGENT] prefix ──
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

    test("[AGENT] returns early without dispatching to worker", async () => {
      const ctx = makeMockCtx({ text: "[AGENT] do something" });
      await handleText(ctx);
      expect(mockDispatchToWorker).not.toHaveBeenCalled();
    });
  });

  // ── 12. M-number project routing ──
  describe("M-number project routing", () => {
    test("routeToProjectNotes is called for regular messages", async () => {
      const ctx = makeMockCtx({ text: "M1300 design review" });
      await handleText(ctx);
      expect(mockRouteToProjectNotes).toHaveBeenCalledWith("M1300 design review", "telegram");
    });

    test("routeToProjectNotes failure does not break message flow", async () => {
      mockRouteToProjectNotes.mockImplementation(() => { throw new Error("Obsidian down"); });
      const ctx = makeMockCtx({ text: "M1317 progress update" });
      // Should not throw
      await handleText(ctx);
      expect(mockDispatchToWorker).toHaveBeenCalled();
    });
  });

  // ── 13. Special commands (/line, /mail, /imsg) ──
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

  // ── 14. Croppy debug routing ──
  describe("croppy debug", () => {
    test("croppy: debug returns debug output", async () => {
      const ctx = makeMockCtx({ text: "croppy: debug" });
      await handleText(ctx);
      expect(ctx.reply).toHaveBeenCalled();
      const replyArgs = ctx.reply.mock.calls[0];
      expect(replyArgs[1]).toEqual({ parse_mode: "HTML" });
    });
  });

  // ── 15. handleDeadlineInput ──
  describe("deadline input", () => {
    test("returns early when handleDeadlineInput returns true", async () => {
      mockHandleDeadlineInput.mockImplementation(() => Promise.resolve(true));
      const ctx = makeMockCtx({ text: "M1300\u306E\u7D0D\u671F2026/03/31" });
      await handleText(ctx);
      expect(mockDispatchToWorker).not.toHaveBeenCalled();
    });

    test("continues when handleDeadlineInput returns false", async () => {
      mockHandleDeadlineInput.mockImplementation(() => Promise.resolve(false));
      const ctx = makeMockCtx({ text: "M1300 is progressing" });
      await handleText(ctx);
      // Should continue to further routing
      expect(mockRouteToProjectNotes).toHaveBeenCalled();
    });
  });

  // ── 16. Reply context enrichment ──
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
      // The message should include reply context when sent to bridge
      // Check that routeToProjectNotes got the enriched message
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

  // ── 17. handleChatReply and handleBridgeReply ──
  describe("chat reply and bridge reply routing", () => {
    test("handleChatReply returning true stops processing", async () => {
      mockHandleChatReply.mockImplementation(() => Promise.resolve(true));
      const ctx = makeMockCtx({ text: "chat reply" });
      await handleText(ctx);
      expect(mockDispatchToWorker).not.toHaveBeenCalled();
    });

    test("handleBridgeReply returning true stops processing", async () => {
      mockHandleBridgeReply.mockImplementation(() => Promise.resolve(true));
      const ctx = makeMockCtx({ text: "bridge reply" });
      await handleText(ctx);
      expect(mockDispatchToWorker).not.toHaveBeenCalled();
    });
  });

  // ── 18. Domain routing (handleDomainRelay) ──
  describe("domain routing via handleDomainRelay", () => {
    test("handleDomainRelay returning true stops message from reaching bridge", async () => {
      mockHandleDomainRelay.mockImplementation(() => Promise.resolve(true));
      const ctx = makeMockCtx({ text: "design review the homepage" });
      await handleText(ctx);
      // orchestratorHandled=true, so it should skip bridge
      expect(mockDispatchToWorker).not.toHaveBeenCalled();
    });

    test("domain routing skipped for messages starting with /", async () => {
      // The code checks !message.startsWith("/")
      const ctx = makeMockCtx({ text: "/unknowncommand" });
      await handleText(ctx);
      // handleDomainRelay should NOT be called for / prefixed messages
      // (the /unknowncommand won't match direct domain either)
      expect(mockHandleDomainRelay).not.toHaveBeenCalled();
    });

    test("domain routing skipped for memo prefix", async () => {
      const ctx = makeMockCtx({ text: "\u3002some memo" });
      await handleText(ctx);
      expect(mockHandleDomainRelay).not.toHaveBeenCalled();
    });

    test("domain routing skipped for task prefix", async () => {
      const ctx = makeMockCtx({ text: "\u3001some task" });
      await handleText(ctx);
      expect(mockHandleDomainRelay).not.toHaveBeenCalled();
    });
  });
});
