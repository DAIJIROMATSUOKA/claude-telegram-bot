# JARVIS Architecture

**Updated:** 2026-04-05
**Source:** Expanded from codebase-audit-2026-04-04.md

---

## 1. System Overview

```mermaid
graph TD
    DJ[📱 DJ iPhone/Mac]
    TG[Telegram API]
    BOT[JARVIS Bot<br>src/index.ts]

    DJ -->|Telegram message| TG
    TG -->|webhook/polling| BOT

    BOT -->|AI queries| CLAUDE[Claude CLI<br>claude -p]
    BOT -->|AI queries| GPT[ChatGPT<br>Shortcuts CLI]
    BOT -->|AI queries| GEM[Gemini CLI]

    BOT -->|HTTP| GW[Memory Gateway<br>Cloudflare Worker]
    GW -->|D1 SQL| D1[(Cloudflare D1<br>Database)]

    BOT -->|write| OBS[Obsidian<br>iCloud Vault]
    BOT -->|write| DBX[Dropbox<br>JARVIS-Journal/]

    BOT -->|send| LINE[LINE API]
    BOT -->|send| GMAIL[Gmail API]
    BOT -->|spawn| CC[Claude Code<br>claude-code-spawn.sh]

    CC -->|result| BOT
    BOT -->|notify| TG

    subgraph M1_Mac [M1 Mac (mothership)]
        BOT
        CLAUDE
        GPT
        GEM
        POLL[Task Poller<br>com.jarvis.task-poller]
        NIGHT[Nightly Agent<br>nightly-agent.ts]
        LSCHED[LINE Schedule<br>line-schedule-poller.ts]
        CHROME[Chrome Browser<br>claude.ai tabs]
    end

    subgraph Cloudflare [Cloudflare Edge]
        GW
        D1
    end

    subgraph External [External Services]
        LINE
        GMAIL
        OBS
        DBX
        NOTION[Notion API]
    end

    POLL -->|exec bridge| CC
    NIGHT -->|claude -p| CLAUDE
```

---

## 2. Message Flow

```mermaid
sequenceDiagram
    participant DJ as 📱 DJ
    participant TG as Telegram
    participant IDX as index.ts
    participant SEC as security.ts
    participant ENR as enrichment.ts
    participant AIR as ai-router.ts
    participant SES as session.ts
    participant STR as streaming.ts
    participant PP as post-process.ts
    participant D1 as D1 (via gateway)

    DJ->>TG: Send message
    TG->>IDX: Update event
    IDX->>SEC: isAuthorized + rateLimiter
    SEC-->>IDX: pass / reject
    IDX->>ENR: Enrich message
    ENR->>ENR: X summary, web search,<br>Croppy context, tool preload
    ENR-->>IDX: Enriched message
    IDX->>AIR: Route to AI
    AIR->>SES: jarvis: → Claude Agent SDK
    SES->>STR: Streaming response chunks
    STR->>TG: Incremental updates
    SES->>D1: Audit log
    SES->>PP: Post-process
    PP->>D1: learned_memory, session_summary
    TG-->>DJ: Final response
```

---

## 3. Handler Architecture

```mermaid
graph LR
    IDX[index.ts] -->|commands| CMD[commands.ts<br>/start /new /stop /status...]
    IDX -->|text messages| TXT[text.ts<br>pipeline]
    IDX -->|photos/files| FILE[file-message.ts]
    IDX -->|documents| DOC[document.ts]
    IDX -->|voice| VC[voice-chat.ts]
    IDX -->|callbacks| CB[callback.ts]

    TXT -->|auth| SEC[security.ts]
    TXT -->|enrich| ENR[pipeline/enrichment.ts]
    TXT -->|route| AIR[ai-router.ts]

    AIR -->|jarvis default| SES[session.ts]
    AIR -->|gpt:| GPT[council.ts/GPT]
    AIR -->|gemini:| GEM[council.ts/Gemini]
    AIR -->|croppy:| CRP[croppy-bridge.ts]
    AIR -->|council:| DEB[council.ts/Debate]
    AIR -->|chrome:| ORC[orchestrator-chrome.ts]

    CMD -->|/code| CODE[code-command.ts]
    CMD -->|/task| TASK[task/orchestrate.ts]
    CMD -->|/find| FIND[find-command.ts]
    CMD -->|/recap| RECAP[recap-command.ts]
    CMD -->|/alias| ALIAS[alias-command.ts]
    CMD -->|/batch| BATCH[batch-command.ts]
    CMD -->|/scout| SCOUT[scout-command.ts]
    CMD -->|/audit| AUDIT[audit-command.ts]
    CMD -->|/morning| MORN[morning-command.ts]
    CMD -->|/cal| CAL[cal-command.ts]
    CMD -->|/expense| EXP[expense-command.ts]
    CMD -->|/note| NOTE[note-command.ts]
    CMD -->|/meeting| MEET[meeting-command.ts]
```

---

## 4. Data Flow (D1 Tables)

```mermaid
erDiagram
    message_mappings {
        int id PK
        int telegram_msg_id
        int telegram_chat_id
        text source
        text source_id
        text source_detail
        text snoozed_until
        text created_at
    }
    triage_items {
        int id PK
        text subject
        text body
        text action
        text sender
        text created_at
    }
    tasks {
        int id PK
        text title
        text description
        text status
        text created_at
        text updated_at
    }
    nightly_tasks {
        int id PK
        text prompt
        text cwd
        text model
        text status
        text created_at
        text started_at
        text done_at
        text result
    }
    aliases {
        text name PK
        text command
        text created_at
    }
    jarvis_chat_history {
        int id PK
        text role
        text content
        text session_id
        text created_at
    }
    jarvis_ai_memory {
        int id PK
        text key
        text value
        text embedding
        text created_at
    }
    snooze_queue {
        int id PK
        int mapping_id FK
        text original_content
        text snooze_until
    }
    inbox_actions {
        int id PK
        text source
        text sender_email
        text action
        int response_seconds
        text created_at
    }
    system_events {
        int id PK
        text event_type
        text data
        text created_at
    }

    message_mappings ||--o{ snooze_queue : "has snooze"
    triage_items ||--o{ inbox_actions : "triggers action"
```

---

## 5. External Services Map

```mermaid
graph LR
    BOT[JARVIS Bot]

    subgraph Messaging
        TG[Telegram Bot API]
        LINE_API[LINE Messaging API]
        IMSG[iMessage via AppleScript]
        GMAIL_API[Gmail API]
    end

    subgraph AI_Services [AI Services - CLI only]
        CC_CLI[Claude CLI<br>claude -p]
        GPT_CLI[ChatGPT Shortcuts]
        GEM_CLI[Gemini CLI]
        CC_WEB[claude.ai Browser<br>Chrome MCP]
    end

    subgraph Storage
        D1_DB[Cloudflare D1<br>via Memory Gateway]
        OBS_VAULT[Obsidian iCloud]
        DBX_VAULT[Dropbox JARVIS-Journal]
        NOTION_DB[Notion API]
    end

    subgraph Infra
        LAUNCHD[macOS launchd<br>LaunchAgents]
        MCP_SRV[MCP Servers<br>filesystem/memory/chrome]
        DOCKER[Docker<br>task sandbox]
    end

    BOT -->|messages| TG
    BOT -->|post| LINE_API
    BOT -->|send| IMSG
    BOT -->|draft/send| GMAIL_API

    BOT -->|query| CC_CLI
    BOT -->|query| GPT_CLI
    BOT -->|query| GEM_CLI
    BOT -->|inject| CC_WEB

    BOT -->|store/retrieve| D1_DB
    BOT -->|write notes| OBS_VAULT
    BOT -->|write journal| DBX_VAULT
    BOT -->|write pages| NOTION_DB

    LAUNCHD -->|start/restart| BOT
    BOT -->|tools| MCP_SRV
    BOT -->|run tasks| DOCKER
```

---

## 6. Autonomous Execution Pipeline

```mermaid
graph TD
    DJ[📱 DJ] -->|/code prompt| CODE[code-command.ts]
    DJ -->|/batch prompt| BATCH[batch-command.ts]
    DJ -->|exec bridge| GW[Memory Gateway]

    CODE -->|nohup claude -p| CC_PROC[Claude Code Process]
    BATCH -->|D1 nightly_tasks| SCHED[nightly-batch-scheduler.sh]
    GW -->|task queue| POLL[Task Poller<br>task-poller.ts]

    CC_PROC -->|Stop hook| NOTIFY[session-end-notify.sh]
    SCHED -->|spawns| CC_PROC
    POLL -->|exec bridge| CC_PROC

    NOTIFY -->|Telegram push| DJ
    CC_PROC -->|result| GW
    GW -->|stored| D1[(D1)]

    subgraph Nightly [Nightly at 23:00 JST]
        NIGHT_RUNNER[nightly-runner.sh]
        NIGHT_MAINT[nightly-maintenance.sh]
        NIGHT_SCHED[nightly-batch-scheduler.sh]
        MORNING[morning-briefing.sh]
    end

    NIGHT_RUNNER --> NIGHT_MAINT
    NIGHT_MAINT --> NIGHT_SCHED
```
