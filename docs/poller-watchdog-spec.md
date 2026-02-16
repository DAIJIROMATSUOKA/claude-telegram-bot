# Poller Watchdog Spec

## Status: DEPLOYED & VERIFIED (2026-02-16)

## Design Decision (Debate)

### [DECIDED] heartbeat file + LaunchAgent watchdog
- Poller writes /tmp/poller-heartbeat on every poll cycle
- Watchdog (com.jarvis.poller-watchdog) runs every 60s via StartInterval
- Checks heartbeat freshness (MAX_AGE=60s) + process existence (pgrep)
- Auto-restarts via launchctl load + kickstart
- Telegram notification on restart

### [REJECTED] autokick-watchdog integration
- Reason: ARM STate dependency makes it unsuitable for 24/7 monitoring

### [REJECTED] Gateway heartbeat (CF cron)
- Reason: Can only notify, cannot restart M1 process. CF cron increase.

### [REJECTED] CF Queues migration (P4)
- Reason: M1 is outside CF Worker network, polling still needed. ROI insufficient.

### [REJECTED] crontab approach
- Reason: crontab command hangs in exec bridge (TCC permissions)

## Coverage

| Failure Mode | Covered? | Mechanism |
|---|---|---|
| SIGTERM kill | Yes | exit(143) + launchd restart |
| plist unload | Yes | watchdog does launchctl load |
| Process hang | Yes | heartbeat goes stale |
| Gateway unreachable | Yes | heartbeat goes stale |
| Watchdog itself dies | Yes | StartInterval re-launches |

## Files
- src/bin/task-poller.ts: heartbeat write in finally block
- scripts/poller-watchdog.sh: one-shot check script
- ~/Library/LaunchAgents/com.jarvis.poller-watchdog.plist
- Cmmit: 107cb88

## Self-Bootstrap Verified
Watchdog detected old poller (no heartbeat) -> auto-restarted -> new code with heartbeat -> stable.
