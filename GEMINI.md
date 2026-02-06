# GEMINI.md - Jarvis Project Context

## Project Overview
Telegram Bot AI assistant "Jarvis" for DJ's workflow automation and task management.

## Tech Stack
- Runtime: Bun (TypeScript)
- Bot: Telegram Bot API (Grammy)
- AI: Claude CLI / Gemini CLI / ChatGPT Shortcuts (NO metered billing APIs)
- DB: Cloudflare D1 (via Memory Gateway)
- Process Management: launchd
- Machine: M1 MacBook

## CRITICAL RULES
1. **NO metered billing API** - Never use ANTHROPIC_API_KEY or OPENAI_API_KEY directly
2. **Always run tests** before committing: `bun test`
3. **Git workflow**: Check `git diff` before commit, use descriptive commit messages
4. **Working directory**: `~/claude-telegram-bot`

## Directory Structure
```
src/
  handlers/       - Command & message handlers
    text.ts       - Main text message handler
    streaming.ts  - Message sending & context injection
    commands.ts   - Bot command handlers
    council.ts    - 3AI Council debate (/debate /gpt /gem)
    ai-session.ts - AI Session Bridge (/ai)
  utils/
    multi-ai.ts        - 3AI CLI wrappers
    session-bridge.ts  - AI session management
    jarvis-context.ts  - Context management & Smart Router
    context-detector.ts - Work mode detection
    tool-preloader.ts  - Tool pre-loading
    croppy-approval.ts - Croppy auto-approval
    croppy-context.ts  - Croppy context sharing
  session.ts      - Session management
  index.ts        - Bot entry point
  config.ts       - Configuration
  security.ts     - Auth utilities
scripts/          - Operational scripts
```

## Key Commands
- `bun run src/index.ts` - Start bot
- `bun test` - Run all tests
- `pkill -f "bun run src/index.ts"` - Stop bot (launchd restarts it)

## When Editing Files
- Read the file first to understand context
- Make minimal, targeted changes
- Run `bun test` after changes
- If tests fail, fix them before moving on

## Language
- Code: English
- Comments: English or Japanese OK
- Commit messages: English
- Communication with DJ: Japanese
