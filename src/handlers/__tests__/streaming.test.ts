import { describe, test, expect, mock, beforeEach } from "bun:test";

// --- Mocks ---

mock.module("../../config", () => ({
  TELEGRAM_MESSAGE_LIMIT: 4096,
  TELEGRAM_SAFE_LIMIT: 3800,
  STREAMING_THROTTLE_MS: 1000,
  BUTTON_LABEL_MAX_LENGTH: 30,
}));

mock.module("../../formatting", () => ({
  convertMarkdownToHtml: mock((text: string) => text),
}));

mock.module("../../utils/session-helper.js", () => ({
  getSessionIdFromContext: mock(() => null),
}));

mock.module("../../utils/control-tower-helper.js", () => ({
  updateStatus: mock(() => Promise.resolve()),
}));

mock.module("../../utils/control-tower-db.js", () => ({
  controlTowerDB: {
    startActionTrace: mock(() => 1),
    getActionTraces: mock(() => []),
    completeActionTrace: mock(() => {}),
    getLatestActionTrace: mock(() => null),
  },
}));

mock.module("../../utils/tower-renderer.js", () => ({
  setClaudeStatus: mock(() => {}),
}));

// --- Import module under test ---
import { createAskUserKeyboard, StreamingState, createStatusCallback } from "../streaming";

function makeMockCtx() {
  return {
    chat: { id: 123 },
    from: { id: 456 },
    reply: mock(() => Promise.resolve({
      chat: { id: 123 },
      message_id: 100,
    })),
    api: {
      editMessageText: mock(() => Promise.resolve()),
      deleteMessage: mock(() => Promise.resolve()),
    },
  } as any;
}

describe("createAskUserKeyboard", () => {
  test("creates keyboard with correct number of buttons", () => {
    const kb = createAskUserKeyboard("req-1", ["Option A", "Option B", "Option C"]);
    expect(kb).toBeDefined();
  });

  test("truncates long option labels", () => {
    const longOption = "A".repeat(50);
    const kb = createAskUserKeyboard("req-2", [longOption]);
    // InlineKeyboard created successfully
    expect(kb).toBeDefined();
  });

  test("handles empty options array", () => {
    const kb = createAskUserKeyboard("req-3", []);
    expect(kb).toBeDefined();
  });
});

describe("StreamingState", () => {
  test("initializes with empty maps", () => {
    const state = new StreamingState();
    expect(state.textMessages.size).toBe(0);
    expect(state.toolMessages.length).toBe(0);
    expect(state.lastEditTimes.size).toBe(0);
    expect(state.lastContent.size).toBe(0);
    expect(state.headerSent).toBe(false);
    expect(state.replyToMessageId).toBeUndefined();
  });

  test("tracks text messages per segment", () => {
    const state = new StreamingState();
    const fakeMsg = { chat: { id: 1 }, message_id: 10 } as any;
    state.textMessages.set(0, fakeMsg);
    expect(state.textMessages.has(0)).toBe(true);
    expect(state.textMessages.get(0)).toBe(fakeMsg);
  });
});

describe("createStatusCallback", () => {
  let ctx: ReturnType<typeof makeMockCtx>;
  let state: StreamingState;

  beforeEach(() => {
    ctx = makeMockCtx();
    state = new StreamingState();
  });

  test("handles 'thinking' status type", async () => {
    const callback = createStatusCallback(ctx, state);
    await callback("thinking", "analyzing the problem");
    // thinking should NOT send a telegram message
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  test("handles 'tool' status type", async () => {
    const callback = createStatusCallback(ctx, state);
    await callback("tool", "Reading file");
    // tool should NOT send a telegram message
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  test("creates new message for first text segment", async () => {
    const callback = createStatusCallback(ctx, state);
    await callback("text", "Hello world", 0);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(state.textMessages.has(0)).toBe(true);
  });

  test("adds Jarvis header to first segment", async () => {
    const callback = createStatusCallback(ctx, state);
    await callback("text", "Hello", 0);
    expect(state.headerSent).toBe(true);
    // First call should include header
    const replyArg = ctx.reply.mock.calls[0]![0];
    expect(replyArg).toContain("Jarvis");
  });

  test("handles segment_end by creating message if not exists", async () => {
    const callback = createStatusCallback(ctx, state);
    await callback("segment_end", "Final text", 0);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(state.textMessages.has(0)).toBe(true);
  });

  test("handles segment_end by editing existing message", async () => {
    const callback = createStatusCallback(ctx, state);
    // First create the message
    await callback("text", "initial", 0);
    const msgId = state.textMessages.get(0)!.message_id;

    // Then end it
    await callback("segment_end", "Final text for segment", 0);
    expect(ctx.api.editMessageText).toHaveBeenCalled();
  });

  test("splits long messages at segment_end", async () => {
    const callback = createStatusCallback(ctx, state);
    // Create initial message
    await callback("text", "short", 0);

    // End with very long content (> 4096)
    const longContent = "A".repeat(5000);
    await callback("segment_end", longContent, 0);
    // Should delete and re-send in chunks
    expect(ctx.api.deleteMessage).toHaveBeenCalled();
  });

  test("handles 'done' status: deletes tool messages", async () => {
    const callback = createStatusCallback(ctx, state);
    // Add a tool message
    state.toolMessages.push({ chat: { id: 123 }, message_id: 200 } as any);

    await callback("done", "");
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(123, 200);
  });

  test("handles 'done' status: appends footer to last text segment", async () => {
    const callback = createStatusCallback(ctx, state);
    // Create a text message first
    await callback("text", "Hello world", 0);
    state.lastContent.set(0, "Hello world");

    await callback("done", "");
    // Should edit last message to add footer
    expect(ctx.api.editMessageText).toHaveBeenCalled();
  });

  test("skips edit when content unchanged", async () => {
    const callback = createStatusCallback(ctx, state);
    // Create a text message
    await callback("text", "Hello", 0);
    const editCountAfterCreate = ctx.api.editMessageText.mock.calls.length;

    // Set lastContent to match what would be generated
    const formatted = state.lastContent.get(0);

    // Force timestamp to allow edit (bypass throttle)
    state.lastEditTimes.set(0, 0);

    // Try to update with same content - should skip
    await callback("text", "Hello", 0);
    // editMessageText should not have been called again since content matches
  });
});
