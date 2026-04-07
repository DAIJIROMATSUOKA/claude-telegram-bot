import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// --- Mocks (paths relative to THIS test file in src/services/__tests__/) ---
// To reach src/services/gateway-db → ../gateway-db
// To reach src/handlers/timetimer-command → ../../handlers/timetimer-command
// To reach src/utils/logger → ../../utils/logger

const mockGatewayQuery = mock(async () => ({ results: [] as any[], meta: {} }));
mock.module("../gateway-db", () => ({ gatewayQuery: mockGatewayQuery }));

mock.module("../../handlers/timetimer-command", () => ({
  buildTimerText: mock(
    (remaining: number, total: number, label: string) =>
      `⏱ ${remaining}/${total}min ${label}`
  ),
}));

mock.module("../../utils/logger", () => ({
  createLogger: () => ({
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
  }),
}));

// --- Import module under test ---
import {
  startSnoozeChecker,
  stopSnoozeChecker,
  checkJarvisNotifs,
  checkTimeTimers,
  midnightInboxCheck,
} from "../snooze";

function makeMockBot(overrides: any = {}) {
  return {
    api: {
      sendMessage: mock(async () => ({ message_id: 999 })),
      editMessageText: mock(async () => ({})),
      deleteMessage: mock(async () => ({})),
      raw: {
        unpinChatMessage: mock(async () => ({})),
      },
      ...overrides,
    },
  } as any;
}

beforeEach(() => {
  mockGatewayQuery.mockReset();
  mockGatewayQuery.mockImplementation(async () => ({ results: [], meta: {} }));
});

afterEach(() => {
  stopSnoozeChecker();
});

describe("startSnoozeChecker / stopSnoozeChecker", () => {
  test("startSnoozeChecker starts without throwing", () => {
    const bot = makeMockBot();
    expect(() => startSnoozeChecker(bot)).not.toThrow();
  });

  test("startSnoozeChecker is idempotent (second call is no-op)", () => {
    const bot = makeMockBot();
    startSnoozeChecker(bot);
    startSnoozeChecker(bot); // second call should not throw or create second timer
  });

  test("stopSnoozeChecker can be called when no checker is running", () => {
    expect(() => stopSnoozeChecker()).not.toThrow();
  });

  test("stop-start cycle works correctly", () => {
    const bot = makeMockBot();
    startSnoozeChecker(bot);
    stopSnoozeChecker();
    startSnoozeChecker(bot);
    stopSnoozeChecker();
  });
});

describe("checkJarvisNotifs", () => {
  test("does nothing when no notifications are due", async () => {
    mockGatewayQuery.mockImplementation(async () => ({ results: [], meta: {} }));
    const bot = makeMockBot();

    await checkJarvisNotifs(bot);

    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  test("sends notification for each due item", async () => {
    mockGatewayQuery
      .mockImplementationOnce(async () => ({
        results: [
          { id: 1, chat_id: "123", label: "伊藤ハム電話", last_msg_id: null },
          { id: 2, chat_id: "456", label: "設計レビュー", last_msg_id: null },
        ],
        meta: {},
      }))
      .mockImplementation(async () => ({ results: [], meta: {} })); // for UPDATE calls

    const bot = makeMockBot();

    await checkJarvisNotifs(bot);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
    const calls = bot.api.sendMessage.mock.calls as any[][];
    expect((calls[0] as any[])[1]).toContain("伊藤ハム電話");
    expect((calls[1] as any[])[1]).toContain("設計レビュー");
  });

  test("deletes previous snooze message before sending new notification", async () => {
    mockGatewayQuery
      .mockImplementationOnce(async () => ({
        results: [{ id: 1, chat_id: "123", label: "会議", last_msg_id: 888 }],
        meta: {},
      }))
      .mockImplementation(async () => ({ results: [], meta: {} }));

    const bot = makeMockBot();

    await checkJarvisNotifs(bot);

    expect(bot.api.deleteMessage).toHaveBeenCalledWith(123, 888);
  });

  test("notification includes ✅完了 and ⏸停止 inline buttons", async () => {
    mockGatewayQuery
      .mockImplementationOnce(async () => ({
        results: [{ id: 5, chat_id: "789", label: "フォローアップ", last_msg_id: null }],
        meta: {},
      }))
      .mockImplementation(async () => ({ results: [], meta: {} }));

    const bot = makeMockBot();

    await checkJarvisNotifs(bot);

    const sendArgs = (bot.api.sendMessage.mock.calls[0] as any[])[2];
    const buttons = sendArgs.reply_markup.inline_keyboard[0];
    const callbackData = buttons.map((b: any) => b.callback_data);
    expect(callbackData).toContain("jn_done:5");
    expect(callbackData).toContain("jn_stop:5");
  });

  test("handles gateway query error gracefully without throwing", async () => {
    mockGatewayQuery.mockImplementationOnce(async () => {
      throw new Error("D1 connection refused");
    });

    const bot = makeMockBot();

    await expect(checkJarvisNotifs(bot)).resolves.toBeUndefined();
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });
});

describe("checkTimeTimers", () => {
  test("does nothing when no active timers exist", async () => {
    mockGatewayQuery.mockImplementation(async () => ({ results: [], meta: {} }));
    const bot = makeMockBot();

    await checkTimeTimers(bot);

    expect(bot.api.editMessageText).not.toHaveBeenCalled();
  });

  test("decrements remaining minutes and edits timer message", async () => {
    mockGatewayQuery
      .mockImplementationOnce(async () => ({
        results: [
          {
            id: 1,
            chat_id: "111",
            msg_id: "500",
            total_minutes: 25,
            remaining_minutes: 10,
            label: "Pomodoro",
          },
        ],
        meta: {},
      }))
      .mockImplementation(async () => ({ results: [], meta: {} }));

    const bot = makeMockBot();

    await checkTimeTimers(bot);

    expect(bot.api.editMessageText).toHaveBeenCalledTimes(1);
    const editArgs = (bot.api.editMessageText.mock.calls[0] as any[]);
    expect(editArgs[0]).toBe(111); // chat_id
    expect(editArgs[1]).toBe(500); // msg_id
    // Text from mocked buildTimerText: "⏱ 9/25min Pomodoro"
    expect(editArgs[2]).toContain("9/25");
  });

  test("marks timer as done and clears keyboard when remaining reaches zero", async () => {
    mockGatewayQuery
      .mockImplementationOnce(async () => ({
        results: [
          {
            id: 2,
            chat_id: "222",
            msg_id: "600",
            total_minutes: 5,
            remaining_minutes: 1,
            label: "",
          },
        ],
        meta: {},
      }))
      .mockImplementation(async () => ({ results: [], meta: {} }));

    const bot = makeMockBot();

    await checkTimeTimers(bot);

    // Should unpin and edit with empty keyboard
    expect(bot.api.raw.unpinChatMessage).toHaveBeenCalled();
    const editArgs = (bot.api.editMessageText.mock.calls[0] as any[]);
    // remaining = 1-1 = 0, total = 5: text contains "0/5"
    expect(editArgs[2]).toContain("0/5");
    expect(editArgs[3].reply_markup.inline_keyboard).toEqual([]);
  });

  test("handles gateway error gracefully", async () => {
    mockGatewayQuery.mockImplementationOnce(async () => {
      throw new Error("Query timeout");
    });

    const bot = makeMockBot();

    await expect(checkTimeTimers(bot)).resolves.toBeUndefined();
  });
});

describe("midnightInboxCheck", () => {
  test("returns without scheduling when no unprocessed messages found", async () => {
    mockGatewayQuery.mockImplementation(async () => ({ results: [], meta: {} }));
    const bot = makeMockBot();

    await midnightInboxCheck(bot);

    const insertCalls = (mockGatewayQuery.mock.calls as any[][]).filter(
      (call) => typeof call[0] === "string" && call[0].includes("INSERT")
    );
    expect(insertCalls.length).toBe(0);
  });

  test("schedules snooze re-notifications for unprocessed gmail messages", async () => {
    mockGatewayQuery
      .mockImplementationOnce(async () => ({
        results: [
          {
            id: 10,
            telegram_msg_id: 101,
            telegram_chat_id: 999,
            source: "gmail",
            source_id: "msg-abc",
            source_detail: JSON.stringify({ subject: "伊藤ハム件" }),
          },
        ],
        meta: {},
      }))
      .mockImplementation(async () => ({ results: [], meta: {} }));

    const bot = makeMockBot();

    await midnightInboxCheck(bot);

    const calls = mockGatewayQuery.mock.calls as any[][];
    const insertCall = calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO snooze_queue")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1][0]).toBe(10); // mapping_id
    const content = JSON.parse(insertCall![1][1]);
    expect(content.text).toContain("伊藤ハム件");
    expect(content.text).toContain("📌");
  });

  test("handles gateway error gracefully", async () => {
    mockGatewayQuery.mockImplementationOnce(async () => {
      throw new Error("D1 error");
    });

    const bot = makeMockBot();

    await expect(midnightInboxCheck(bot)).resolves.toBeUndefined();
  });
});
