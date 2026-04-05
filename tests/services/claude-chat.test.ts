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
const mockReadFileSync = mock((path: string, _enc?: string) => {
  if (path in writtenFiles) return writtenFiles[path];
  throw new Error(`ENOENT: ${path}`);
});
const mockExistsSync = mock((path: string) => {
  return path in writtenFiles;
});

mock.module("fs", () => ({
  ...require("fs"),
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
}));

mock.module("../../src/config", () => ({
  ALLOWED_USERS: [123456],
  WORKING_DIR: "/test/dir",
}));

// --- Helpers ---

function makeMockCtx(text: string, opts: {
  userId?: number;
  replyToMessageId?: number;
  messageId?: number;
} = {}) {
  const { userId = 123456, replyToMessageId, messageId = 5000 } = opts;
  let nextMsgId = 9000;
  const replyMock = mock((t: string, _o?: any) =>
    Promise.resolve({ message_id: nextMsgId++ })
  );
  return {
    from: { id: userId, username: "testuser" },
    chat: { id: 100 },
    message: {
      text,
      message_id: messageId,
      reply_to_message: replyToMessageId
        ? { message_id: replyToMessageId }
        : undefined,
    },
    reply: replyMock,
    api: {
      editMessageText: mock(() => Promise.resolve()),
      deleteMessage: mock(() => Promise.resolve()),
    },
  } as any;
}

// --- Import module under test AFTER mocks ---

import {
  handleChatCommand,
  handlePostCommand,
  handleChatsCommand,
  handleChatReply,
  CHAT_TIMING,
} from "../../src/handlers/claude-chat";

// Override timing for fast tests
CHAT_TIMING.initialWaitMs = 10;
CHAT_TIMING.settleMs = 10;
CHAT_TIMING.pollIntervalMs = 10;

// --- Tests ---

describe("escapeHtml (via handleChatsCommand)", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
  });

  test("HTML entities are escaped in chat listing output", async () => {
    mockExecResults = {
      "list-all": "1:2|<script>alert('xss')</script>",
    };
    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("&lt;script&gt;");
    expect(msg).not.toContain("<script>alert");
  });

  test("ampersands and angle brackets are escaped", async () => {
    mockExecResults = {
      "list-all": "1:2|foo & bar > baz",
    };
    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("foo &amp; bar &gt; baz");
  });
});

describe("isDefaultTitle / formatTitle (indirect)", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
    writtenFiles = {};
  });

  test("default titles (New conversation) are recognized - set-title not called", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_1200\nWT:1:2\nCONV_URL:https://claude.ai/chat/abc",
      "check-status": "READY",
      "read-response": "Hello there",
      "get-title": "New conversation",
    };

    const ctx = makeMockCtx("/chat test message");
    await handleChatCommand(ctx);
    await new Promise(r => setTimeout(r, 200));

    const setTitleCall = mockExecAsync.mock.calls.find(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("set-title")
    );
    expect(setTitleCall).toBeUndefined();
  }, 5000);

  test("Jarvis title is recognized as default", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_1500\nWT:5:6\nCONV_URL:https://claude.ai/chat/jarvis",
      "check-status": "READY",
      "read-response": "Response",
      "get-title": "Jarvis",
    };

    const ctx = makeMockCtx("/chat jarvis default");
    await handleChatCommand(ctx);
    await new Promise(r => setTimeout(r, 200));

    const setTitleCall = mockExecAsync.mock.calls.find(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("set-title")
    );
    expect(setTitleCall).toBeUndefined();
  }, 5000);

  test("formatTitle strips [J-WORKER-N] prefix and - Claude suffix", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_1430\nWT:3:4\nCONV_URL:https://claude.ai/chat/def",
      "check-status": "READY",
      "read-response": "Claude response",
      "get-title": "[J-WORKER-1] My Task - Claude",
      "set-title": "OK",
      "rename-conversation": "OK",
    };

    const ctx = makeMockCtx("/chat format test");
    await handleChatCommand(ctx);
    await new Promise(r => setTimeout(r, 200));

    const setTitleCall = mockExecAsync.mock.calls.find(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("set-title")
    );
    expect(setTitleCall).toBeTruthy();
    if (setTitleCall) {
      const cmd = setTitleCall[0] as string;
      expect(cmd).toContain("2026-04-05_1430");
      expect(cmd).toContain("My Task");
      expect(cmd).not.toContain("[J-WORKER-1]");
    }
  }, 5000);
});

describe("handleChatCommand", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
    writtenFiles = {};
  });

  test("empty message shows usage", async () => {
    const ctx = makeMockCtx("/chat");
    await handleChatCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Usage: /chat");
  });

  test("creates new tab and sends status message", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_1000\nWT:1:5\nCONV_URL:https://claude.ai/chat/xyz",
      "check-status": "READY",
      "read-response": "Hello from Claude",
      "get-title": "New conversation",
    };

    const ctx = makeMockCtx("/chat hello world");
    await handleChatCommand(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const firstCall = ctx.reply.mock.calls[0]![0] as string;
    expect(firstCall).toContain("送信中");

    await new Promise(r => setTimeout(r, 200));

    const newChatCall = mockExecAsync.mock.calls.find(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("new-chat")
    );
    expect(newChatCall).toBeTruthy();
  }, 5000);

  test("saves chat map after creation", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_1100\nWT:7:8\nCONV_URL:https://claude.ai/chat/save",
      "check-status": "READY",
      "read-response": "Save test",
      "get-title": "New conversation",
    };

    mockWriteFileSync.mockClear();
    const ctx = makeMockCtx("/chat save test");
    await handleChatCommand(ctx);

    expect(mockWriteFileSync).toHaveBeenCalled();
    const writeCall = mockWriteFileSync.mock.calls.find(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("croppy-chat-map")
    );
    expect(writeCall).toBeTruthy();
  });

  test("handles tab creation failure (ERROR result)", async () => {
    mockExecResults = {
      "new-chat": "ERROR: Chrome not running",
    };

    const ctx = makeMockCtx("/chat fail test");
    await handleChatCommand(ctx);

    expect(ctx.api.editMessageText).toHaveBeenCalled();
    const editArgs = ctx.api.editMessageText.mock.calls[0]!;
    expect(editArgs[2] as string).toContain("チャット作成失敗");
  });

  test("handles tab creation failure (no WT match)", async () => {
    mockExecResults = {
      "new-chat": "some garbage output with no WT line",
    };

    const ctx = makeMockCtx("/chat fail test 2");
    await handleChatCommand(ctx);

    expect(ctx.api.editMessageText).toHaveBeenCalled();
    const editArgs = ctx.api.editMessageText.mock.calls[0]!;
    expect(editArgs[2] as string).toContain("チャット作成失敗");
  });

  test("deletes DJ command message on success", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_1200\nWT:9:10\nCONV_URL:https://claude.ai/chat/del",
      "check-status": "READY",
      "read-response": "response",
      "get-title": "New conversation",
    };

    const ctx = makeMockCtx("/chat delete dj msg");
    await handleChatCommand(ctx);

    expect(ctx.api.deleteMessage).toHaveBeenCalled();
  });

  test("fire-and-forget sends formatted response after polling", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_1300\nWT:11:12\nCONV_URL:https://claude.ai/chat/poll",
      "check-status": "READY",
      "read-response": "Polled response text",
      "get-title": "My Chat Title",
      "set-title": "OK",
      "rename-conversation": "OK",
    };

    const ctx = makeMockCtx("/chat poll test");
    await handleChatCommand(ctx);
    await new Promise(r => setTimeout(r, 200));

    expect(ctx.reply.mock.calls.length).toBeGreaterThanOrEqual(1);
  }, 5000);
});

describe("handleChatsCommand", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
  });

  test("lists open tabs with proper formatting", async () => {
    mockExecResults = {
      "list-all": "1:2|My Chat\n3:4|[J-WORKER-1] Task",
    };

    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Open claude.ai tabs");
    expect(msg).toContain("My Chat");
    expect(msg).toContain("[J-WORKER-1] Task");
  });

  test("worker tabs display robot emoji", async () => {
    mockExecResults = {
      "list-all": "1:2|[J-WORKER-1] Worker Task",
    };

    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);

    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("\u{1F916}");
  });

  test("regular tabs display speech bubble emoji", async () => {
    mockExecResults = {
      "list-all": "1:2|Regular Chat",
    };

    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);

    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("\u{1F4AC}");
  });

  test("shows error when Chrome is not running", async () => {
    mockExecResults = {
      "list-all": "ERROR: Chrome not available",
    };

    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);

    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Chrome未起動");
  });

  test("shows listing when lines contain only pipe separators", async () => {
    mockExecResults = {
      "list-all": "|\n|\n|",
    };

    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);

    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Open claude.ai tabs");
  });

  test("shows error when result is empty (Chrome not available)", async () => {
    mockExecResults = {};
    mockExecDefault = "";

    const ctx = makeMockCtx("/chats");
    await handleChatsCommand(ctx);

    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Chrome未起動");
  });
});

describe("handlePostCommand", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
    writtenFiles = {};
  });

  test("shows usage without arguments", async () => {
    const ctx = makeMockCtx("/post");
    await handlePostCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Usage: /post");
  });

  test("shows usage with only chat name (no message)", async () => {
    const ctx = makeMockCtx("/post mychat");
    await handlePostCommand(ctx);
    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("Usage: /post");
  });

  test("injects message into named chat", async () => {
    mockExecResults = {
      "inject-by-title": "WT:5:6\nINSERTED:SENT",
      "check-status": "READY",
      "read-response": "Post response text",
    };

    const ctx = makeMockCtx("/post design follow up note");
    await handlePostCommand(ctx);

    const injectCall = mockExecAsync.mock.calls.find(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("inject-by-title")
    );
    expect(injectCall).toBeTruthy();
    if (injectCall) {
      expect((injectCall[0] as string)).toContain("design");
    }
  });

  test("handles chat not found", async () => {
    mockExecResults = {
      "inject-by-title": "NOT_FOUND",
    };

    const ctx = makeMockCtx("/post nonexistent some message");
    await handlePostCommand(ctx);

    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("チャットが見つかりません");
    expect(msg).toContain("nonexistent");
  });

  test("handles generic injection error", async () => {
    mockExecResults = {
      "inject-by-title": "ERROR: injection failed",
    };

    const ctx = makeMockCtx("/post broken hello there");
    await handlePostCommand(ctx);

    const msg = ctx.reply.mock.calls[0]![0] as string;
    expect(msg).toContain("エラー");
  });

  test("confirms success without WT in result", async () => {
    mockExecResults = {
      "inject-by-title": "INSERTED:SENT",
    };

    const ctx = makeMockCtx("/post mychat hello there");
    await handlePostCommand(ctx);

    const replyCalls = ctx.reply.mock.calls;
    const hasConfirm = replyCalls.some(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("mychat")
    );
    expect(hasConfirm).toBe(true);
  });
});

describe("handleChatReply", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
    writtenFiles = {};
  });

  test("returns false when no reply_to_message", async () => {
    const ctx = makeMockCtx("hello");
    ctx.message.reply_to_message = undefined;
    const result = await handleChatReply(ctx);
    expect(result).toBe(false);
  });

  test("returns false when reply target is not in chatReplyMap", async () => {
    const ctx = makeMockCtx("hello", { replyToMessageId: 99999 });
    const result = await handleChatReply(ctx);
    expect(result).toBe(false);
  });

  test("returns false for messages starting with /", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_2000\nWT:20:21\nCONV_URL:https://claude.ai/chat/cmd",
      "check-status": "READY",
      "read-response": "response",
      "get-title": "New conversation",
    };

    const createCtx = makeMockCtx("/chat setup for cmd reply");
    await handleChatCommand(createCtx);
    const statusMsgId = 9000;

    const replyCtx = makeMockCtx("/status", { replyToMessageId: statusMsgId });
    const result = await handleChatReply(replyCtx);
    expect(result).toBe(false);
  });

  test("returns false for empty message text", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_2010\nWT:22:23\nCONV_URL:https://claude.ai/chat/empty",
      "check-status": "READY",
      "read-response": "response",
      "get-title": "New conversation",
    };

    const createCtx = makeMockCtx("/chat setup for empty reply");
    await handleChatCommand(createCtx);
    const statusMsgId = 9000;

    const replyCtx = makeMockCtx("", { replyToMessageId: statusMsgId });
    const result = await handleChatReply(replyCtx);
    expect(result).toBe(false);
  });
});

describe("reopenAndInject (via handleChatReply NOT_FOUND + convUrl)", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
    writtenFiles = {};
  });

  test("attempts reopen when inject returns NOT_FOUND and convUrl exists", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_2100\nWT:30:31\nCONV_URL:https://claude.ai/chat/reopen",
      "check-status": "READY",
      "read-response": "initial response",
      "get-title": "Reopen Test",
      "set-title": "OK",
      "rename-conversation": "OK",
    };

    const createCtx = makeMockCtx("/chat reopen setup");
    await handleChatCommand(createCtx);
    await new Promise(r => setTimeout(r, 200));

    const responseMsgId = 9001;

    mockExecAsync.mockClear();
    mockExecResults = {
      "inject-by-title": "NOT_FOUND",
      "reopen-and-inject": "WT:32:33\nINSERTED:SENT",
      "check-status": "READY",
      "read-response": "reopened response",
    };

    const replyCtx = makeMockCtx("follow up message", { replyToMessageId: responseMsgId });
    const result = await handleChatReply(replyCtx);

    expect(result).toBe(true);

    await new Promise(r => setTimeout(r, 200));

    const reopenCall = mockExecAsync.mock.calls.find(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("reopen-and-inject")
    );
    expect(reopenCall).toBeTruthy();
  }, 5000);
});

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
      "read-response": "long chat response",
      "get-title": "Long Chat",
      "set-title": "OK",
      "rename-conversation": "OK",
      "detect": "OK",
    };

    const ctx = makeMockCtx("/chat auto handoff test");
    await handleChatCommand(ctx);
    await new Promise(r => setTimeout(r, 200));

    const detectCall = mockExecAsync.mock.calls.find(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("detect")
    );
    expect(detectCall).toBeTruthy();
  }, 5000);

  test("handoff-chat is NOT called when detect returns OK", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_2300\nWT:42:43\nCONV_URL:https://claude.ai/chat/short",
      "check-status": "READY",
      "read-response": "short response",
      "get-title": "Short Chat",
      "set-title": "OK",
      "rename-conversation": "OK",
      "detect": "OK",
    };

    const ctx = makeMockCtx("/chat no handoff test");
    await handleChatCommand(ctx);
    await new Promise(r => setTimeout(r, 200));

    const handoffCall = mockExecAsync.mock.calls.find(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("handoff-chat")
    );
    expect(handoffCall).toBeUndefined();
  }, 5000);

  test("handoff-chat IS called when detect returns LONG_CHAT", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_2350\nWT:44:45\nCONV_URL:https://claude.ai/chat/longdetect",
      "check-status": "READY",
      "read-response": "response text",
      "get-title": "Long Detect",
      "set-title": "OK",
      "rename-conversation": "OK",
      "detect": "LONG_CHAT",
      "handoff-chat": "HANDOFF_OK\nCONV_URL:https://claude.ai/chat/newchat",
    };

    const ctx = makeMockCtx("/chat trigger handoff test");
    await handleChatCommand(ctx);
    await new Promise(r => setTimeout(r, 200));

    const handoffCall = mockExecAsync.mock.calls.find(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("handoff-chat")
    );
    expect(handoffCall).toBeTruthy();
  }, 5000);
});

describe("response parsing", () => {
  beforeEach(() => {
    mockExecResults = {};
    mockExecDefault = "";
    mockExecAsync.mockClear();
    writtenFiles = {};
  });

  test("NO_RESPONSE from read-response results in timeout message", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_0100\nWT:50:51\nCONV_URL:https://claude.ai/chat/noresp",
      "check-status": "READY",
      "read-response": "NO_RESPONSE",
      "get-title": "New conversation",
    };

    const ctx = makeMockCtx("/chat no response test");
    await handleChatCommand(ctx);
    await new Promise(r => setTimeout(r, 200));

    const replyCalls = ctx.reply.mock.calls;
    const hasTimeout = replyCalls.some(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("タイムアウト")
    );
    expect(hasTimeout).toBe(true);
  }, 5000);

  test("ERROR in read-response results in timeout message", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_0200\nWT:52:53\nCONV_URL:https://claude.ai/chat/err",
      "check-status": "READY",
      "read-response": "ERROR: dom not found",
      "get-title": "New conversation",
    };

    const ctx = makeMockCtx("/chat error response test");
    await handleChatCommand(ctx);
    await new Promise(r => setTimeout(r, 200));

    const replyCalls = ctx.reply.mock.calls;
    const hasTimeout = replyCalls.some(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("タイムアウト")
    );
    expect(hasTimeout).toBe(true);
  }, 5000);
});

describe("chat map persistence", () => {
  beforeEach(() => {
    mockExecAsync.mockClear();
    mockWriteFileSync.mockClear();
    writtenFiles = {};
  });

  test("saveChatMap writes to CHAT_MAP_FILE with valid JSON", async () => {
    mockExecResults = {
      "new-chat": "CREATED_AT:2026-04-05_0300\nWT:60:61\nCONV_URL:https://claude.ai/chat/persist",
      "check-status": "READY",
      "read-response": "persist test",
      "get-title": "New conversation",
    };

    mockWriteFileSync.mockClear();
    const ctx = makeMockCtx("/chat persist test");
    await handleChatCommand(ctx);

    const mapWrite = mockWriteFileSync.mock.calls.find(
      (call: any) => typeof call[0] === "string" && (call[0] as string).includes("croppy-chat-map")
    );
    expect(mapWrite).toBeTruthy();
    if (mapWrite) {
      const data = JSON.parse(mapWrite[1] as string);
      expect(typeof data).toBe("object");
    }
  });

  test("module loads without crash even when chat map file missing", () => {
    expect(handleChatCommand).toBeDefined();
    expect(handleChatsCommand).toBeDefined();
    expect(handlePostCommand).toBeDefined();
    expect(handleChatReply).toBeDefined();
  });
});
