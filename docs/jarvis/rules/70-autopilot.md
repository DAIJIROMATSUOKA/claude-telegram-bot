# 70-autopilot.md — Autopilot Engine v1 Policy

**Version:** 1.0
**Last Updated:** 2026-02-03
**Priority:** HIGH (Operational policy)

---

## 📋 Overview

Autopilot Engine v1 enables Jarvis to **proactively propose and execute tasks** based on pattern recognition, deadlines, and context.

**Pipeline:** Trigger → Context → Plan → Review → Propose → Execute → Learn

**Philosophy:**
- **Human-in-the-loop**: Always require approval for high-impact tasks
- **Confidence-based**: Auto-approve only low-risk, high-confidence tasks
- **Deduplication**: Never execute the same task twice within a time window
- **Learning**: Log all executions to Memory Gateway for future pattern recognition

---

## 🔧 Architecture

### Core Components

1. **Autopilot Engine** (`src/autopilot/engine.ts`)
   - 7-phase pipeline orchestrator
   - Plugin registry
   - Approval workflow

2. **Context Manager** (`src/autopilot/context-manager.ts`)
   - Memory snapshot loading (always)
   - Memory query execution (when needed)
   - Memory append for logging

3. **Action Ledger** (`src/utils/action-ledger.ts`)
   - In-memory deduplication
   - Time-window based keys
   - Auto-cleanup of expired entries

4. **Approval UX** (`src/autopilot/approval-ux.ts`)
   - Telegram inline keyboard
   - Callback handling
   - Timeout management (5 min)

5. **Plugins** (`src/autopilot/plugins/`)
   - Predictive Task Generator
   - Stalled Task Recomposer
   - Reverse Scheduler

---

## 🔌 Plugin System

### Plugin Interface

```typescript
interface AutopilotPlugin {
  name: string;
  version: string;
  description: string;
  detectTriggers(): Promise<AutopilotTask[]>;
  executeTask?(task: AutopilotTask): Promise<void>;
}
```

### Big 3 Plugins

#### 1. Predictive Task Generator
**Purpose:** Detect time-based patterns and suggest tasks

**Patterns detected:**
- Evening review (19:00-21:00 if not done today)
- Weekly review (Sunday)
- Daily planning (7:00-9:00 if not done today)

**Confidence:** 0.8 - 0.9
**Impact:** low - medium

#### 2. Stalled Task Recomposer
**Purpose:** Detect tasks stuck for 2+ days and suggest breakdown

**Detection logic:**
- Query tasks with `type: "task"` updated > 2 days ago
- Check if content contains "pending" / "todo" / "待機中"
- Calculate confidence based on stalled duration

**Confidence:** 0.7 - 0.95 (higher for longer stalls)
**Impact:** medium

#### 3. Reverse Scheduler
**Purpose:** Work backwards from deadlines to suggest start times

**Detection logic:**
- Find events with deadlines in next 7 days
- Estimate prep time based on event type
- Calculate "start by" time
- Trigger when current time >= "start by"

**Confidence:** 0.9
**Impact:** low - high (based on hours until deadline)

---

## 🚀 Pipeline Phases

### Phase 1: Trigger
**Goal:** Collect triggers from all registered plugins

**Process:**
1. Call `plugin.detectTriggers()` for each plugin
2. Aggregate all triggers
3. Return empty array if no triggers

### Phase 2: Context
**Goal:** Load memory snapshot + optional query

**Strategy:**
- **Always:** Load snapshot (scope: `shared/global`)
- **When needed:** Run query with filters
- **Task history:** Load recent autopilot executions

### Phase 3: Plan
**Goal:** Convert triggers into actionable proposals

**Process:**
1. Check action ledger for duplicates (skip if found)
2. Generate action plan
3. Estimate duration
4. Identify risks
5. Determine if approval required:
   - `confidence < 0.8` → approval required
   - `impact !== 'low'` → approval required

### Phase 4: Review
**Goal:** Filter proposals by confidence & impact

**Rules:**
- Filter out: `confidence < 0.5 && impact === 'low'`
- Force approval: `impact === 'high'`

### Phase 5: Propose
**Goal:** Get user approval for high-risk tasks

**Auto-approve conditions:**
- `approval_required === false`
- `confidence >= 0.8`
- `impact === 'low'`

**Approval flow:**
1. Send Telegram message with inline keyboard
2. Wait for callback (5 min timeout)
3. Handle approve/reject/timeout

### Phase 6: Execute
**Goal:** Execute approved tasks

**Process:**
1. Update task status to `executing`
2. Record in action ledger (prevent duplicates)
3. Call `plugin.executeTask(task)`
4. Update task status to `completed` or `failed`
5. Send error notification on failure

### Phase 7: Learn
**Goal:** Log execution results to Memory Gateway

**Log to:**
- Scope: `shared/autopilot_log`
- Type: `execution_log`
- Content: Execution summary (completed/failed/rejected counts)
- Importance: 7
- Tags: `['autopilot', 'execution']`

---

## 🔐 Safety Rules

### 1. Deduplication (Action Ledger)

**Dedupe key format:**
```
autopilot:{task.type}:{task.title}
```

**TTL:** 24 hours (default)

**Time-window keys (for recurring tasks):**
```
autopilot:{action}:daily:{YYYY-MM-DD}
autopilot:{action}:weekly:{YYYY-WXX}
autopilot:{action}:hourly:{YYYY-MM-DD-HH}
```

### 2. Approval Requirements

**Always require approval if:**
- `confidence < 0.8`
- `impact === 'high'`
- `impact === 'medium'` (optional, configurable)

**Auto-approve only if:**
- `confidence >= 0.8`
- `impact === 'low'`
- `approval_required === false`

### 3. Timeout Handling

**Approval timeout:** 5 minutes
**Action:** Auto-reject + update message

### 4. Error Handling

**On plugin error:**
- Log error
- Continue with other plugins
- Don't crash entire pipeline

**On execution error:**
- Mark task as `failed`
- Send notification to user
- Log to Memory Gateway

---

## 📊 Confidence & Impact Calculation

### Confidence Score (0.0 - 1.0)

**High confidence (0.8+):**
- Time-based patterns (evening review, weekly review)
- Deadline-driven tasks (reverse scheduler)

**Medium confidence (0.6-0.8):**
- Pattern-based predictions
- Stalled tasks (2-4 days)

**Low confidence (<0.6):**
- New patterns
- Stalled tasks (<2 days)

### Impact Level

**Low:**
- Reminder tasks
- Daily planning
- Evening review

**Medium:**
- Task recomposition
- Weekly review
- Preparation for meetings

**High:**
- Deadline-critical tasks (< 24h)
- High-priority events
- System changes

---

## 🔄 Integration with Existing Systems

### Memory Gateway v1.1

**Used for:**
- Context loading (`/v1/memory/snapshot`)
- Task history query (`/v1/memory/query`)
- Execution logging (`/v1/memory/append`)

**Scopes:**
- `shared/global`: Main context
- `shared/autopilot_log`: Execution logs
- `shared/tasks`: Task tracking

### auto-rules.ts

**Future integration (Phase 4):**
- Detect autopilot triggers from user messages
- Route to autopilot engine based on keywords
- Confidence-based routing

### AI Council

**Future integration (Phase 4):**
- Consult council for low-confidence tasks
- Review autopilot proposals before approval
- Learn from council feedback

---

## 📅 Execution Schedule

### Cron Triggers (Future - Phase 5)

**03:00 JST (Daily):**
- Predictive task generation
- Stalled task detection
- Reverse scheduling

**20:00 JST (Evening):**
- Evening review check
- Next-day planning

**Manual Triggers:**
- User command: `/autopilot`
- Auto-rules detection
- API endpoint (future)

---

## 📝 Example Workflow

### Example 1: Evening Review

**19:30 JST - Trigger:**
- Predictive Task Generator detects no review done today
- Creates trigger: "Evening review check"
- Confidence: 0.85, Impact: low

**19:30 - Context:**
- Load snapshot from `shared/global`
- Load task history from `shared/autopilot_log`

**19:30 - Plan:**
- Check action ledger: not executed today ✅
- Generate proposal with action plan
- Approval required: false (high confidence, low impact)

**19:30 - Review:**
- Passes review (confidence 0.85 >= 0.5)

**19:30 - Propose:**
- Auto-approved (no user interaction needed)

**19:30 - Execute:**
- Send reminder to user
- Log to Memory Gateway

**19:31 - Learn:**
- Log execution summary
- Update action ledger

### Example 2: Stalled Task

**10:00 JST - Trigger:**
- Stalled Task Recomposer finds task pending 3 days
- Creates trigger: "Recompose stalled task: Implement feature X"
- Confidence: 0.85, Impact: medium

**10:00 - Context:**
- Load snapshot + query for stalled task details

**10:00 - Plan:**
- Check action ledger: not processed ✅
- Generate breakdown suggestions
- Approval required: true (medium impact)

**10:00 - Review:**
- Passes review

**10:00 - Propose:**
- Send Telegram message with inline keyboard
- User clicks "✅ Approve"

**10:01 - Execute:**
- Generate breakdown suggestions
- Send to user
- Log to Memory Gateway

**10:01 - Learn:**
- Log execution summary

---

## 🎯 Success Metrics

**Target KPIs (Phase 3):**
- Auto-approval rate: 60-80% (low-risk tasks)
- User approval rate: 80%+ (when prompted)
- Duplicate execution rate: 0%
- Execution success rate: 95%+

**Tracking:**
- All metrics logged to `shared/autopilot_log`
- Weekly aggregation (Phase 4)
- Learning log analysis (Phase 4)

---

## 🚧 Implementation Status

- [x] Autopilot Engine skeleton (engine.ts)
- [x] Context Manager (context-manager.ts)
- [x] Action Ledger (action-ledger.ts)
- [x] Approval UX (approval-ux.ts)
- [x] Big 3 Plugins:
  - [x] Predictive Task Generator
  - [x] Stalled Task Recomposer
  - [x] Reverse Scheduler
- [x] Documentation (70-autopilot.md)
- [ ] Integration with main bot (Phase 3.5)
- [ ] Callback handler registration (Phase 3.5)
- [ ] Cron triggers (Phase 5)
- [ ] AI Council integration (Phase 4)
- [ ] Confidence router (Phase 4)
- [ ] Learning log analysis (Phase 4)

---

## 🔮 Future Enhancements (Phase 4+)

### Phase 4: Enhanced Intelligence
- Confidence router with AI Council
- Learning log analysis
- Pattern recognition improvements
- Context enhancement (semantic search)

### Phase 5: Automation
- Cron triggers (03:00, 20:00)
- Auto-recovery system
- Health monitoring
- Performance analytics

### Phase 6: Advanced Plugins
- Meeting preparation plugin
- Email response plugin
- Weekly report generator
- Task prioritization plugin

---

**Next Steps:**
1. Integrate with main bot handler
2. Register callback handlers for approval UX
3. Test with predictive-task-generator plugin
4. Monitor execution logs
5. Iterate based on user feedback
