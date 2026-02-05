# GitHub Secrets Setup Guide

This document explains how to configure GitHub repository secrets for CI/CD integration.

---

## Required Secrets

The following secrets must be set in your GitHub repository settings:

### 1. MEMORY_GATEWAY_URL
- **Value:** `https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev`
- **Purpose:** URL for Memory Gateway API (used by Golden Tests and Coverage Calculator)
- **Used by:** All CI/CD jobs

### 2. TELEGRAM_BOT_TOKEN
- **Value:** Your Telegram bot token (from @BotFather)
- **Purpose:** Send CI/CD notifications to Telegram
- **Used by:** Notification jobs (test failures, coverage drops, flaky tests)

### 3. TELEGRAM_CHAT_ID
- **Value:** Your Telegram chat ID (numeric)
- **Purpose:** Target chat for CI/CD notifications
- **Used by:** Notification jobs

---

## Setup Instructions

### Step 1: Navigate to Repository Settings

1. Go to your GitHub repository
2. Click **Settings** tab
3. In the left sidebar, click **Secrets and variables** → **Actions**

### Step 2: Add Secrets

For each secret listed above:

1. Click **New repository secret**
2. Enter the **Name** (e.g., `MEMORY_GATEWAY_URL`)
3. Enter the **Value**
4. Click **Add secret**

### Step 3: Verify Secrets

After adding all three secrets, you should see:

```
MEMORY_GATEWAY_URL    ********
TELEGRAM_BOT_TOKEN    ********
TELEGRAM_CHAT_ID      ********
```

---

## How to Find Your Telegram Chat ID

### Method 1: Using @userinfobot

1. Open Telegram
2. Search for **@userinfobot**
3. Start a conversation
4. Bot will reply with your Chat ID

### Method 2: Using Telegram Bot API

1. Send a message to your bot
2. Open in browser:
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
3. Look for `"chat":{"id":<YOUR_CHAT_ID>}`

---

## Testing Secrets Configuration

### Option 1: Manual Workflow Trigger

1. Go to **Actions** tab in GitHub
2. Select **Golden Tests CI** workflow
3. Click **Run workflow**
4. Choose branch and click **Run workflow**

If secrets are configured correctly, the workflow will run successfully.

### Option 2: Check Workflow Logs

After a workflow runs:

1. Click on the workflow run
2. Expand the job logs
3. Look for:
   - ✅ Memory Gateway connection successful
   - ✅ Telegram notification sent (if tests failed)

---

## Troubleshooting

### Error: "MEMORY_GATEWAY_URL is not set"

**Solution:** Add `MEMORY_GATEWAY_URL` secret to repository settings.

### Error: "Telegram notification failed"

**Possible causes:**
1. `TELEGRAM_BOT_TOKEN` is incorrect
2. `TELEGRAM_CHAT_ID` is incorrect
3. Bot doesn't have permission to send messages to the chat

**Solution:**
1. Verify bot token with @BotFather
2. Verify chat ID using @userinfobot
3. Ensure you've started a conversation with the bot

### Error: "Memory Gateway connection failed"

**Possible causes:**
1. Memory Gateway URL is incorrect
2. Memory Gateway is down
3. Network issue in GitHub Actions runner

**Solution:**
1. Verify Memory Gateway URL is correct
2. Test Gateway manually: `curl https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev/v1/memory/query?limit=1`

---

## Security Best Practices

1. **Never commit secrets to the repository**
   - Secrets should only be stored in GitHub Settings
   - Add `.env` to `.gitignore` (already done)

2. **Rotate secrets regularly**
   - Change Telegram bot token periodically
   - Update secrets in GitHub Settings when changed

3. **Limit secret access**
   - Only repository admins can view/modify secrets
   - Secrets are not visible in workflow logs

4. **Use secret scanning**
   - GitHub automatically scans for leaked secrets
   - If a secret is detected in a commit, rotate it immediately

---

## Current Configuration Status

**Repository:** `matsuoka/claude-telegram-bot`

**Secrets Status:**
- [ ] MEMORY_GATEWAY_URL - *Pending setup*
- [ ] TELEGRAM_BOT_TOKEN - *Pending setup*
- [ ] TELEGRAM_CHAT_ID - *Pending setup*

**Next Steps:**
1. Add all three secrets to repository settings
2. Trigger a test workflow run
3. Verify notifications are received

---

**Last Updated:** 2026-02-04
