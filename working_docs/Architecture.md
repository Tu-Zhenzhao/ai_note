# Architecture — AI Content Strategist Interviewer (v4)

> Last updated: 2026-03-11

---

## 1. System Overview

The AI Content Strategist Interviewer is a structured discovery tool that interviews users about their company, audience, and content goals to produce a LinkedIn content strategy brief. It operates as a **dual-panel web app**: a conversational chat on the left and a live-updating strategy preview on the right.

The system follows a **deterministic backend** pattern: the AI model proposes actions, but the backend owns all state mutation, checklist advancement, and section gating logic.

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js Frontend                      │
│  ┌──────────────────┐   ┌────────────────────────────┐  │
│  │  Chat Panel       │   │  Strategy Preview Panel    │  │
│  │  (conversation)   │   │  (6 sections + progress)   │  │
│  │                   │   │                            │  │
│  │  Context Window   │   │  Verification indicators   │  │
│  │  Ring (tokens)    │   │  Section completion dots   │  │
│  └──────────────────┘   └────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │ POST /api/interview/message
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   Backend Pipeline                       │
│  LangGraph: receive → extract → evaluate → plan →       │
│             assistant → preview → respond                │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, React, Vercel AI SDK |
| AI Runtime | LangGraph (StateGraph), Vercel AI SDK (`generateText`, `generateObject`) |
| Models | Gemini 3.1 Flash Lite (primary), GPT-5 (co-primary), DeepSeek (fallback) |
| Backend | Node.js / TypeScript |
| Persistence | PostgreSQL + JSONB (production), In-memory repository (development) |
| State Schema | v3 typed InterviewState with checklist, verification, and preview projection |

---

## 3. LangGraph Pipeline

Every user message runs through a **linear LangGraph StateGraph**. Each node reads and mutates a shared `EngineContext` object.

```
START
  │
  ▼
┌─────────────────────────┐
│  receive_user_message    │  Reset turn state, migrate schema, detect fatigue
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ extract_structured_      │  Heuristic + LLM extraction → apply to state
│ updates                  │  → section-aware checklist advancement
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ update_interview_state   │  Set interview stage to "clarification"
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ evaluate_completion      │  Compute module scores, completion level, blockers
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ planner_runtime          │  Section advancement → decision policy → next question
│                          │  Actions: ask, confirm, summarize, checkpoint,
│                          │           handoff, generate_brief
└───────────┬─────────────┘
            │
            ├── [handoff] → create_handoff_summary ──┐
            │                                         │
            └── [else] ──────────────────────────────┤
                                                      ▼
                                        ┌─────────────────────────┐
                                        │ generate_assistant_      │  Build prompts from
                                        │ response                 │  AGENT.md + state + checklist
                                        │                          │  → LLM generates reply
                                        └───────────┬─────────────┘
                                                     ▼
                                        ┌─────────────────────────┐
                                        │ compose_preview          │  Build 6-section preview
                                        │                          │  from InterviewState
                                        └───────────┬─────────────┘
                                                     ▼
                                                    END
```

**Source:** `src/server/orchestration/engine.ts`

---

## 4. File Map

### Core Pipeline

| File | Purpose |
|------|---------|
| `src/server/orchestration/engine.ts` | LangGraph StateGraph — wires all nodes together |
| `src/server/services/extraction.ts` | Heuristic + LLM structured data extraction from user messages |
| `src/server/planner/runtime.ts` | Planner decision logic — chooses next action and question |
| `src/server/services/assistant.ts` | Generates the AI's conversational reply via LLM |
| `src/server/services/preview.ts` | Builds the 6-section strategy preview for the UI |
| `src/server/rules/checklist.ts` | Checklist model, section ordering, two-tier section gating |
| `src/server/rules/completion.ts` | Completion scoring — module weights, readiness gates |
| `src/server/rules/followup.ts` | Fallback question strategies, fatigue detection |

### Model & Prompts

| File | Purpose |
|------|---------|
| `src/server/model/adapters.ts` | LLM routing (primary/co-primary/fallback), token tracking |
| `src/server/prompts/AGENT.md` | System prompt — AI persona, rules, response format |
| `src/server/prompts/interview.ts` | Builds system + user prompts for the assistant LLM |
| `src/server/prompts/extraction.ts` | Prompts for structured extraction |

### Planner Tools

| File | Purpose |
|------|---------|
| `src/server/planner/tools.ts` | Tool wrappers: extract_facts, update_payload, evaluate_completion, select_next_question, build_preview, prepare_checkpoint, prepare_brief |
| `src/server/planner/retrieval.ts` | Chat book recall, conflict retrieval |

### Types & State

| File | Purpose |
|------|---------|
| `src/lib/types.ts` | All shared types: InterviewState, ChecklistItem, CompletionState, etc. |
| `src/lib/state.ts` | Initial state factory, module weights, completion helpers |

### Persistence & Session

| File | Purpose |
|------|---------|
| `src/server/repo/contracts.ts` | Repository interface (InterviewRepository) |
| `src/server/repo/postgres-repo.ts` | PostgreSQL implementation |
| `src/server/repo/in-memory-repo.ts` | In-memory implementation (development) |
| `src/server/services/session.ts` | Session lifecycle: get or create |
| `src/server/services/persistence.ts` | Persist state and session after each turn |

### API & Frontend

| File | Purpose |
|------|---------|
| `app/api/interview/message/route.ts` | POST handler — runs engine, persists, returns response |
| `src/components/interview-app.tsx` | Main UI: chat panel, strategy preview, context window ring |

---

## 5. Interview State Schema

The `InterviewState` is a deeply typed object stored as JSONB. Every field uses `StatusValue<T>` which tracks:

```typescript
interface StatusValue<T> {
  value: T;
  status: FieldStatus;         // "missing" | "partial" | "strong" | "verified"
  ai_generated: boolean;
  verification: VerificationState; // "unverified" | "user_confirmed" | "ai_inferred" | "contradicted"
}
```

### State Modules

| Module | Key Fields |
|--------|-----------|
| `company_profile` | company_name, company_one_liner, industry, business_model |
| `brand_story` | founding_story, origin_context, mission_statement, core_belief, what_should_people_remember |
| `product_service` | primary_offering, core_offerings, problem_solved, key_differentiators |
| `market_audience` | primary_audience, audience_roles, audience_pain_points, audience_desired_outcomes, attraction_goal |
| `linkedin_content_strategy` | primary_content_goal, desired_content_formats, topics_they_want_to_talk_about, topics_to_avoid_or_deprioritize |
| `content_preferences` | preferred_tone, preferred_voice, preferred_style_tags |
| `content_dislikes` | disliked_tone, disliked_messaging_patterns |
| `evidence_library` | case_studies, metrics_and_proof_points, assets, milestones_and_updates, source_material_links |
| `constraints_and_boundaries` | forbidden_topics, sensitive_topics, claims_policy |
| `user_concerns` | main_concerns |
| `content_readiness` | ai_suggested_first_content_topic, ai_suggested_first_content_format, ai_suggested_first_content_goal, required_missing_inputs_for_first_content |

### Meta Fields

| Field | Purpose |
|-------|---------|
| `conversation_meta` | Turn count, interview stage, current_section_index, current_focus_modules, model info |
| `system_assessment` | Completion scores, missing/weak fields, last_turn_diagnostics, tool calls, planner trace |
| `checklist` | Array of `ChecklistItem` — the core tracking structure |
| `preview_projection` | The rendered 6-section preview (company_understanding, audience_understanding, etc.) |

---

## 6. Checklist Model

The checklist is an array of `ChecklistItem` objects — each representing a strategic question the AI needs to answer.

### ChecklistItem Structure

```typescript
interface ChecklistItem {
  id: string;                          // e.g. "cp_what_does_company_do"
  module: string;                      // e.g. "company_profile"
  question_label: string;              // Human-readable question
  question_intent: string;             // What we're trying to learn
  status: ChecklistItemStatus;         // "unanswered" | "partial" | "answered" | "verified" | "not_applicable"
  answer_summary: string;
  evidence_for_answer: string[];
  evidence_confidence: number;         // 0-1
  supporting_turn_ids: string[];
  filled_from_fields: string[];        // Which state fields fed into this item
  priority: "critical" | "high" | "medium" | "low";
  last_touched_turn_id: string | null;
  verification_needed: boolean;        // true for critical items
}
```

### Field-to-Checklist Mapping

State fields map to checklist items via `FIELD_TO_CHECKLIST`. When a field is extracted, the corresponding checklist item advances.

```
company_profile.company_one_liner  →  cp_what_does_company_do
company_profile.company_name       →  cp_what_does_company_do
brand_story.founding_story         →  bs_why_exist
product_service.key_differentiators → ps_why_different
market_audience.primary_audience   →  ma_primary_audience
...
```

Multiple fields can feed into a single checklist item (e.g. `founding_story` + `origin_context` both feed `bs_why_exist`). The item's `filled_from_fields` count determines whether it reaches "answered" status.

---

## 7. Section-Sequential Flow (v4)

The interview follows a strict **section-by-section order**. The AI must complete all critical and high-priority items in the current section before advancing to the next.

### Section Order

| Index | Section | Modules | Checklist Items |
|-------|---------|---------|----------------|
| 0 | Company Understanding | company_profile, brand_story, product_service | cp_what_does_company_do (critical), cp_category (high), cp_business_model (high), bs_why_exist (high), bs_what_believe (medium), bs_what_remember (medium), ps_main_offering (critical), ps_problem_solved (critical), ps_why_different (high) |
| 1 | Audience Understanding | market_audience | ma_primary_audience (critical), ma_struggles (high), ma_outcomes (high) |
| 2 | LinkedIn Content Strategy | linkedin_content_strategy | lcs_why_linkedin (high), lcs_what_achieve (critical), lcs_topics_formats (high) |
| 3 | Evidence & Proof Assets | evidence_library | ev_proof (critical), ev_assets (medium), ev_support (low) |
| 4 | Content Preferences & Boundaries | content_preferences, content_dislikes, constraints_and_boundaries, user_concerns | cpref_feel (medium), cpref_tone_voice_style (medium), cdis_avoid_style (low), cb_not_said (high), cb_sensitive (medium), uc_worries (low) |
| 5 | Content Readiness / Generation Plan | content_readiness | cr_first_topic (high), cr_first_format (medium), cr_blockers (medium) |

### Section Completion Rule

A section is complete when **ALL critical items AND ALL high-priority items** are in "answered" or "verified" status. Medium and low items do not block advancement.

---

## 8. Two-Tier Section Gating (Core Design)

This is the most important architectural mechanism. It prevents cross-section extraction from prematurely advancing sections.

### The Problem It Solves

When a user describes their company, the extraction model also infers audience info, content topics, evidence hints, etc. Without gating, these cross-section inferences would mark future-section checklist items as "answered," causing the planner to skip entire sections the AI never actually asked about.

### How It Works

```
User message
    │
    ▼
┌──────────────────────────────┐
│  Extraction (heuristic + LLM) │
│  Captures fields across ALL   │
│  modules                      │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│  advanceChecklistItems()      │
│                               │
│  For each captured field:     │
│  ┌──────────────────────┐    │
│  │ Which section does    │    │
│  │ this item belong to?  │    │
│  └──────────┬───────────┘    │
│             │                 │
│    ┌────────┴────────┐       │
│    │                  │       │
│  Current/Past      Future     │
│  Section           Section    │
│    │                  │       │
│    ▼                  ▼       │
│  "answered"       "partial"   │
│  (counts for     (data saved  │
│   completion)     but does NOT │
│                   count)       │
└──────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│  advanceSectionIfComplete()   │
│                               │
│  1. Is current section done?  │
│     (all critical+high =      │
│      answered/verified)       │
│                               │
│  2. If yes → advance ONE      │
│     section                   │
│                               │
│  3. promotePartialsInSection()│
│     Promote "partial" items   │
│     in new section to         │
│     "answered" (cross-section │
│     data now counts)          │
│                               │
│  4. Re-check: if new section  │
│     also complete → advance   │
│     one more (max 2 jumps)    │
│                               │
│  5. Force-advance safety:     │
│     after 5 turns on same     │
│     section, if criticals     │
│     done + 75% high done →    │
│     force advance             │
└──────────────────────────────┘
```

### Key Properties

- **Cross-section capture is preserved**: data is stored immediately in the state fields, but the checklist item stays "partial"
- **Sections cannot be skipped**: the AI must reach a section for its items to be promoted
- **When entering a new section, previously captured data is promoted**: if the user already answered something about Section 3 while on Section 1, when the AI reaches Section 3, those items get promoted to "answered" — so the section may complete quickly
- **Maximum 2 section jumps per turn**: prevents unbounded skipping
- **Force-advance after 5 turns**: safety valve to prevent indefinite stuck-on-section loops

**Source:** `src/server/rules/checklist.ts` — `advanceChecklistItems()`, `advanceSectionIfComplete()`, `promotePartialsInSection()`

---

## 9. Extraction Pipeline

Extraction runs on every user message and populates the InterviewState.

### Two-Phase Extraction

```
User message
    │
    ├──→ heuristicExtract()     Fast regex/pattern matching
    │    (company name, industry patterns, audience cues)
    │
    └──→ LLM extraction         Structured output via generateModelObject()
         (extractionSchema)      Uses extractionSystemPrompt + extractionUserPrompt
    │
    ▼
mergeUpdates()                   Combine heuristic + model results (model wins on conflict)
    │
    ▼
applyExtraction()                Write to InterviewState fields
    │                            Cross-map related fields (mission → founding_story, pain → outcomes)
    │                            Track captured fields + conflicts
    ▼
advanceChecklistItems()          Section-aware checklist advancement (see Section 8)
```

### Extraction Prompt Strategy

The extraction prompt (`src/server/prompts/extraction.ts`) contains:
- A **field guide** with specific instructions per field
- Rules to **summarize, not copy** user text
- Rules to be **generous** across all modules (not just current)
- **Restrictive rules** for high-value fields:
  - `founding_story`: only extract when user explicitly discusses founding motivation
  - `key_differentiators`: only extract when user explicitly compares to competitors

**Source:** `src/server/services/extraction.ts`, `src/server/prompts/extraction.ts`

---

## 10. Planner Decision Policy

The planner runs after extraction and decides the AI's next move.

### Decision Priority Order

```
1. Reconcile conflicts      → confirm  (if unresolved contradictions)
2. Fill critical gaps        → ask      (if critical checklist items still open)
3. Stabilize understanding   → summarize (if ≥3 fields captured this turn)
4. Pause for verification    → checkpoint (if score ≥65% or fatigue high)
5. Escalate                  → handoff  (if complexity too high)
6. Generate                  → generate_brief (if approved + ready)
7. Default                   → ask      (select next question from checklist)
```

### Question Selection

`selectBestChecklistTarget()` picks the next question:
1. Look at **current section's open items** first
2. Within section: prioritize critical > high > medium > low, then unanswered > partial
3. If current section is complete, look at the next section's open items

**Source:** `src/server/planner/runtime.ts`, `src/server/rules/checklist.ts`

---

## 11. Assistant Response Generation

The assistant LLM receives a structured prompt built from:

### System Prompt (from AGENT.md)

- AI persona: senior LinkedIn content strategist
- Behavioral rules: section-sequential flow, one question at a time, natural conversation
- Response format: acknowledge → update → progress → question
- Tone: professional but warm, no jargon repetition

### User Prompt (built dynamically)

```
=== CURRENT STATE ===
Current section (N/6): <name>
Already answered in this section: [item labels]
Still needed in this section: [open item labels]

=== SECTION PROGRESS ===
Section 1: Company Understanding (3 done, 2 partial, 9 total) ← CURRENT
Section 2: Audience Understanding (0 done, 1 partial, 3 total)
...

=== FULL CHECKLIST ===
- [DONE] cp_what_does_company_do (company_profile, critical)
- [PARTIAL] bs_why_exist (brand_story, high)
- [OPEN] ps_why_different (product_service, high)
...

=== THIS TURN ===
User said: "..."
Captured this turn: Company one-liner, Industry, Primary offering
Cross-section info captured: Primary audience (section 2), Topics (section 3)

=== SUGGESTED NEXT QUESTION ===
Question type: ask
Suggested question: "Why is your product different from existing search tools?"

=== RECENT CHAT HISTORY ===
(last 8 messages)

=== YOUR TASK ===
1. Acknowledge what was captured
2. State what you updated
3. Note current section progress
4. Ask the next question
IMPORTANT: If a checklist item is DONE or PARTIAL, do NOT ask about it again.
```

**Source:** `src/server/services/assistant.ts`, `src/server/prompts/interview.ts`

---

## 12. Model Routing & Fallback

### Provider Strategy

```
Primary:     MODEL_PRIMARY (default: gemini-3.1-flash-lite-preview)
Co-primary:  If primary is Gemini → GPT-5; if primary is GPT → Gemini
Fallback:    MODEL_FALLBACK (default: deepseek-chat)
```

### Routing Logic

`generateModelText()` and `generateModelObject()` use `withFallback()`:
1. Try primary model
2. If fails → try co-primary
3. If fails → try fallback (DeepSeek)

### Context Window Limits

| Model | Context Window | Max Output |
|-------|---------------|------------|
| gemini-3.1-flash-lite-preview | 1,048,576 tokens | 65,536 tokens |
| gpt-5 | 400,000 tokens | 128,000 tokens |
| deepseek-chat | 64,000 tokens | — |

### Token Tracking

Every LLM call records:
- Input tokens (from `result.usage?.inputTokens`)
- Output tokens (from `result.usage?.outputTokens`)
- Cumulative totals across the session
- Estimated cost per turn and session total

**Source:** `src/server/model/adapters.ts`

---

## 13. Context Window Visualization

The frontend displays a **Context Window Ring** showing:
- Current utilization percentage (used / max tokens)
- Token breakdown: system prompt, user prompt, completion
- Estimated cost (per-turn and cumulative session)
- Active model name and provider
- Turn counter

Color coding: green (< 50%), yellow (50-80%), red (>= 80%)

**Source:** `src/components/interview-app.tsx` — `ContextWindowRing` component

---

## 14. Preview System

The 6-section strategy preview is rebuilt after every turn.

### Preview Sections

| # | Section | Key Fields Displayed |
|---|---------|---------------------|
| 1 | Company Understanding | Company summary, brand story, main offering, problem solved, differentiator |
| 2 | Audience Understanding | Primary audience, core problems, desired outcomes, LinkedIn attraction goal |
| 3 | LinkedIn Content Strategy | Main content goal, positioning, topics, formats, topics to avoid |
| 4 | Evidence & Proof Assets | Case studies, metrics, milestones, assets |
| 5 | AI Suggested Content Directions | Up to 3 AI-generated content angle suggestions |
| 6 | Generation Plan | Recommended first post topic, format, blockers |

Each section includes **verification indicators** showing whether fields are user-confirmed, AI-inferred, or need confirmation.

The currently active section is highlighted in the UI. Sections use synthesized summaries (not raw user input) built by `buildCompanySummary()` and `buildBrandStorySummary()` in the preview service.

**Source:** `src/server/services/preview.ts`

---

## 15. Persistence Layer

### Repository Interface

`InterviewRepository` defines all persistence operations:
- Session CRUD (getSession, createSession, upsertSession)
- State CRUD (getState, upsertState)
- Messages (listMessages, addMessage)
- Chat book entries, planner decisions, tool action logs
- Checkpoint snapshots, handoff summaries, generated content

### Implementations

- **PostgreSQL** (`postgres-repo.ts`): Production — stores state as JSONB
- **In-Memory** (`in-memory-repo.ts`): Development — Map-based storage

### Per-Turn Persistence

After each engine run, `persistStateAndSession()` saves:
- Updated InterviewState (state_jsonb)
- Preview snapshot (preview_jsonb)
- System assessment (assessment_jsonb)
- Session metadata (status, completion_level, completion_score)

**Source:** `src/server/repo/contracts.ts`, `src/server/services/persistence.ts`

---

## 16. API Contract

### POST /api/interview/message

**Request:**
```json
{
  "session_id": "uuid",
  "user_message": "string"
}
```

**Response:**
```json
{
  "assistant_message": "string",
  "preview": { ... },
  "completion": { ... },
  "next_action": "continue | checkpoint | generate_brief | handoff",
  "planner_action": "ask | confirm | summarize | ...",
  "question_type": "open | clarify | confirm | ...",
  "current_section_index": 0,
  "current_section_name": "Company Understanding",
  "section_advanced": false,
  "context_window": {
    "modelUsed": "gemini-3.1-flash-lite-preview",
    "provider": "google",
    "maxContextTokens": 1048576,
    "usedTokens": 3800,
    "utilizationPercent": 0.36,
    "breakdown": { ... },
    "estimatedCostUsd": 0.003
  },
  "cumulative_tokens": {
    "inputTokens": 8500,
    "outputTokens": 2000
  }
}
```

**Source:** `app/api/interview/message/route.ts`

---

## 17. Tool Calling Contract

All model actions go through typed backend tools. The model cannot directly mutate state.

### Core Tools

| Tool | Purpose |
|------|---------|
| `extract_facts` | Extract structured data from user message |
| `update_payload` | Log captured field changes |
| `append_chat_book` | Save conversation context for retrieval |
| `mark_conflict` | Record contradictions |
| `evaluate_completion` | Recompute interview readiness |
| `select_next_question` | Pick best next question from checklist |
| `build_checkpoint_preview` | Generate checkpoint summary |
| `prepare_brief_candidate` | Produce the strategist brief |
| `update_checklist` | Manually update checklist item status |

### Enforcement Rules

- Tool execution is logged with reason, input, output, and success status
- Tool inputs are validated against schemas
- Backend is the source of truth for all state mutation
- Checklist state changes are auditable via supporting_turn_ids

**Source:** `src/server/planner/tools.ts`

---

## 18. Data Flow Diagram — Complete Turn

```
User types message
        │
        ▼
┌─ API Route ─────────────────────────────────────────────────┐
│  1. getOrCreateSession(sessionId)                           │
│  2. Load InterviewState from repo                           │
│  3. runInterviewTurn(engineContext) ─────────────────────┐   │
│     │                                                    │   │
│     │  receive_user_message                              │   │
│     │    → migrate state, detect fatigue                 │   │
│     │                                                    │   │
│     │  extract_structured_updates                        │   │
│     │    → heuristic + LLM extraction                    │   │
│     │    → applyExtraction (write to state fields)       │   │
│     │    → advanceChecklistItems (section-aware)          │   │
│     │      • current section items → "answered"          │   │
│     │      • future section items → "partial" (gated)    │   │
│     │                                                    │   │
│     │  evaluate_completion                               │   │
│     │    → module scores, completion level                │   │
│     │                                                    │   │
│     │  planner_runtime                                   │   │
│     │    → advanceSectionIfComplete                      │   │
│     │      • promote partials in new section             │   │
│     │    → select planner action (ask/confirm/...)       │   │
│     │    → select next question from checklist           │   │
│     │                                                    │   │
│     │  generate_assistant_response                       │   │
│     │    → build prompts (AGENT.md + state + checklist)  │   │
│     │    → LLM generates conversational reply            │   │
│     │    → record token usage                            │   │
│     │                                                    │   │
│     │  compose_preview                                   │   │
│     │    → build 6-section preview from state            │   │
│     │    → synthesize summaries                          │   │
│     └────────────────────────────────────────────────────┘   │
│                                                              │
│  4. Save assistant message to repo                           │
│  5. persistStateAndSession (state, preview, assessment)      │
│  6. Return JSON response to frontend                         │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
Frontend updates chat + preview + context window
```

---

## 19. Design Principles

1. **Deterministic backend**: The AI model generates text; the backend controls all state mutation and section advancement.
2. **Section gating**: Cross-section data capture is encouraged, but section completion is gated — only items in the current section count toward advancement.
3. **Checklist-driven**: Every piece of information maps to a checklist item. The checklist is the single source of truth for interview progress.
4. **Provider-agnostic**: Model routing supports multiple providers with automatic fallback.
5. **Auditable**: Every state change, tool call, and planner decision is logged with turn IDs.
6. **Progressive disclosure**: The preview shows what's been captured so far with verification indicators — users see progress in real time.
