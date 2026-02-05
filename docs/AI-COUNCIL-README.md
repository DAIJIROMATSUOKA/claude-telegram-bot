# AI Council - JARVIS MESH

## Purpose

The AI Council is a multi-AI advisory board that reviews critical design decisions for JARVIS Autopilot Engine. Each member brings unique expertise:

- **クロッピー🦞 (GPT-4):** Pragmatic engineering, real-world trade-offs
- **ジェミー💎 (Gemini):** Systems thinking, holistic architecture
- **チャッピー🧠 (Claude):** Safety-first design, risk analysis

## Consultation Process

### 1. Consultation Request
JARVIS creates a consultation document with:
- Background context
- Specific questions
- Options with trade-offs
- Expected response format

**Location:** `/docs/ai-council-consultation-*.md`

### 2. Council Reviews
Each member independently reviews and responds:
- Provides recommendations
- Explains rationale
- Flags potential risks

**Location:** `/docs/ai-council-responses-*.md`

### 3. Synthesis
JARVIS synthesizes responses into final decision:
- Identifies consensus
- Documents dissenting opinions
- Makes final implementation choice

### 4. Implementation
JARVIS proceeds with implementation using council guidance.

## Current Active Consultations

### Phase 3 Autopilot CI - Golden Test Framework
**Status:** 🟡 Active
**Date:** 2026-02-04
**Deadline:** 2026-02-05

**Files:**
- Request: `/docs/ai-council-consultation-phase3.md`
- Responses: `/docs/ai-council-responses-phase3.md`

**Questions:**
1. Golden Test selection criteria (severity vs frequency vs impact?)
2. Test robustness strategy (avoiding flaky tests)
3. Kill Switch activation thresholds (immediate vs delayed?)

## How to Respond (For AI Council Members)

1. Read the consultation request in `/docs/ai-council-consultation-phase3.md`
2. Open `/docs/ai-council-responses-phase3.md`
3. Fill in your section using the provided template
4. Provide:
   - Clear recommendation
   - Detailed rationale
   - Additional considerations
   - Potential risks

## Response Template

See `/docs/ai-council-responses-phase3.md` for the structured template.

## Notification Channels

AI Council members are notified through:
- Telegram message (manual notification by user)
- Consultation document (this serves as formal record)

## Philosophy

**"Three minds are better than one"**

The AI Council ensures:
- Diverse perspectives on complex decisions
- Balanced trade-off analysis
- Risk identification before implementation
- Better outcomes through collaborative intelligence

## History

- **2026-02-04:** Phase 3 Autopilot CI consultation (Golden Test Framework)

---

**Last Updated:** 2026-02-04
