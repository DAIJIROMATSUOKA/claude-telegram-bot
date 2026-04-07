import { describe, test, expect, mock, spyOn, beforeEach, afterEach, afterAll } from "bun:test";
import * as fs from "fs";
import * as jsonLoader from "../utils/json-loader";

// Mock modules before importing the handler
const mockExecSync = mock(() => "task1 running PID 1234");
const mockExec = mock((_cmd: string, _opts: any, cb: Function) => {
  cb(null, "SPAWNED: task123\nPID: 9999", "");
});
const mockExistsSync = mock(() => false);
const mockLoadJsonFile = mock(() => ({ pid: 1234, task_id: "abc" }));

mock.module("child_process", () => ({
  ...require("child_process"),
  exec: mockExec,
  execSync: mockExecSync,
}));

const existsSyncSpy = spyOn(fs, "existsSync").mockImplementation((...args: any[]) => (mockExistsSync as any)(...args) as any);
const loadJsonFileSpy = spyOn(jsonLoader, "loadJsonFile").mockImplementation((...args: any[]) => (mockLoadJsonFile as any)(...args));

mock.module("../security", () => ({
  isAuthorized: (userId: number | undefined, _allowed: number[]) => userId === 123456,
}));

mock.module("../config", () => ({
  ALLOWED_USERS: [123456],
}));

import { handleCode } from "./code-command";

function makeMockCtx(text: string, userId: number = 123456) {
  return {
    from: { id: userId },
    message: { text },
    reply: mock(() => Promise.resolve()),
  } as any;
}

describe("handleCode", () => {
  beforeEach(() => {
    mockExecSync.mockClear();
    mockExec.mockClear();
    mockExistsSync.mockClear();
    mockLoadJsonFile.mockClear();
  });

  test("unauthorized user is rejected silently", async () => {
    const ctx = makeMockCtx("/code hello", 999);
    await handleCode(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  test("/code with no args shows usage", async () => {
    const ctx = makeMockCtx("/code");
    await handleCode(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const msg = ctx.reply.mock.calls[0][0];
    expect(msg).toContain("Usage:");
  });

  test("/code status calls execSync and replies", async () => {
    mockExecSync.mockReturnValueOnce("Running task xyz PID 5555");
    const ctx = makeMockCtx("/code status");
    await handleCode(ctx);
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain("Running task xyz");
  });

  test("/code status handles execSync failure", async () => {
    mockExecSync.mockImplementationOnce(() => { throw new Error("script not found"); });
    const ctx = makeMockCtx("/code status");
    await handleCode(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain("Status check failed");
  });

  test("/code stop with no running task", async () => {
    mockExistsSync.mockReturnValueOnce(false);
    const ctx = makeMockCtx("/code stop");
    await handleCode(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain("No running task");
  });

  test("/code stop with running task sends SIGTERM", async () => {
    mockExistsSync.mockReturnValueOnce(true);
    mockLoadJsonFile.mockReturnValueOnce({ pid: 99999, task_id: "test-task" });
    // Mock process.kill to avoid actually killing anything
    const origKill = process.kill;
    process.kill = mock(() => {}) as any;
    const ctx = makeMockCtx("/code stop");
    await handleCode(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply.mock.calls[0][0]).toContain("SIGTERM");
    expect(ctx.reply.mock.calls[0][0]).toContain("99999");
    process.kill = origKill;
  });

  test("/code <prompt> spawns task and replies", async () => {
    mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
      cb(null, "SPAWNED: task-abc\nPID: 7777", "");
    });
    const ctx = makeMockCtx("/code fix the bug");
    await handleCode(ctx);
    // The mock exec callback fires synchronously, so both replies happen
    await new Promise((r) => setTimeout(r, 50));
    // First reply is the "starting" message, second is spawn result
    const startMsg = ctx.reply.mock.calls.find((c: any) => c[0].includes("Claude Code starting"));
    const resultMsg = ctx.reply.mock.calls.find((c: any) => c[0].includes("task-abc"));
    expect(startMsg).toBeTruthy();
    expect(resultMsg).toBeTruthy();
    expect(resultMsg[0]).toContain("7777");
  });

  test("/code <prompt> handles spawn error", async () => {
    mockExec.mockImplementationOnce((_cmd: string, _opts: any, cb: Function) => {
      cb(new Error("spawn fail"), "", "");
    });
    const ctx = makeMockCtx("/code do something");
    await handleCode(ctx);
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.reply).toHaveBeenCalledTimes(2);
    expect(ctx.reply.mock.calls[1][0]).toContain("spawn fail");
  });
});

afterAll(() => {
  existsSyncSpy.mockRestore();
  loadJsonFileSpy.mockRestore();
  mock.restore();
});
