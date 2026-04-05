/**
 * Tests for src/handlers/claude-chat.ts
 * Covers: routing, error handling, response parsing, chat map persistence.
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";

// --- Mocks (BEFORE importing module under test) ---

let mockExecResults: Record<string, string> = {};
let mockExecDefault = "";

const mockExecAsync = mock(
  (cmd: string, _opts?: any) => {
    for (const [pattern, val] of Object.entries(mockExecResults)) {
      if (cmd.includes(pattern)) {
        if (val.startsWith("THROW:")) {
          return Promise.reject({ stderr: val.replace("THROW:", ""), message: val.replace("THROW:", "") });
        }
        return Promise.resolve({ stdout: val, stderr: "" });
      }
    }
    return Promise.resolve({ stdout: mockExecDefault, stderr: "" });
  }
);

mock.module("../../src/utils/exec-async", () => ({
  execAsync: mockExecAsync,
}));

let writtenFiles: Record<string, string> = {};

const mockWriteFileSync = mock((path: string, data: string) => {
  writtenFiles[path] = data;
});
const mockExistsSync = mock((path: string) => path in writtenFiles);

mock.module("fs", () => ({
  ...require("fs"),
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
}));

mock.module("../../src/config", () => ({
  ALLOWED_USERS: [123456],
  WORKING_DIR: "/test/dir",
}));

// --- Helper ---

function makeMockCtx(text: string, opts: {
  userId?: number;
  replyToMessageId?: number;
  messageId?: number;
} = {}) {
  const { userId = 123456, replyToMessageId, messageId = 5000 } = opts;
  let nextMsgId = 9000;
  const replyMock = mock((_t: string, _o?: any) =>
    Promise.resolve({ message_id: nextMsgId++ })
  );
  return {
    from: { id: userId, username: "testuser" },
    chat: { id: 100 },
    message: {
      text,
      message_id: messageId,
      reply_to_message: replyToMessageId ? { message_id: replyToMessageId } : undefined,
    },
    reply: replyMock,
    api: {
      editMessageText: mock(() => Promise.resolve()),
      deleteMessage: mock(() => Promise.resolve()),
    },
  } as any;
}

// Import AFTER mocks
import {
  handleChatCommand,
  handlePostCommand,
  handleChatsCommand,
  handleChatReply,
  CHAT_TIMING,
} from "../../src/handlers/claude-chat";

// Speed up timing for tests
CHAT_TIMING.initialWaitMs = 10;
CHAT_TIMING.settleMs = 10;
CHAT_TIMING.pollIntervalMs = 10;

// --- handleChatCommand ---

describe("handleChatCommand", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
    writtenFiles = {};
  });

  test("empty message replies with usage", async () => {
    const ctx = makeMockCtx("/chat");
    await handleChatCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Usage: /chat");
  });

  test("shows ⏳ status message immediately", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_1000\nWT:1:2\nCONV_URL:https://claude.ai/chat/abc",
      "check-status": "READY",
      "read-response": "Hi",
      "get-title": "New conversation",
    };
    const ctx = makeMockCtx("/chat hello");
    await handleChatCommand(ctx);
    const firstMsg = ctx.reply.mock.calls[0]![0] as string;
    expect(firstMsg).toContain("送信中");
  });

  test("shows error when new-chat returns ERROR", async () => {
    mockExecResults = { "new-chat": "ERROR: Chrome not running" };
    const ctx = makeMockCtx("/chat fail");
    await handleChatCommand(ctx);
    const editArgs = ctx.api.editMessageText.mock.calls[0]!;
    expect(editArgs[2] as string).toContain("チャット作成失敗");
  });

  test("shows error when new-chat returns no WT line", async () => {
    mockExecResults = { "new-chat": "garbage output" };
    const ctx = makeMockCtx("/chat fail2");
    await handleChatCommand(ctx);
    const editArgs = ctx.api.editMessageText.mock.calls[0]!;
    expect(editArgs[2] as string).toContain("チャット作成失敗");
  });

  test("saves chat map after creation", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_1100\nWT:3:4\nCONV_URL:https://claude.ai/chat/save",
      "check-status": "READY",
      "read-response": "saved",
      "get-title": "New conversation",
    };
    mockWriteFileSync.mockClear();
    const ctx = makeMockCtx("/chat save test");
    await handleChatCommand(ctx);
    const mapWrite = mockWriteFileSync.mock.calls.find(
      (c: any) => (c[0] as string).includes("croppy-chat-map")
    );
    expect(mapWrite).toBeTruthy();
  });

  test("deletes DJ command message on success", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_1200\nWT:5:6\nCONV_URL:https://claude.ai/chat/del",
      "check-status": "READY",
      "read-response": "ok",
      "get-title": "New conversation",
    };
    const ctx = makeMockCtx("/chat del test");
    await handleChatCommand(ctx);
    expect(ctx.api.deleteMessage).toHaveBeenCalled();
  });

  test("NO_RESPONSE leads to timeout message", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_0100\nWT:7:8\nCONV_URL:https://claude.ai/chat/noresp",
      "check-status": "READY",
      "read-response": "NO_RESPONSE",
      "get-title": "New conversation",
    };
    const ctx = makeMockCtx("/chat no response");
    await handleChatCommand(ctx);
    await new Promise(r => setTimeout(r, 200));
    const hasTimeout = ctx.reply.mock.calls.some(
      (c: any) => (c[0] as string).includes("タイムアウト")
    );
    expect(hasTimeout).toBe(true);
  }, 5000);

  test("ERROR in read-response leads to timeout message", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_0200\nWT:9:10\nCONV_URL:https://claude.ai/chat/err",
      "check-status": "READY",
      "read-response": "ERROR: dom fail",
      "get-title": "New conversation",
    };
    const ctx = makeMockCtx("/chat error resp");
    await handleChatCommand(ctx);
    await new Promise(r => setTimeout(r, 200));
    const hasTimeout = ctx.reply.mock.calls.some(
      (c: any) => (c[0] as string).includes("タイムアウト")
    );
    expect(hasTimeout).toBe(true);
  }, 5000);
});

// --- handleChatsCommand ---

describe("handleChatsCommand", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
  });

  test("lists tabs with correct formatting", async () => {
    mockExecResults = { "list-all": "1:2|My Chat\n3:4|[J-WORKER-1] Task" };
    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Open claude.ai tabs");
    expect(msg).toContain("My Chat");
  });

  test("worker tabs show robot emoji", async () => {
    mockExecResults = { "list-all": "1:2|[J-WORKER-1] Worker" };
    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("\u{1F916}");
  });

  test("regular tabs show speech bubble emoji", async () => {
    mockExecResults = { "list-all": "1:2|Regular" };
    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("\u{1F4AC}");
  });

  test("ERROR result shows Chrome未起動", async () => {
    mockExecResults = { "list-all": "ERROR: not available" };
    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Chrome未起動");
  });

  test("empty result shows Chrome未起動", async () => {
    mockExecDefault = "";
    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Chrome未起動");
  });

  test("HTML is escaped in tab listing", async () => {
    mockExecResults = { "list-all": "1:2|<script>xss</script>" };
    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("&lt;script&gt;");
    expect(msg).not.toContain("<script>xss");
  });
});

// --- handlePostCommand ---

describe("handlePostCommand", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
    writtenFiles = {};
  });

  test("no args shows usage", async () => {
    const ctx = makeMockCtx("/post");
    await handlePostCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Usage: /post");
  });

  test("only chat name (no message) shows usage", async () => {
    const ctx = makeMockCtx("/post mychat");
    await handlePostCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Usage: /post");
  });

  test("NOT_FOUND shows error with chat name", async () => {
    mockExecResults = { "inject-by-title": "NOT_FOUND" };
    const ctx = makeMockCtx("/post nonexistent some message");
    await handlePostCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("チャットが見つかりません");
    expect(msg).toContain("nonexistent");
  });

  test("generic error shows エラー", async () => {
    mockExecResults = { "inject-by-title": "ERROR: fail" };
    const ctx = makeMockCtx("/post broken hello there");
    await handlePostCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("エラー");
  });

  test("INSERTED:SENT without WT confirms success", async () => {
    mockExecResults = { "inject-by-title": "INSERTED:SENT" };
    const ctx = makeMockCtx("/post mychat hello there");
    await handlePostCommand(ctx);
    const hasConfirm = ctx.reply.mock.calls.some(
      (c: any) => (c[0] as string).includes("mychat")
    );
    expect(hasConfirm).toBe(true);
  });

  test("INSERTED:SENT with WT starts response relay", async () => {
    mockExecResults = {
      "inject-by-title": "WT:11:12\nINSERTED:SENT",
      "check-status": "READY",
      "read-response": "Post response",
    };
    const ctx = makeMockCtx("/post design follow up");
    await handlePostCommand(ctx);
    const injectCall = mockExecAsync.mock.calls.find(
      (c: any) => (c[0] as string).includes("inject-by-title")
    );
    expect(injectCall).toBeTruthy();
  });
});

// --- handleChatReply ---

describe("handleChatReply", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
    writtenFiles = {};
  });

  test("returns false with no reply_to_message", async () => {
    const ctx = makeMockCtx("hello");
    ctx.message.reply_to_message = undefined;
    expect(await handleChatReply(ctx)).toBe(false);
  });

  test("returns false when reply target not in map", async () => {
    const ctx = makeMockCtx("hello", { replyToMessageId: 99999 });
    expect(await handleChatReply(ctx)).toBe(false);
  });

  test("returns false for command messages starting with /", async () => {
    // seed the map via handleChatCommand
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_2000\nWT:20:21\nCONV_URL:https://claude.ai/chat/cmd",
      "check-status": "READY",
      "read-response": "r",
      "get-title": "New conversation",
    };
    await handleChatCommand(makeMockCtx("/chat setup"));
    const replyCtx = makeMockCtx("/status", { replyToMessageId: 9000 });
    expect(await handleChatReply(replyCtx)).toBe(false);
  });

  test("returns false for empty message text", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_2010\nWT:22:23\nCONV_URL:https://claude.ai/chat/empty",
      "check-status": "READY",
      "read-response": "r",
      "get-title": "New conversation",
    };
    await handleChatCommand(makeMockCtx("/chat setup2"));
    const replyCtx = makeMockCtx("", { replyToMessageId: 9000 });
    expect(await handleChatReply(replyCtx)).toBe(false);
  });
});

// --- chat map persistence ---

describe("chat map persistence", () => {
  test("saveChatMap writes valid JSON", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_0300\nWT:60:61\nCONV_URL:https://claude.ai/chat/p",
      "check-status": "READY",
      "read-response": "p",
      "get-title": "New conversation",
    };
    mockWriteFileSync.mockClear();
    await handleChatCommand(makeMockCtx("/chat persist test"));
    const mapWrite = mockWriteFileSync.mock.calls.find(
      (c: any) => (c[0] as string).includes("croppy-chat-map")
    );
    expect(mapWrite).toBeTruthy();
    if (mapWrite) expect(() => JSON.parse(mapWrite[1] as string)).not.toThrow();
  });

  test("all exports are defined", () => {
    expect(handleChatCommand).toBeDefined();
    expect(handleChatsCommand).toBeDefined();
    expect(handlePostCommand).toBeDefined();
    expect(handleChatReply).toBeDefined();
  });
});

// --- auto-handoff detection ---

describe("auto-handoff detection", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
    writtenFiles = {};
  });

  test("supervisor detect is called after response relay", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_2200\nWT:40:41\nCONV_URL:https://claude.ai/chat/long",
      "check-status": "READY",
      "read-response": "response",
      "get-title": "Chat",
      "set-title": "OK",
      "rename-conversation": "OK",
      "detect": "OK",
    };
    await handleChatCommand(makeMockCtx("/chat handoff test"));
    await new Promise(r => setTimeout(r, 200));
    const detectCall = mockExecAsync.mock.calls.find(
      (c: any) => (c[0] as string).includes("detect")
    );
    expect(detectCall).toBeTruthy();
  }, 5000);

  test("handoff-chat NOT called when detect returns OK", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_2300\nWT:42:43\nCONV_URL:https://claude.ai/chat/short",
      "check-status": "READY",
      "read-response": "short",
      "get-title": "Chat",
      "set-title": "OK",
      "rename-conversation": "OK",
      "detect": "OK",
    };
    await handleChatCommand(makeMockCtx("/chat no handoff"));
    await new Promise(r => setTimeout(r, 200));
    const handoffCall = mockExecAsync.mock.calls.find(
      (c: any) => (c[0] as string).includes("handoff-chat")
    );
    expect(handoffCall).toBeUndefined();
  }, 5000);

  test("handoff-chat IS called when detect returns LONG_CHAT", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_2350\nWT:44:45\nCONV_URL:https://claude.ai/chat/longchat",
      "check-status": "READY",
      "read-response": "response",
      "get-title": "Chat",
      "set-title": "OK",
      "rename-conversation": "OK",
      "detect": "LONG_CHAT",
      "handoff-chat": "HANDOFF_OK\nCONV_URL:https://claude.ai/chat/new",
    };
    await handleChatCommand(makeMockCtx("/chat trigger handoff"));
    await new Promise(r => setTimeout(r, 200));
    const handoffCall = mockExecAsync.mock.calls.find(
      (c: any) => (c[0] as string).includes("handoff-chat")
    );
    expect(handoffCall).toBeTruthy();
  }, 5000);
});
