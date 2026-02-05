# Phase 4: CI/CD Integration

**Status:** ✅ Implementation Complete
**Date:** 2026-02-04
**Version:** v1.0

---

## Overview

Phase 4 integrates the Golden Test Framework (Phase 3) into CI/CD pipelines, enabling automated testing on every commit and pull request.

### Goals

1. **Automated Golden Test Execution** - Run tests on every push/PR
2. **Pre-commit Validation** - Local testing before commits
3. **Coverage Tracking** - Monitor test coverage trends
4. **Flaky Test Detection** - Identify and quarantine unstable tests
5. **Telegram Notifications** - Alert on failures and coverage drops

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   CI/CD Pipeline                          │
├──────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Local Development                                │    │
│  │  ┌───────────────┐                              │    │
│  │  │ git commit    │                              │    │
│  │  └───────┬───────┘                              │    │
│  │          │                                       │    │
│  │          ▼                                       │    │
│  │  ┌──────────────────────────┐                  │    │
│  │  │ Pre-commit Hook          │                  │    │
│  │  │  - Golden Tests          │                  │    │
│  │  │  - Policy Engine         │                  │    │
│  │  │  - Type Check            │                  │    │
│  │  │  - Coverage Check        │                  │    │
│  │  └──────────┬───────────────┘                  │    │
│  │             │                                    │    │
│  │             ▼                                    │    │
│  │      ✅ Pass → Commit  ❌ Fail → Block         │    │
│  └─────────────────────────────────────────────────┘    │
│                                                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │ GitHub Actions (CI)                              │    │
│  │                                                   │    │
│  │  ┌─────────────────┐                            │    │
│  │  │ Job 1: Golden Tests                          │    │
│  │  │  - Run all Golden Tests                      │    │
│  │  │  - Generate coverage report                  │    │
│  │  │  - Upload artifacts                          │    │
│  │  └────────┬─────────────────┘                   │    │
│  │           │                                       │    │
│  │           ▼                                       │    │
│  │  ┌──────────────────────────┐                   │    │
│  │  │ Job 2: Policy Engine     │                   │    │
│  │  │  - Validate PlanBundles  │                   │    │
│  │  │  - Type check            │                   │    │
│  │  └────────┬─────────────────┘                   │    │
│  │           │                                       │    │
│  │           ▼                                       │    │
│  │  ┌──────────────────────────┐                   │    │
│  │  │ Job 3: Coverage Check    │                   │    │
│  │  │  - Calculate coverage    │                   │    │
│  │  │  - Compare to threshold  │                   │    │
│  │  │  - Post PR comment       │                   │    │
│  │  └────────┬─────────────────┘                   │    │
│  │           │                                       │    │
│  │           ▼                                       │    │
│  │  ┌──────────────────────────┐                   │    │
│  │  │ Job 4: Flaky Detection   │                   │    │
│  │  │  - Run tests 5 times     │                   │    │
│  │  │  - Detect inconsistency  │                   │    │
│  │  │  - Report flaky tests    │                   │    │
│  │  └────────┬─────────────────┘                   │    │
│  │           │                                       │    │
│  │           ▼                                       │    │
│  │  ┌──────────────────────────┐                   │    │
│  │  │ Telegram Notifications   │                   │    │
│  │  │  - Test failures         │                   │    │
│  │  │  - Coverage drops        │                   │    │
│  │  │  - Flaky tests           │                   │    │
│  │  └──────────────────────────┘                   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

---

## Implementation Files

### 1. GitHub Actions Workflow

**File:** `.github/workflows/golden-tests.yml`

**Jobs:**
1. **golden-tests** - Run Golden Tests, generate coverage
2. **policy-engine-check** - Validate Policy Engine
3. **coverage-check** - Calculate and report coverage
4. **flaky-test-detection** - Detect inconsistent tests (main branch only)

**Triggers:**
- `push` to `main` or `develop` branches
- `pull_request` to `main` or `develop` branches
- Manual trigger via `workflow_dispatch`

### 2. Pre-commit Hook

**File:** `.husky/pre-commit`

**Checks (in order):**
1. ✅ Golden Tests execution
2. ✅ Policy Engine validation
3. ✅ TypeScript type checking
4. ⚠️ Coverage warning (non-blocking)

**Behavior:**
- Blocks commit if any check fails
- Provides clear error messages
- Suggests fixes or bypass options

### 3. Test Scripts

**package.json scripts:**
```json
{
  "test:golden": "bun test src/autopilot/**/*.test.ts",
  "test:policy": "bun test src/autopilot/policy-engine.test.ts",
  "test:coverage": "bun run src/autopilot/test-coverage-tracker.ts",
  "coverage:calculate": "bun run src/scripts/calculate-coverage.ts"
}
```

### 4. Coverage Calculator

**File:** `src/scripts/calculate-coverage.ts`

**Features:**
- Loads accident patterns from Memory Gateway
- Calculates coverage by severity
- Outputs percentage to stdout (for CI scripts)
- Logs detailed report to stderr
- Stores metrics in Memory Gateway

### 5. CI Notifications Module

**File:** `src/utils/ci-notifications.ts`

**Notification Types:**
1. **Test Failure** - When Golden Tests fail in CI
2. **Kill Switch Activation** - Emergency stop triggered
3. **Coverage Drop** - Coverage falls below threshold
4. **Flaky Tests** - Inconsistent tests detected
5. **Coverage Success** - Excellent coverage (>= 90%)

---

## Configuration

### GitHub Secrets

Required secrets in repository settings:

```yaml
MEMORY_GATEWAY_URL: https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev
TELEGRAM_BOT_TOKEN: <your-bot-token>
TELEGRAM_CHAT_ID: <your-chat-id>
```

### Environment Variables

**Local Development:**
```bash
export MEMORY_GATEWAY_URL="https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev"
export TELEGRAM_BOT_TOKEN="<your-token>"
export TELEGRAM_CHAT_ID="<your-chat-id>"
```

**CI/CD:**
- Set in GitHub repository secrets
- Automatically injected into workflow environment

---

## Usage

### Local Development

#### Run Golden Tests Manually
```bash
bun run test:golden
```

#### Calculate Coverage
```bash
bun run coverage:calculate
```

#### Type Check
```bash
bun run typecheck
```

#### Install Pre-commit Hook
```bash
# Install husky
bun add --dev husky

# Initialize husky
bunx husky install

# Hook is already created at .husky/pre-commit
```

### CI/CD Pipeline

#### Automatic Execution
- Tests run automatically on every `push` and `pull_request`
- No manual action needed

#### Manual Trigger
1. Go to Actions tab in GitHub
2. Select "Golden Tests CI" workflow
3. Click "Run workflow"
4. Choose branch and click "Run workflow"

#### View Results
- Check "Actions" tab in GitHub repository
- Click on workflow run to see detailed logs
- Download coverage artifacts if needed

---

## Notification Examples

### Test Failure Notification

```
🚨 Golden Tests Failed in CI

Repository: matsuoka/claude-telegram-bot
Branch: feature/golden-tests
Commit: a1b2c3d
Author: Daijiro Matsuoka

Failed Tests: 3/15

• test_file_overwrite_123: File overwrite without backup detected
• test_permission_456: Insufficient permissions for action
• test_data_loss_789: Data loss risk not mitigated

🔗 View CI Run
```

### Kill Switch Activation

```
🚨 Kill Switch Activated!

Severity: CRITICAL
Environment: production
Reason: 1 Golden Test(s) failed with severity critical

Trigger: test_failure
Test ID: test_data_loss_critical
Plan Bundle: plan_abc123

Threshold: immediate (1 failures in 0 minutes)

Action Required:
1. Review the failed test logs
2. Fix the issue that triggered the failure
3. Manually deactivate Kill Switch when safe

Activated At: 2026-02-04 06:15:30
```

### Coverage Drop

```
📉 Test Coverage Dropped

Previous Coverage: 75.2%
Current Coverage: 68.5%
Drop: -6.7%

Threshold: 70%

Coverage by Severity:
• Critical: 5/5 (100%)
• High: 8/10 (80%)
• Medium: 12/20
• Low: 5/15

Action Required:
Review recent changes and ensure Golden Tests are created for new accident patterns.
```

---

## Workflow Behavior

### On Push to Main/Develop

1. **Golden Tests** run first
   - If fail → Block merge, send Telegram notification
   - If pass → Continue to next job

2. **Policy Engine** validation
   - Validates PlanBundle types
   - Type checks entire codebase

3. **Coverage Check**
   - Calculates current coverage
   - Compares to previous (trend analysis)
   - Warns if below 70%

4. **Flaky Detection** (main branch only)
   - Runs tests 5 times
   - Detects inconsistency
   - Reports via Telegram if found

### On Pull Request

1. **All jobs run** (except Flaky Detection)

2. **Coverage Comment** posted automatically
   ```
   ## 📊 Test Coverage Report

   **Overall Coverage:** 72.5%
   **Threshold:** 70%

   ✅ Coverage meets threshold

   [View detailed report](...)
   ```

3. **Status Checks** block merge if failed

---

## Troubleshooting

### Pre-commit Hook Not Running

```bash
# Re-install husky
bunx husky install

# Make hook executable
chmod +x .husky/pre-commit

# Test hook manually
.husky/pre-commit
```

### Tests Pass Locally but Fail in CI

**Common causes:**
1. Environment differences (Memory Gateway URL)
2. Timing-dependent tests (use retries)
3. Missing secrets in repository settings

**Debug:**
```bash
# Run tests with same environment as CI
NODE_ENV=test bun run test:golden

# Check Memory Gateway connectivity
curl $MEMORY_GATEWAY_URL/v1/memory/query?limit=1
```

### Coverage Calculation Fails

**Check:**
1. Memory Gateway is accessible
2. Accident patterns exist in storage
3. Script has execute permissions

**Manual test:**
```bash
bun run src/scripts/calculate-coverage.ts
```

### Telegram Notifications Not Sending

**Verify:**
1. `TELEGRAM_BOT_TOKEN` secret is set
2. `TELEGRAM_CHAT_ID` secret is correct
3. Bot has permission to send messages to chat

**Test locally:**
```bash
export TELEGRAM_BOT_TOKEN="your-token"
export TELEGRAM_CHAT_ID="your-chat-id"

curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_CHAT_ID" \
  -d "text=Test message"
```

---

## Best Practices

### 1. Keep Tests Fast
- Golden Tests should complete in < 30 seconds total
- If tests are slow, consider parallelization
- Use mocks for external dependencies

### 2. Handle Flaky Tests Immediately
- Don't ignore flaky test warnings
- Fix timing issues promptly
- Use deterministic test data

### 3. Maintain High Coverage
- Target: >= 70% overall, 100% critical severity
- Create Golden Tests for every new accident pattern
- Review coverage trends weekly

### 4. Monitor Notifications
- Don't ignore Telegram alerts
- Set up escalation for critical failures
- Review CI logs regularly

### 5. Update Tests Regularly
- When accidents occur, create Golden Tests immediately
- Remove obsolete tests (document why)
- Refactor tests to improve stability

---

## Success Metrics

### Phase 4 Success Criteria

- ✅ GitHub Actions workflow created
- ✅ Pre-commit hook implemented
- ✅ Test scripts added to package.json
- ✅ Coverage calculator working
- ✅ Telegram notifications functional

### Operational Metrics (to be measured)

1. **CI Pass Rate**
   - Target: > 95% first-time pass
   - Measure: Successful runs / Total runs

2. **Flaky Test Rate**
   - Target: < 5% of tests quarantined
   - Measure: Quarantined tests / Total tests

3. **Notification Response Time**
   - Target: < 5 minutes from failure to notification
   - Measure: Timestamp difference

4. **Coverage Stability**
   - Target: No drops > 5% between releases
   - Measure: Coverage trend over time

---

## Future Enhancements

### Phase 5 (Future)

1. **Test Parallelization**
   - Run Golden Tests in parallel for speed
   - Requires test isolation guarantees

2. **Visual Coverage Dashboard**
   - Web UI showing coverage trends
   - Heatmap of covered vs uncovered patterns

3. **Automated Test Generation**
   - AI-generated Golden Tests from new accidents
   - Conversation log monitoring

4. **Multi-Environment Testing**
   - Run tests on different Node/Bun versions
   - Cross-platform compatibility checks

5. **Performance Benchmarking**
   - Track test execution time over time
   - Alert on performance regressions

---

## Conclusion

Phase 4 (CI/CD Integration) is now **fully implemented**:

1. ✅ **GitHub Actions:** Automated testing on every push/PR
2. ✅ **Pre-commit Hooks:** Local validation before commits
3. ✅ **Test Runner:** Integration with Bun test framework
4. ✅ **Notifications:** Telegram alerts for failures and coverage
5. ✅ **Coverage Tracking:** Automated metrics and reporting

The Golden Test Framework is now fully integrated into the development workflow, preventing past accidents from recurring through continuous validation.

---

**Next Step:** Validate CI/CD pipeline with real commits and PRs
