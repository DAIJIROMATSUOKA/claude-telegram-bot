import { describe, test, expect, mock, beforeEach, beforeAll, afterEach } from "bun:test";

// Set env vars BEFORE module is imported (in module body, before beforeAll)
process.env.DROPBOX_ACCESS_TOKEN = "test-dropbox-token";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";

// Set up module mocks
mock.module("../../utils/logger", () => ({
  createLogger: () => ({
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
  }),
}));

// Use globalThis.fetch so fetchWithTimeout (which calls fetch internally) is intercepted
const mockFetch = mock(async (..._args: any[]) =>
  new Response(JSON.stringify({ ok: true }), { status: 200 })
);
const originalFetch = globalThis.fetch;

// Dynamically import AFTER env vars and mocks are set up
let uploadAndShare: (fileId: string, filename: string) => Promise<{ url: string; path: string } | null>;

beforeAll(async () => {
  const mod = await import("../dropbox-share");
  uploadAndShare = mod.uploadAndShare;
});

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
  globalThis.fetch = mockFetch as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("uploadAndShare", () => {
  test("returns URL with dl=1 on full upload success", async () => {
    mockFetch
      // 1. Telegram getFile
      .mockImplementationOnce(async () =>
        jsonRes({ ok: true, result: { file_path: "photos/file_123.jpg" } })
      )
      // 2. Download file bytes
      .mockImplementationOnce(async () => new Response(new ArrayBuffer(256), { status: 200 }))
      // 3. Dropbox upload
      .mockImplementationOnce(async () => jsonRes({ path_lower: "/jarvis-share/file.jpg" }))
      // 4. Create shared link
      .mockImplementationOnce(async () =>
        jsonRes({ url: "https://www.dropbox.com/s/abc123/file.jpg?dl=0" })
      );

    const result = await uploadAndShare("tg-file-id-123", "photo.jpg");

    expect(result).not.toBeNull();
    expect(result!.url).toContain("dl=1");
    expect(result!.path).toContain("JARVIS-Share");
  });

  test("returns null when Telegram getFile returns not-ok", async () => {
    mockFetch.mockImplementationOnce(async () =>
      jsonRes({ ok: false, description: "file not found" })
    );

    const result = await uploadAndShare("bad-file-id", "file.jpg");
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("returns null when file download fails with HTTP error", async () => {
    mockFetch
      .mockImplementationOnce(async () =>
        jsonRes({ ok: true, result: { file_path: "photos/f.jpg" } })
      )
      .mockImplementationOnce(async () => new Response("Not Found", { status: 404 }));

    const result = await uploadAndShare("id", "file.jpg");
    expect(result).toBeNull();
  });

  test("uses existing share link when shared_link_already_exists error is returned", async () => {
    const existingUrl = "https://www.dropbox.com/s/existing123/file.jpg?dl=0";
    mockFetch
      .mockImplementationOnce(async () =>
        jsonRes({ ok: true, result: { file_path: "photos/f.jpg" } })
      )
      .mockImplementationOnce(async () => new Response(new ArrayBuffer(256), { status: 200 }))
      .mockImplementationOnce(async () => jsonRes({ path_lower: "/jarvis-share/f.jpg" }))
      .mockImplementationOnce(async () =>
        jsonRes(
          {
            error: {
              shared_link_already_exists: {
                metadata: { url: existingUrl },
              },
            },
          },
          409
        )
      );

    const result = await uploadAndShare("id", "file.jpg");
    expect(result).not.toBeNull();
    expect(result!.url).toBe(existingUrl.replace("dl=0", "dl=1"));
  });

  test("returns null on network error", async () => {
    mockFetch.mockImplementationOnce(async () => {
      throw new Error("ECONNREFUSED");
    });

    const result = await uploadAndShare("id", "file.jpg");
    expect(result).toBeNull();
  });

  test("includes original filename in the Dropbox upload path", async () => {
    mockFetch
      .mockImplementationOnce(async () =>
        jsonRes({ ok: true, result: { file_path: "photos/f.jpg" } })
      )
      .mockImplementationOnce(async () => new Response(new ArrayBuffer(8), { status: 200 }))
      .mockImplementationOnce(async () => jsonRes({ path_lower: "/jarvis-share/f.jpg" }))
      .mockImplementationOnce(async () =>
        jsonRes({ url: "https://www.dropbox.com/s/abc?dl=0" })
      );

    const result = await uploadAndShare("id", "quarterly_report.pdf");

    expect(result).not.toBeNull();
    expect(result!.path).toContain("quarterly_report.pdf");
  });
});
