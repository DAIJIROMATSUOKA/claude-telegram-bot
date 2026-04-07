/**
 * Bot uptime tracking.
 */

const startTime = new Date();

/**
 * Returns the time the bot process started.
 */
function getStartTime(): Date {
  return startTime;
}

/**
 * Returns a human-readable uptime string (e.g. "2d 5h 13m 7s").
 */
export function getUptime(): string {
  const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);

  const days = Math.floor(elapsed / 86400);
  const hours = Math.floor((elapsed % 86400) / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}
