import { describe, test, expect, mock, beforeEach } from "bun:test";

// --- Mocks (before imports) ---

const mockTypingStop = mock(() => {});
mock.module("../../utils", () => ({
  auditLog: mock(() => Promise.resolve()),
  startTypingIndicator: mock(() => ({ stop: mockTypingStop })),
}));

const mockFetchWithTimeout = mock(() =>
  Promise.resolve({
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  })
);
mock.module("../../utils/fetch-with-timeout", () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}));

const mockExecAsync = mock((..._args: any[]) =>
  Promise.resolve({ stdout: "", stderr: "" })
);
mock.module("../../utils/exec-async", () => ({
  execAsync: mockExecAsync,
}));

const mockWriteFileSync = mock(() => {});
const mockUnlinkSync = mock(() => {});
mock.module("fs", () => ({
  ...require("fs"),
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
}));

const mockDispatchToWorker = mock(() => Promise.resolve());
mock.module("../croppy-bridge", () => ({
  dispatchToWorker: mockDispatchToWorker,
}));

// --- Import module under test ---
import { handleVoice } from "../voice-chat";

// --- Helpers ---

function makeMockCtx(overrides: Record<string, any> = {}) {
  return {
    from: { id: 123456, username: "testuser" },
    chat: { id: 100 },
    message: {
      voice: {
        file_id: "voice-file-123",
        file_unique_id: "unique-123",
        duration: 5,
      },
      ...overrides.message,
    },
    reply: mock(() => Promise.resolve()),
    replyWithChatAction: mock(() => Promise.resolve()),
    api: {
      getFile: mock(() =>
        Promise.resolve({
          file_id: "voice-file-123",
          file_path: "voice/file_0.oga",
        })
      ),
      ...(overrides.api || {}),
    },
    ...overrides,
  } as any;
}

// --- Tests ---

describe("handleVoice", () => {
  beforeEach(() => {
    mockTypingStop.mockClear();
    mockFetchWithTimeout.mockClear();
    mockExecAsync.mockClear();
    mockWriteFileSync.mockClear();
    mockUnlinkSync.mockClear();
    mockDispatchToWorker.mockClear();

    // Default: whisper returns transcribed text
    mockExecAsync.mockImplementation((cmd: string, _opts?: any) => {
      if (typeof cmd === "string" && cmd.includes("ffmpeg")) {
        return Promise.resolve({ stdout: "", stderr: "" });
      }
      if (typeof cmd === "string" && cmd.includes("whisper-cli")) {
        return Promise.resolve({ stdout: "  Hello world  \n", stderr: "" });
      }
      return Promise.resolve({ stdout: "", stderr: "" });
    });

    mockFetchWithTimeout.mockImplementation(() =>
      Promise.resolve({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      })
    );
  });

  // 1. Voice message handling: file download, transcription, response
  test("downloads voice file, transcribes, and replies with text", async () => {
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    // Downloaded file from Telegram
    expect(ctx.api.getFile).toHaveBeenCalledWith("voice-file-123");
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);

    // Wrote OGG to disk
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [path, buf] = mockWriteFileSync.mock.calls[0] as any[];
    expect(path).toMatch(/\/tmp\/voice-in-\d+\.ogg/);
    expect(buf).toBeInstanceOf(Buffer);

    // Replied with transcription
    const replyCall = ctx.reply.mock.calls.find((c: any[]) =>
      String(c[0]).includes("Hello world")
    );
    expect(replyCall).toBeTruthy();
  });

  // 2. Croppy bridge dispatch with transcribed text
  test("dispatches transcribed text to croppy bridge worker", async () => {
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    expect(mockDispatchToWorker).toHaveBeenCalledTimes(1);
    expect(mockDispatchToWorker).toHaveBeenCalledWith(ctx, "Hello world", {
      raw: true,
    });
  });

  // 3. Error handling: download failure
  test("replies with error when Telegram file download fails", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.reject(new Error("Network timeout"))
    );
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    const errorReply = ctx.reply.mock.calls.find((c: any[]) =>
      String(c[0]).includes("Voice chat error")
    );
    expect(errorReply).toBeTruthy();
    expect(String(errorReply![0])).toContain("Network timeout");
  });

  // 4. Error handling: transcription failure (whisper crash)
  test("replies with error when whisper CLI fails", async () => {
    mockExecAsync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("whisper-cli")) {
        return Promise.reject(new Error("whisper: model not found"));
      }
      return Promise.resolve({ stdout: "", stderr: "" });
    });
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    const errorReply = ctx.reply.mock.calls.find((c: any[]) =>
      String(c[0]).includes("Voice chat error")
    );
    expect(errorReply).toBeTruthy();
    expect(String(errorReply![0])).toContain("whisper");
  });

  // 5. File cleanup: temp files removed after processing (finally block)
  test("cleans up temp files after successful processing", async () => {
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    // unlinkSync called for both .ogg and .wav
    expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
    const paths = mockUnlinkSync.mock.calls.map((c: any[]) => c[0]);
    expect(paths.some((p: string) => p.endsWith(".ogg"))).toBe(true);
    expect(paths.some((p: string) => p.endsWith(".wav"))).toBe(true);
  });

  // 6. File cleanup on error path
  test("cleans up temp files even when an error occurs", async () => {
    mockExecAsync.mockImplementation(() =>
      Promise.reject(new Error("ffmpeg crash"))
    );
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    // Cleanup still runs in finally block
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  // 7. Edge case: empty transcription
  test("replies with recognition failure when whisper returns empty text", async () => {
    mockExecAsync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("whisper-cli")) {
        return Promise.resolve({ stdout: "   \n  ", stderr: "" });
      }
      return Promise.resolve({ stdout: "", stderr: "" });
    });
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    const failReply = ctx.reply.mock.calls.find((c: any[]) =>
      String(c[0]).includes("音声を認識できませんでした")
    );
    expect(failReply).toBeTruthy();
    // Should NOT dispatch to bridge
    expect(mockDispatchToWorker).not.toHaveBeenCalled();
  });

  // 8. FFmpeg conversion: OGG to WAV with correct parameters
  test("calls ffmpeg with correct 16kHz mono conversion params", async () => {
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    const ffmpegCall = mockExecAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("ffmpeg")
    );
    expect(ffmpegCall).toBeTruthy();
    const cmd = ffmpegCall![0] as string;
    expect(cmd).toContain("-y");
    expect(cmd).toContain("-ar 16000");
    expect(cmd).toContain("-ac 1");
    expect(cmd).toMatch(/voice-in-\d+\.ogg/);
    expect(cmd).toMatch(/voice-in-\d+\.wav/);
  });

  // 9. Whisper CLI invocation with correct parameters
  test("calls whisper-cli with correct model, language, and file params", async () => {
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    const whisperCall = mockExecAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("whisper-cli")
    );
    expect(whisperCall).toBeTruthy();
    const cmd = whisperCall![0] as string;
    expect(cmd).toContain("/opt/homebrew/bin/whisper-cli");
    expect(cmd).toContain("ggml-base.bin");
    expect(cmd).toContain("-l ja");
    expect(cmd).toContain("--no-timestamps");
    expect(cmd).toMatch(/-f \/tmp\/voice-in-\d+\.wav/);
  });

  // 10. Telegram file API download URL construction
  test("constructs correct Telegram file download URL", async () => {
    // Set a known token for URL verification
    const origToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token-123";

    const ctx = makeMockCtx();
    await handleVoice(ctx);

    const fetchUrl = (mockFetchWithTimeout.mock.calls[0] as any[])[0] as string;
    expect(fetchUrl).toBe(
      "https://api.telegram.org/file/bottest-bot-token-123/voice/file_0.oga"
    );

    process.env.TELEGRAM_BOT_TOKEN = origToken;
  });

  // 11. No voice in message - early return
  test("returns early when message has no voice", async () => {
    const ctx = makeMockCtx({ message: { voice: undefined } });
    await handleVoice(ctx);

    expect(ctx.api.getFile).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  // 12. No chat id - early return
  test("returns early when chat id is missing", async () => {
    const ctx = makeMockCtx({ chat: undefined });
    await handleVoice(ctx);

    expect(ctx.api.getFile).not.toHaveBeenCalled();
  });

  // 13. File path inaccessible
  test("replies with error when file_path is missing from getFile response", async () => {
    const ctx = makeMockCtx({
      api: {
        getFile: mock(() =>
          Promise.resolve({ file_id: "voice-file-123", file_path: undefined })
        ),
      },
    });
    await handleVoice(ctx);

    const errorReply = ctx.reply.mock.calls.find((c: any[]) =>
      String(c[0]).includes("Voice file inaccessible")
    );
    expect(errorReply).toBeTruthy();
  });

  // 14. Typing indicator stopped in both success and error paths
  test("stops typing indicator on success", async () => {
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    // Called at least once (bridge takes over + finally block)
    expect(mockTypingStop).toHaveBeenCalled();
  });

  test("stops typing indicator on error", async () => {
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.reject(new Error("fail"))
    );
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    expect(mockTypingStop).toHaveBeenCalled();
  });

  // 15. Error message truncation (long errors)
  test("truncates long error messages to 200 chars", async () => {
    const longMsg = "x".repeat(500);
    mockFetchWithTimeout.mockImplementation(() =>
      Promise.reject(new Error(longMsg))
    );
    const ctx = makeMockCtx();
    await handleVoice(ctx);

    const errorReply = ctx.reply.mock.calls.find((c: any[]) =>
      String(c[0]).includes("Voice chat error")
    );
    expect(errorReply).toBeTruthy();
    // The prefix is about 22 chars, the error portion is at most 200
    expect(String(errorReply![0]).length).toBeLessThanOrEqual(225);
  });
});
