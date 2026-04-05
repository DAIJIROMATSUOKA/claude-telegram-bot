import { describe, test, expect, mock, beforeEach } from "bun:test";

// --- Mocks ---

const mockSession = {
  isActive: false,
  sendMessageStreaming: mock(() => Promise.resolve("Document analysis response")),
  startProcessing: mock(() => mock(() => {})),
  conversationTitle: "",
};
mock.module("../../session", () => ({ session: mockSession }));

mock.module("../../config", () => ({
  ALLOWED_USERS: [123456],
  TEMP_DIR: "/tmp/telegram-bot",
}));

mock.module("../../security", () => ({
  isAuthorized: (userId: number | undefined) => userId === 123456,
  rateLimiter: {
    check: mock(() => [true, null] as [boolean, number | null]),
  },
}));

mock.module("../../utils", () => ({
  auditLog: mock(() => Promise.resolve()),
  auditLogRateLimit: mock(() => Promise.resolve()),
  checkInterrupt: mock((t: string) => Promise.resolve(t)),
  startTypingIndicator: mock(() => ({ stop: mock(() => {}) })),
}));

const mockCreateStatusCallback = mock(() => mock(() => Promise.resolve()));
mock.module("../streaming", () => ({
  StreamingState: class {
    textMessages = new Map();
    toolMessages: any[] = [];
    lastEditTimes = new Map();
    lastContent = new Map();
    headerSent = false;
  },
  createStatusCallback: mockCreateStatusCallback,
}));

mock.module("../media-group", () => ({
  createMediaGroupBuffer: mock(() => ({
    addToGroup: mock(() => Promise.resolve()),
  })),
  handleProcessingError: mock(() => Promise.resolve()),
}));

mock.module("../../utils/control-tower-db", () => ({
  controlTowerDB: {
    startActionTrace: mock(() => 1),
    completeActionTrace: mock(() => {}),
    getLatestActionTrace: mock(() => null),
  },
}));

mock.module("../../utils/redaction-filter", () => ({
  redactSensitiveData: mock((text: string) => ({ sanitized: text, hasRedactions: false })),
}));

mock.module("../../utils/attach-pending", () => ({
  setPendingAttach: mock(() => {}),
}));

// --- Import module under test ---
import { handleDocument } from "../document";

function makeMockCtx(opts: {
  userId?: number;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  mediaGroupId?: string;
  caption?: string;
} = {}) {
  const userId = opts.userId ?? 123456;
  const fileName = opts.fileName ?? "test.pdf";
  const mimeType = opts.mimeType ?? "application/pdf";
  return {
    from: { id: userId, username: "testuser" },
    chat: { id: 999 },
    message: {
      document: {
        file_id: "file_123",
        file_name: fileName,
        mime_type: mimeType,
        file_size: opts.fileSize ?? 1024,
      },
      media_group_id: opts.mediaGroupId,
      caption: opts.caption,
    },
    reply: mock(() => Promise.resolve({ chat: { id: 999 }, message_id: 50 })),
    replyWithPhoto: mock(() => Promise.resolve()),
    getFile: mock(() => Promise.resolve({ file_path: "documents/test.pdf" })),
    api: {
      token: "test-token",
      editMessageText: mock(() => Promise.resolve()),
      deleteMessage: mock(() => Promise.resolve()),
    },
  } as any;
}

beforeEach(() => {
  mockSession.sendMessageStreaming.mockClear();
  mockSession.startProcessing.mockClear();
});

describe("handleDocument", () => {
  test("rejects unauthorized users", async () => {
    const ctx = makeMockCtx({ userId: 999999 });
    await handleDocument(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Unauthorized"));
  });

  test("rejects files exceeding size limit", async () => {
    const ctx = makeMockCtx({ fileSize: 15 * 1024 * 1024 }); // 15MB
    await handleDocument(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("too large"));
  });

  test("rejects unsupported file types", async () => {
    const ctx = makeMockCtx({ fileName: "file.exe", mimeType: "application/x-executable" });
    await handleDocument(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Unsupported"));
  });

  test("detects PDF files by extension", async () => {
    const ctx = makeMockCtx({ fileName: "report.pdf", mimeType: "application/pdf" });
    // Will try to download - this may fail in test env but validates detection
    try {
      await handleDocument(ctx);
    } catch (e) {
      // download may fail, that's ok - we're testing detection
    }
    // If it got past the type check, it tried to download
    expect(ctx.getFile).toHaveBeenCalled();
  });

  test("detects text files by extension", async () => {
    const ctx = makeMockCtx({ fileName: "readme.md", mimeType: "text/markdown" });
    try {
      await handleDocument(ctx);
    } catch (e) {}
    expect(ctx.getFile).toHaveBeenCalled();
  });

  test("detects image files and processes them", async () => {
    const ctx = makeMockCtx({ fileName: "photo.jpg", mimeType: "image/jpeg" });
    try {
      await handleDocument(ctx);
    } catch (e) {}
    // Image files go through a different path
    expect(ctx.getFile).toHaveBeenCalled();
  });

  test("detects archive files by extension", async () => {
    const ctx = makeMockCtx({ fileName: "data.zip", mimeType: "application/zip" });
    try {
      await handleDocument(ctx);
    } catch (e) {}
    expect(ctx.getFile).toHaveBeenCalled();
  });

  test("returns early when no document in context", async () => {
    const ctx = {
      from: { id: 123456, username: "testuser" },
      chat: { id: 999 },
      message: { document: undefined },
      reply: mock(() => Promise.resolve()),
    } as any;
    await handleDocument(ctx);
    // Should return early without replying
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  test("handles spreadsheet-like text extensions (csv)", async () => {
    const ctx = makeMockCtx({ fileName: "data.csv", mimeType: "text/csv" });
    try {
      await handleDocument(ctx);
    } catch (e) {}
    expect(ctx.getFile).toHaveBeenCalled();
  });

  test("handles JSON files", async () => {
    const ctx = makeMockCtx({ fileName: "config.json", mimeType: "application/json" });
    try {
      await handleDocument(ctx);
    } catch (e) {}
    expect(ctx.getFile).toHaveBeenCalled();
  });
});
