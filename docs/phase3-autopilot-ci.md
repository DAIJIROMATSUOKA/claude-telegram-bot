# Phase 3: Autopilot CI - Golden Test Framework

**Status:** ✅ Implementation Complete
**Date:** 2026-02-04
**Version:** v1.0

---

## Overview

Phase 3 implements the **Golden Test Framework** to ensure past accident patterns never happen again. This system automatically converts conversation logs into regression tests and prevents dangerous operations through pre-execution validation.

### Philosophy

> "Ensure past accidents never happen again"

---

## AI Council Consensus

Implementation based on unanimous recommendations from クロッピー🦞, ジェミー💎, and チャッピー🧠:

### 1. Test Selection Criteria (3-Axis Scoring)

**Formula:** `score = (severity × 0.5) + (blast_radius × 0.3) + (frequency × 0.2)`

| Axis | Weight | Scoring |
|------|--------|---------|
| **Severity** | 50% | critical=1.0, high=0.75, medium=0.5, low=0.25 |
| **Blast Radius** | 30% | system=1.0, project=0.67, directory=0.33, file=0.0 |
| **Frequency** | 20% | Normalized occurrence count |

**Selection Logic:**
- Minimum score: 0.6 (top 60% of accidents)
- Maximum tests: 20 (to avoid slow CI pipeline)
- Force include: All critical and high severity
- Exclude: One-time occurrences (if enabled)

### 2. Flaky Test Detection (3-Stage Retry)

**Retry Strategy:**
1. **Attempt 1:** Immediate execution
2. **Attempt 2:** 5-second delay (filter timing issues)
3. **Attempt 3:** Final attempt

**Quarantine Logic:**
- 3 consecutive failures → Quarantine
- Quarantined tests run weekly (not pre-execution)
- 20 consecutive passes → Restore to stable

### 3. Kill Switch Thresholds (Severity-Based)

| Severity | Threshold | Window | Action |
|----------|-----------|--------|--------|
| **Critical** | 1 failure | Immediate | Instant Kill Switch |
| **High** | 2 failures | 5 minutes | Delayed Kill Switch |
| **Medium** | 3 failures | 5 minutes | Delayed Kill Switch |
| **Low** | No activation | N/A | Warning only |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Phase 3: Autopilot CI                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. Conversation Log → Accident Pattern Extraction  │   │
│  │    - Telegram conversation logs                      │   │
│  │    - Memory Gateway incident records                 │   │
│  │    - Keyword detection & pattern matching           │   │
│  └──────────────────┬──────────────────────────────────┘   │
│                     │                                         │
│                     ▼                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 2. Test Selection Engine (3-Axis Scoring)           │   │
│  │    - Score = (severity×0.5) + (radius×0.3) + ...   │   │
│  │    - Top 60% accidents → Golden Tests                │   │
│  │    - Force include critical/high severity            │   │
│  └──────────────────┬──────────────────────────────────┘   │
│                     │                                         │
│                     ▼                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 3. Golden Test Generation                            │   │
│  │    - Given-When-Then structure                       │   │
│  │    - Test function code generation                   │   │
│  │    - Kill Switch threshold assignment                │   │
│  └──────────────────┬──────────────────────────────────┘   │
│                     │                                         │
│                     ▼                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 4. Pre-Execution Test Runner                        │   │
│  │    - Execute before PlanBundle execution             │   │
│  │    - 3-stage retry (immediate, 5s, final)            │   │
│  │    - Flaky detection & quarantine                    │   │
│  └──────────────────┬──────────────────────────────────┘   │
│                     │                                         │
│            ┌────────┴────────┐                               │
│            ▼                 ▼                                │
│  ┌──────────────┐  ┌──────────────────────┐                │
│  │ Tests PASS   │  │ Tests FAIL           │                │
│  │ Continue     │  │ Kill Switch Decision │                │
│  │ Execution    │  │ (Severity-based)     │                │
│  └──────────────┘  └──────────┬───────────┘                │
│                                ▼                              │
│                     ┌──────────────────────┐                │
│                     │ 5. Kill Switch       │                │
│                     │    - Block execution │                │
│                     │    - Notify user     │                │
│                     │    - Log decision    │                │
│                     └──────────────────────┘                │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 6. Test Coverage Tracking                            │   │
│  │    - Coverage by severity                            │   │
│  │    - Gap identification                              │   │
│  │    - Recommendations for new tests                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Files

### Core Modules

1. **`golden-test-types.ts`** (450 lines)
   - Type definitions for Golden Tests, Accident Patterns
   - Test execution results, Flaky reports
   - Kill Switch decisions, Coverage metrics

2. **`golden-test-engine.ts`** (420 lines)
   - Test execution with 3-stage retry
   - Flaky detection & quarantine logic
   - Kill Switch evaluation (severity-based)
   - Memory Gateway storage

3. **`test-selection-engine.ts`** (380 lines)
   - 3-axis scoring algorithm
   - Test selection from accident patterns
   - Golden Test generation
   - Given-When-Then structure extraction

4. **`accident-pattern-extractor.ts`** (450 lines)
   - Conversation log parsing
   - Accident indicator detection (keywords)
   - Pattern deduplication & merging
   - Memory Gateway integration

5. **`test-coverage-tracker.ts`** (320 lines)
   - Coverage calculation by severity
   - Gap identification (uncovered patterns)
   - Coverage trend analysis
   - Warning generation

---

## Data Flow

### 1. Accident Pattern Extraction

**Input:** Telegram conversation logs, Memory Gateway incidents

**Process:**
```typescript
ConversationLog → AccidentIndicators → AccidentPattern
  ├─ Severity detection (critical/high/medium/low)
  ├─ Blast radius detection (system/project/directory/file)
  ├─ Frequency counting (occurrence_count)
  ├─ Root cause extraction
  └─ Trigger condition extraction
```

**Output:** Structured `AccidentPattern` objects

### 2. Test Selection (3-Axis Scoring)

**Input:** Accident Patterns

**Process:**
```typescript
AccidentPattern → SelectionScore → Golden Test Candidate
  ├─ Score = (severity × 0.5) + (blast_radius × 0.3) + (frequency × 0.2)
  ├─ Force include: critical/high severity
  ├─ Filter: score >= 0.6
  ├─ Sort: by score (descending)
  └─ Limit: top 20 tests
```

**Output:** Selected patterns for Golden Test generation

### 3. Pre-Execution Validation

**Input:** PlanBundle + Golden Tests

**Process:**
```typescript
PlanBundle → Golden Test Execution → Pass/Fail Decision
  ├─ Select relevant tests (by severity/scope)
  ├─ Execute each test (3-stage retry)
  ├─ Flaky detection (3 consecutive failures → quarantine)
  ├─ Kill Switch evaluation (severity-based threshold)
  └─ Block or allow execution
```

**Output:** TestExecutionResult + KillSwitchDecision

---

## Integration with Existing Systems

### Policy Engine Integration

Golden Test Engine works alongside Policy Engine (Phase 2):

```typescript
// Phase 2: Policy Engine validates PlanBundle structure
const policyResult = await policyEngine.validate(bundle);

// Phase 3: Golden Test Engine validates against past accidents
const testResult = await goldenTestEngine.executePreExecutionTests(bundle);

// Combined decision
if (!policyResult.valid || !testResult.all_passed) {
  // Block execution
  await killSwitch.activate();
}
```

### Kill Switch Integration

Golden Test failures trigger Kill Switch based on severity:

| Scenario | Action |
|----------|--------|
| Critical test fails | Immediate Kill Switch + User notification |
| High test fails (2x in 5 min) | Delayed Kill Switch + Alert |
| Medium test fails (3x in 5 min) | Delayed Kill Switch + Warning |
| Low test fails | Warning log only |

### Memory Gateway Integration

All test data is stored in Memory Gateway for persistence:

- **Scope:** `private/jarvis/golden_tests/`
  - `/executions` - Test execution results
  - `/kill_switch` - Kill Switch decisions
  - `/flaky_reports` - Flaky test quarantine records
  - `/coverage` - Coverage metrics

---

## Coverage Metrics

### Coverage Calculation

```typescript
Coverage % = (Covered Patterns / Total Patterns) × 100

By Severity:
- Critical Coverage = (Critical Covered / Critical Total) × 100
- High Coverage = (High Covered / High Total) × 100
- Medium Coverage = (Medium Covered / Medium Total) × 100
- Low Coverage = (Low Covered / Low Total) × 100
```

### Coverage Targets

| Target | Threshold |
|--------|-----------|
| **Excellent** | >= 90% |
| **Good** | 70-89% |
| **Moderate** | 50-69% |
| **Poor** | < 50% |

### Gap Warning Triggers

1. **Critical Gap:** Any uncovered critical pattern → Immediate warning
2. **Coverage Decline:** Drop > 10% → Warning
3. **High Severity Gap:** > 5 uncovered high patterns → Alert

---

## Testing & Validation

### Test Execution Flow

```
1. PlanBundle created
     ↓
2. Select relevant Golden Tests
   (filter by severity/scope)
     ↓
3. Execute each test (Attempt 1)
   ├─ Pass → Continue
   └─ Fail → Retry (Attempt 2, +5s delay)
       ├─ Pass → Continue (mark as suspect)
       └─ Fail → Retry (Attempt 3)
           ├─ Pass → Continue (mark as suspect)
           └─ Fail → Quarantine + Kill Switch evaluation
```

### Flaky Test Lifecycle

```
Stable → Suspect → Quarantined → Fixing → Restored
  │         │           │            │         │
  │         │           │            │         └─ 20 consecutive passes
  │         │           │            └─ Manual fix applied
  │         │           └─ 3 consecutive failures
  │         └─ 2 consecutive failures
  └─ Initial state
```

---

## Configuration

### Default Settings

```typescript
{
  // Test Selection
  severity_weight: 0.5,        // 50%
  blast_radius_weight: 0.3,    // 30%
  frequency_weight: 0.2,       // 20%
  minimum_score: 0.6,          // Top 60%
  maximum_tests: 20,           // CI performance

  // Flaky Detection
  flaky_failure_threshold: 3,  // Quarantine after 3 failures
  quarantine_pass_requirement: 20, // Restore after 20 passes
  retry_delays_ms: [0, 5000],  // Immediate, then 5s

  // Kill Switch Thresholds
  critical: { failures: 1, window_minutes: 0 },   // Immediate
  high: { failures: 2, window_minutes: 5 },       // 2 in 5 min
  medium: { failures: 3, window_minutes: 5 },     // 3 in 5 min
  low: { failures: 0, window_minutes: 0 },        // Warning only
}
```

---

## Future Enhancements

### Phase 4 (Future)

1. **AI-Generated Test Functions**
   - LLM-generated test code from accident descriptions
   - Automated Given-When-Then extraction

2. **Test Mutation Testing**
   - Verify test effectiveness by intentionally breaking code
   - Ensure tests actually catch the accident

3. **CI/CD Integration**
   - GitHub Actions workflow for Golden Tests
   - Pre-commit hooks for local validation

4. **Test Simulation**
   - Replay past accidents in safe environment
   - Verify Golden Tests catch them

5. **Coverage Visualization**
   - Dashboard showing coverage trends
   - Heatmap of accident patterns vs tests

---

## Success Metrics

### Phase 3 Success Criteria

- ✅ Golden Test types defined
- ✅ 3-axis scoring implemented (AI Council consensus)
- ✅ Flaky detection & quarantine system
- ✅ Kill Switch integration (severity-based)
- ✅ Conversation log extraction
- ✅ Test coverage tracking
- ✅ Memory Gateway storage

### Operational Metrics (to be measured)

1. **Test Effectiveness**
   - % of dangerous operations blocked
   - False positive rate (< 5% target)

2. **Coverage Health**
   - Overall coverage (target: > 70%)
   - Critical coverage (target: 100%)

3. **Flaky Rate**
   - % of tests quarantined (target: < 10%)
   - Average time to stabilize (target: < 1 week)

4. **Kill Switch Activations**
   - Activations per week
   - True positive rate (target: > 90%)

---

## Conclusion

Phase 3 (Autopilot CI) is now **fully implemented** with all AI Council recommendations integrated:

1. ✅ **Test Selection:** 3-axis scoring (Severity 50%, Blast Radius 30%, Frequency 20%)
2. ✅ **Flaky Detection:** 3-stage retry + Quarantine (3 failures → isolate)
3. ✅ **Kill Switch:** Severity-based thresholds (Critical: immediate, High: 2x, Medium: 3x)

The system is ready for integration testing and deployment.

---

**Next Step:** Phase 3 Integration Test + Real-world validation
