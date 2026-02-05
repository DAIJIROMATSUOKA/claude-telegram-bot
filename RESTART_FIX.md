# Bot Restart Fix - 2026-02-03

## Problem
The `/restart` command was causing the bot to freeze because:
1. The bot was terminating itself before the restart script could run
2. No PID tracking, making it hard for the restart script to find the process
3. No consistent startup notifications
4. No logging of restart operations

## Solution

### 1. External Restart Script (`~/restart-bot.sh`)
- **Runs independently** from the bot process (using `nohup`)
- **Waits 2 seconds** for the bot to finish its shutdown message
- **Tracks PID** using `.bot.pid` file
- **Logs all operations** to `~/claude-telegram-bot/logs/restart.log`
- **Validates startup** by checking if the new process is running after 3 seconds
- **Cleanup handling**: Removes old PID file and kills old process

### 2. Bot Changes

#### config.ts
- Added `PID_FILE` constant: `~/claude-telegram-bot/.bot.pid`

#### index.ts
- **Saves PID on startup** to `.bot.pid` file
- **Always sends startup notification** (not just after restart)
- **Removes PID file** on graceful shutdown (SIGINT/SIGTERM)
- **Improved notification** with more details (timestamp, PID, working dir)

#### commands.ts
- **No changes needed** - already uses `nohup` to launch restart script

### 3. Startup Notification
The bot now ALWAYS sends "🤖 Bot起動完了" on startup with:
- ✅ Ready status
- ⏰ Startup timestamp (JST)
- 🔧 Working directory
- 👤 Number of authorized users
- 🆔 Process ID

## Testing

### Test the restart script manually:
```bash
~/restart-bot.sh
```

Check the log:
```bash
tail -f ~/claude-telegram-bot/logs/restart.log
```

### Test via Telegram:
```
/restart
```

## Files Modified
1. `~/restart-bot.sh` - Complete rewrite with PID tracking and logging
2. `~/claude-telegram-bot/src/config.ts` - Added PID_FILE constant
3. `~/claude-telegram-bot/src/index.ts` - PID tracking + startup notification

## Expected Behavior
1. User sends `/restart`
2. Bot replies "🔄 Restarting bot..."
3. Bot exits (returns control to restart script)
4. Restart script kills old process (if still running)
5. Restart script starts new bot process with nohup
6. New bot sends startup notification within 5-7 seconds
7. Bot is ready for use

## Troubleshooting

### If bot doesn't restart:
```bash
# Check restart log
cat ~/claude-telegram-bot/logs/restart.log

# Check if bot process is running
ps aux | grep "bun run src/index.ts"

# Check PID file
cat ~/claude-telegram-bot/.bot.pid

# Manual restart
cd ~/claude-telegram-bot
bun run src/index.ts
```

### If PID file is stale:
```bash
rm ~/claude-telegram-bot/.bot.pid
```
