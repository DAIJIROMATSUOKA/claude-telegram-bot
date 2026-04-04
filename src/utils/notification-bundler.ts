/**
 * notification-bundler.ts — Buffer and bundle outgoing Telegram notifications
 *
 * If multiple notifications arrive within BUNDLE_WINDOW_MS (3 min), they are
 * merged into a single message with bullet points.
 *
 * Always-immediate (never bundled):
 *   - escalation notifications
 *   - error notifications
 *
 * Apply to: triage archive notifications, auto-approve notifications.
 */

export interface BundleOptions {
  /** Chat ID to send the bundled message to */
  chatId: number;
  /** Notification text */
  text: string;
  /** If true, send immediately without buffering */
  immediate?: boolean;
  /** Tag used to group notifications (default: "default") */
  tag?: string;
}

type SendFn = (chatId: number, text: string) => Promise<void>;

const BUNDLE_WINDOW_MS = 3 * 60 * 1000; // 3 minutes

interface PendingBundle {
  items: string[];
  timer: ReturnType<typeof setTimeout>;
  chatId: number;
  tag: string;
}

const pending = new Map<string, PendingBundle>();

/**
 * Queue a notification for bundling, or send immediately.
 *
 * @param opts   Notification options
 * @param sendFn Function that actually sends the message
 */
export function queueNotification(opts: BundleOptions, sendFn: SendFn): void {
  const { chatId, text, immediate = false, tag = "default" } = opts;
  const key = `${chatId}:${tag}`;

  // Always-immediate: escalation or error keywords
  const isEscalation = /escalat|🚨|緊急|urgent/i.test(text);
  const isError = /❌|error|エラー|failed|失敗/i.test(text);

  if (immediate || isEscalation || isError) {
    sendFn(chatId, text).catch((e) =>
      console.error("[NotificationBundler] immediate send failed:", e)
    );
    return;
  }

  const existing = pending.get(key);
  if (existing) {
    // Add to existing bundle, reset timer
    existing.items.push(text);
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => flush(key, sendFn), BUNDLE_WINDOW_MS);
  } else {
    // Start new bundle
    const timer = setTimeout(() => flush(key, sendFn), BUNDLE_WINDOW_MS);
    pending.set(key, { items: [text], timer, chatId, tag });
  }
}

function flush(key: string, sendFn: SendFn): void {
  const bundle = pending.get(key);
  if (!bundle) return;
  pending.delete(key);

  const { chatId, items, tag } = bundle;

  let combined: string;
  if (items.length === 1) {
    combined = items[0];
  } else {
    const header = `📦 通知まとめ (${items.length}件)${tag !== "default" ? ` [${tag}]` : ""}`;
    const bullets = items.map((t) => `• ${t}`).join("\n");
    combined = `${header}\n\n${bullets}`;
  }

  sendFn(chatId, combined).catch((e) =>
    console.error("[NotificationBundler] flush send failed:", e)
  );
}

/**
 * Force-flush all pending bundles for a chat (e.g. on shutdown).
 */
export function flushAll(sendFn: SendFn): void {
  for (const key of pending.keys()) {
    const bundle = pending.get(key)!;
    clearTimeout(bundle.timer);
    flush(key, sendFn);
  }
}
