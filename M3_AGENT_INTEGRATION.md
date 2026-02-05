# M3 Device Agent Integration - Autopilot Engine v2.2

**Date:** 2026-02-03
**Status:** ✅ Complete
**Phase:** 1.3-1.5 (M3 Device Agent Integration)

## Overview

Autopilot Engine v2.2 now integrates with M3 Device Agent to automatically interact with the M3 MacBook Pro workstation when performing automated tasks. This enables:

1. **Automatic file opening** - Generated files open in default apps on M3
2. **Finder reveal** - Automatically reveal files/folders in Finder
3. **Native notifications** - macOS notifications for task completion/failure

## Architecture

```
M1 (Mothership)                    M3 (Workstation)
┌─────────────────────┐           ┌─────────────────────┐
│ Autopilot Engine    │           │ Device Agent        │
│ v2.2                │           │ (Python HTTP)       │
│                     │           │                     │
│ ┌─────────────────┐ │  HTTP     │ ┌─────────────────┐ │
│ │ M3AgentClient   │─┼──────────>│ │ Flask Server    │ │
│ │                 │ │ Port 18711│ │ Port 18711      │ │
│ │ • open()        │ │           │ │                 │ │
│ │ • reveal()      │ │           │ │ • /open         │ │
│ │ • notify()      │ │           │ │ • /reveal       │ │
│ └─────────────────┘ │           │ │ • /notify       │ │
└─────────────────────┘           │ └─────────────────┘ │
                                  │         │           │
                                  │         ▼           │
                                  │ ┌─────────────────┐ │
                                  │ │ macOS APIs      │ │
                                  │ │ • open          │ │
                                  │ │ • osascript     │ │
                                  │ │ • AppleScript   │ │
                                  │ └─────────────────┘ │
                                  └─────────────────────┘
```

## Implementation

### 1. Bootstrap Script (Phase 1.3)

**File:** `M3_DEVICE_AGENT_BOOTSTRAP.sh`

Run on M3 to install Device Agent:
```bash
bash ~/claude-telegram-bot/M3_DEVICE_AGENT_BOOTSTRAP.sh
```

**What it does:**
- Creates `~/.jarvis/device-agent/` directory
- Generates secure token (base64, 32 bytes)
- Creates Python HTTP server (Flask)
- Sets up LaunchAgent for auto-start
- Outputs `M3_AGENT_URL` and `M3_AGENT_TOKEN`

### 2. M1 Configuration (Phase 1.4)

**File:** `~/claude-telegram-bot/.env`

```bash
# M3 Device Agent (Autopilot Engine v2.2)
M3_AGENT_URL=http://DJs-MacBook-Pro-2171.local:18711
M3_AGENT_TOKEN=hPAw2syL5n-fxG9I8dLHrMCc2PpBkpJNYAtRS7sSCRc
```

### 3. Client Library (Phase 1.5)

**File:** `src/utils/m3-agent-client.ts`

```typescript
import { M3AgentClient } from '../utils/m3-agent-client';

const m3Agent = new M3AgentClient();

// Check if enabled
if (m3Agent.isEnabled()) {
  // Open file in default app
  await m3Agent.open('/path/to/file.txt');

  // Reveal file in Finder
  await m3Agent.reveal('/path/to/file.txt');

  // Send notification (blocking)
  await m3Agent.notify('Task completed', 'Autopilot');

  // Send notification (fire-and-forget)
  m3Agent.notifyAsync('Task completed', 'Autopilot');
}
```

### 4. Engine Integration (Phase 1.5)

**File:** `src/autopilot/engine.ts`

```typescript
// Constructor initializes M3 Agent
this.m3Agent = new M3AgentClient();

// Success notification
if (this.m3Agent.isEnabled()) {
  this.m3Agent.notifyAsync(
    `Autopilot task completed: ${proposal.task.title}`,
    '✅ Autopilot Success'
  );
}

// Failure notification
if (this.m3Agent.isEnabled()) {
  this.m3Agent.notifyAsync(
    `Autopilot task failed: ${proposal.task.title}`,
    '❌ Autopilot Failure'
  );
}
```

## API Endpoints

### POST /open
Open file in default app.

**Request:**
```json
{
  "path": "/absolute/path/to/file.txt"
}
```

**Response:**
```json
{
  "ok": true,
  "opened": "/absolute/path/to/file.txt"
}
```

### POST /reveal
Reveal file/folder in Finder.

**Request:**
```json
{
  "path": "/absolute/path/to/file.txt"
}
```

**Response:**
```json
{
  "ok": true,
  "revealed": "/absolute/path/to/file.txt"
}
```

### POST /notify
Show macOS notification.

**Request:**
```json
{
  "message": "Task completed",
  "title": "Autopilot"
}
```

**Response:**
```json
{
  "ok": true,
  "notified": true
}
```

## Authentication

All endpoints require Bearer token authentication:

```
Authorization: Bearer hPAw2syL5n-fxG9I8dLHrMCc2PpBkpJNYAtRS7sSCRc
```

## Testing

### Manual Test

```bash
cd ~/claude-telegram-bot
bun run test-m3-agent.ts
```

**Expected output:**
```
🧪 M3 Device Agent Integration Test

Configuration:
  M3_AGENT_URL: http://DJs-MacBook-Pro-2171.local:18711
  M3_AGENT_TOKEN: ***RS7sSCRc

✅ M3 Agent enabled

Test 1: Send notification...
✅ Notification test passed

Test 2: Open file...
✅ Open test passed

Test 3: Reveal file in Finder...
✅ Reveal test passed

Test 4: Fire-and-forget notification...
✅ Fire-and-forget notification sent (async)

🎉 All tests completed!
```

### Integration Test

M3 Agent is automatically tested when Autopilot Engine runs. Check logs:

```bash
tail -f ~/claude-telegram-bot/logs/autopilot.log
```

Expected log entries:
```
[autopilot-engine] M3 Device Agent enabled {"url":"http://DJs-MacBook-Pro-2171.local:18711","enabled":true}
[autopilot-engine] Completed task: Evening review check {"duration_ms":1234}
```

## Troubleshooting

### M3 Agent not configured

**Symptom:**
```
[autopilot-engine] M3 Device Agent not configured (M3_AGENT_URL/TOKEN missing)
```

**Solution:**
1. Run bootstrap script on M3: `bash M3_DEVICE_AGENT_BOOTSTRAP.sh`
2. Copy `M3_AGENT_URL` and `M3_AGENT_TOKEN` to M1's `.env`
3. Restart bot: `pm2 restart claude-telegram-bot`

### Connection timeout

**Symptom:**
```
[M3 Agent] Notification failed: Request timeout
```

**Solution:**
1. Check M3 is powered on and awake
2. Verify network connectivity: `ping DJs-MacBook-Pro-2171.local`
3. Check M3 Device Agent is running: `curl http://DJs-MacBook-Pro-2171.local:18711/notify`
4. Check LaunchAgent: `launchctl list | grep jarvis-device-agent`

### Authentication failed

**Symptom:**
```
[M3 Agent] Notification failed: HTTP 401: Unauthorized
```

**Solution:**
1. Verify `M3_AGENT_TOKEN` in M1's `.env` matches M3's `~/.jarvis/device-agent/config.json`
2. Re-run bootstrap script if tokens don't match

## Security

- **Token-based auth**: 256-bit random token (base64 encoded)
- **Local network only**: M3 Agent listens on `0.0.0.0:18711` but only accessible on LAN
- **No encryption**: Uses HTTP (not HTTPS) - acceptable for local network
- **Firewall**: Ensure port 18711 is not exposed to internet

## Performance

- **Timeout**: 5 seconds default (configurable)
- **Fire-and-forget**: `notifyAsync()` for non-blocking notifications
- **Network latency**: ~290ms average (M1 ↔ M3 on local network)

## Future Enhancements (v2.3+)

- [ ] File watching: Auto-detect when files change on M3
- [ ] Bi-directional sync: M3 → M1 file transfers
- [ ] Remote command execution: Run shell commands on M3
- [ ] Multi-device support: M3 + iPhone + iPad agents
- [ ] Encryption: TLS/HTTPS for production environments

## Version History

- **v2.2 (2026-02-03)**: Initial M3 Device Agent integration
  - M3AgentClient utility
  - Engine integration (success/failure notifications)
  - Bootstrap script + LaunchAgent
  - Test suite

## Related Files

- `M3_DEVICE_AGENT_BOOTSTRAP.sh` - Bootstrap script (run on M3)
- `src/utils/m3-agent-client.ts` - Client library
- `src/autopilot/engine.ts` - Engine integration
- `test-m3-agent.ts` - Test suite
- `.env` - Configuration (M3_AGENT_URL, M3_AGENT_TOKEN)

## Next Steps

✅ **Phase 1 Complete** - M3 Device Agent integration working

**Phase 2 (Next)**: Execution Router
- Shadow Mode (proposal-only, no execution)
- Canary Mode (test scope → production scope)
- Kill Switch (emergency disable)

**Phase 3 (Future)**: Context Collector improvements
- Pinned memory support
- Query-based context gathering
- Token budget management
