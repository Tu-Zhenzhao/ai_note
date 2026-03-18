# Architecture — AskMore (多问AI)

> Last updated: 2026-03-13
>
> Cleanup phase note: the legacy LangGraph orchestration runtime and legacy planner runtime/tool stack were removed. The active backend path is `agent-runtime -> classifyTurn -> task handlers -> answer-turn controller`, exposed through a `TurnController` boundary used by `/api/interview/message`.
>
> Cleanup boundary: no DB schema migration changes and no `/api/interview/*` contract changes in this phase.
>
> Note: deeper sections in this document still contain historical descriptions from before the cleanup and will be rewritten in the next architecture pass.

---

## 1. System Overview

The app is a dual-panel interview tool that collects structured company, audience, and content-strategy information and turns it into a live strategy preview.

At a high level:

- The **LLM interprets user meaning** and writes natural language.
- The **backend owns state mutation and workflow truth**.
- The **frontend renders backend workflow state directly** and opens interactive UI modules such as section confirmation and guided choices.

Current high-level flow:

```text
Frontend chat + preview
        │
        ▼
POST /api/interview/message
        │
        ▼
TurnController
  classify intent → run task workflow → compose preview
        │
        ▼
JSON response
  - assistant message
  - updated preview
  - completion state
  - workflow state
  - optional structured choice payload
        │
        ▼
Frontend renders:
  - chat turn
  - active section
  - blockers
  - confirmation panel
  - structured choice UI
```

Primary architectural intent:

- preserve natural chat
- make progression deterministic
- keep preview, workflow, and confirmation UI aligned

---

## 2. Responsibility Split

### LLM-owned responsibilities

- interpret messy or indirect user language
- produce structured extraction candidates
- write acknowledgements and question phrasing
- suggest a conversational response style

### Backend-owned responsibilities

- state mutation
- workflow phase
- active section
- pending review section
- required blockers
- next required slot
- confirmation gating
- persistence
- completion scoring

### Frontend-owned responsibilities

- render workflow state returned by the backend
- render preview and verification indicators
- render the section review panel
- render guided structured choices with an `Other` path
- never infer progression from assistant wording alone

This split is implemented, but the current planner is still partly **question-led** rather than fully **interaction-module-led**. That nuance matters when reading the rest of this document.

---

## 3. Tech Stack

| Layer       | Technology                                                   |
| ----------- | ------------------------------------------------------------ |
| Frontend    | Next.js App Router, React 18, TypeScript                     |
| Styling     | Global CSS + inline style objects, warm/earthy custom theme  |
| AI runtime  | LangGraph `StateGraph` orchestration                         |
| LLM SDK     | Vercel AI SDK `generateText` / `generateObject`              |
| Models      | Gemini 3.1 Flash Lite, GPT-5, DeepSeek fallback              |
| Backend     | TypeScript / Node.js                                         |
| Persistence | PostgreSQL + JSONB, with in-memory repo for development/tests |
| Validation  | Zod                                                          |
| Testing     | Vitest                                                       |

---

## 4. Key Architectural Layers

### 4.1 Interview state

The canonical session state is `InterviewState` in `src/lib/types.ts`, initialized by `createInitialState()` in `src/lib/state.ts`.

Important top-level areas:

- `conversation_meta`
- `checklist`
- `workflow`
- domain modules such as `company_profile`, `market_audience`, `linkedin_content_strategy`
- `system_assessment`
- `preview_projection`

### 4.2 Preview-slot layer

The preview-slot layer in `src/server/services/preview-slots.ts` is the current **truth bridge** between raw state and conversational workflow.

Each `PreviewSlot` describes:

- which section it belongs to
- how it is displayed
- which field(s) feed it
- whether it is required for section completion
- its blocker priority
- its verification state

The workflow service and preview service both consume these slots.

### 4.3 Workflow layer

The workflow layer in `src/server/services/workflow.ts` computes:

- current phase
- active section
- pending review section
- required open slot IDs
- next question slot ID
- transition reason

The frontend relies on this object to drive confirmation UI and section highlighting.

### 4.4 Checklist layer

The checklist still exists and still matters for:

- evidence tracking
- cross-section capture
- completion maps
- legacy/fallback targeting
- some tests and diagnostics

But it is **no longer the top-level workflow authority** inside the live engine. The preview-slot + workflow combination now carries section truth.

---

## 5. End-to-End Turn Pipeline

Every user message runs through a linear LangGraph pipeline in `src/server/orchestration/engine.ts`.

```text
START
  ↓
receive_user_message
  - migrate state if needed
  - initialize missing workflow
  - detect fatigue
  ↓
extract_structured_updates
  - heuristic extraction
  - model extraction
  - merge updates
  - apply updates to InterviewState
  - advance checklist items
  - sync workflow immediately
  ↓
update_interview_state
  - set interview stage to clarification
  ↓
evaluate_completion
  - compute score / readiness / blockers
  ↓
planner_runtime
  - inspect workflow + completion + conflicts
  - choose planner action
  - choose next question
  - optionally emit structured choice payload
  ↓
generate_assistant_response
  - build assistant prompt
  - prepend deterministic workflow framing
  - strip unauthorized transition language
  ↓
compose_preview
  - rebuild user preview + internal preview
  ↓
END
```

Conditional branch:

- when planner action is `handoff`, engine also runs `create_handoff_summary`

Important implementation note:

- the engine does **not** call `advanceSectionIfComplete()` as the live authority anymore
- it relies on `syncWorkflowState()` instead

Source: `src/server/orchestration/engine.ts`

---

## 6. Core File Map

### Runtime and orchestration

| File                                 | Purpose                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| `src/server/orchestration/engine.ts` | LangGraph pipeline and per-turn orchestration                |
| `src/server/planner/runtime.ts`      | Planner decision policy and optional structured choice fallback |
| `src/server/planner/tools.ts`        | Logged planner tool wrappers                                 |
| `src/server/planner/retrieval.ts`    | Chat-book and conflict recall                                |

### State truth and projection

| File                                   | Purpose                                                      |
| -------------------------------------- | ------------------------------------------------------------ |
| `src/lib/types.ts`                     | Shared types including `InterviewWorkflowState` and `StructuredChoicePrompt` |
| `src/lib/state.ts`                     | Initial state factory and module weight setup                |
| `src/server/services/workflow.ts`      | Workflow state machine and deterministic confirm/advance     |
| `src/server/services/preview-slots.ts` | Preview slot construction and slot-completion policy         |
| `src/server/services/preview.ts`       | User-facing preview composition and internal preview payload |

### Extraction and assistant

| File                                | Purpose                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| `src/server/services/extraction.ts` | Heuristic + model extraction, direct-answer confirmation path |
| `src/server/services/assistant.ts`  | Hybrid assistant assembly with deterministic workflow line   |
| `src/server/prompts/interview.ts`   | Assistant prompt builder with workflow constraints           |
| `src/server/prompts/extraction.ts`  | Extraction prompt builder                                    |
| `src/server/prompts/AGENT.md`       | High-level behavior instructions for the assistant           |

### Rule layers

| File                             | Purpose                                                      |
| -------------------------------- | ------------------------------------------------------------ |
| `src/server/rules/checklist.ts`  | Checklist model, cross-section advancement rules, legacy section helpers |
| `src/server/rules/followup.ts`   | Follow-up ladders, fatigue detection, question fallback strategies |
| `src/server/rules/completion.ts` | Completion scoring and generation readiness                  |

### Frontend and APIs

| File                                         | Purpose                                                     |
| -------------------------------------------- | ----------------------------------------------------------- |
| `src/components/interview-app.tsx`           | Main interview UI                                           |
| `src/components/interview-review-state.ts`   | Review section mapping and active/confirming visual helpers |
| `app/api/interview/message/route.ts`         | Main turn API                                               |
| `app/api/interview/preview/approve/route.ts` | Review confirmation endpoint                                |
| `app/api/interview/preview/edit/route.ts`    | Direct edit endpoint for review panel                       |

### Persistence and sessions

| File                                 | Purpose                                 |
| ------------------------------------ | --------------------------------------- |
| `src/server/repo/contracts.ts`       | Repository interface                    |
| `src/server/repo/postgres-repo.ts`   | PostgreSQL persistence                  |
| `src/server/repo/in-memory-repo.ts`  | In-memory persistence                   |
| `src/server/services/session.ts`     | Session retrieval / creation            |
| `src/server/services/persistence.ts` | Persist final state and session summary |

### Models and telemetry

| File                           | Purpose                                                 |
| ------------------------------ | ------------------------------------------------------- |
| `src/server/model/adapters.ts` | Provider routing, timeout handling, token/cost tracking |

---

## 7. State Schema

### 7.1 `StatusValue<T>`

Most user-facing fields are stored as a typed status wrapper:

```ts
interface StatusValue<T> {
  value: T;
  status: "missing" | "partial" | "strong" | "verified";
  ai_generated: boolean;
  verification_state: "unverified" | "user_confirmed" | "ai_inferred" | "contradicted";
  last_updated_at?: string;
}
```

Important distinction:

- `status` measures field strength / completeness
- `verification_state` measures confirmation provenance

### 7.2 Major domain modules

| Module                       | Key fields                                                   |
| ---------------------------- | ------------------------------------------------------------ |
| `company_profile`            | company name, one-liner, industry, business model            |
| `brand_story`                | founding story, mission, core belief, what people should remember |
| `product_service`            | primary offering, problems solved, differentiators           |
| `market_audience`            | primary audience, roles, pain points, desired outcomes, attraction goal |
| `linkedin_content_strategy`  | primary content goal, desired brand perception, formats, topics, topics to avoid |
| `evidence_library`           | case studies, metrics, assets, source materials              |
| `content_preferences`        | preferred tone, voice, style tags                            |
| `content_dislikes`           | disliked tone and messaging patterns                         |
| `constraints_and_boundaries` | forbidden topics, sensitive topics, claims policy            |
| `user_concerns`              | main concerns                                                |
| `content_readiness`          | suggested first topic, format, goal, blockers                |

### 7.3 `conversation_meta`

Tracks operational session info such as:

- `current_section_index`
- `current_focus_modules`
- `current_focus_checklist_ids`
- `interview_stage`
- planner traces
- model provider / model name
- `current_section_turn_count`
- runtime and state schema versions

### 7.4 `workflow`

The workflow object is the current deterministic progression contract:

```ts
type WorkflowPhase =
  | "interviewing"
  | "confirming_section"
  | "checkpoint"
  | "generation_ready"
  | "handoff";

interface InterviewWorkflowState {
  phase: WorkflowPhase;
  active_section_id: PreviewSectionId;
  pending_review_section_id: PreviewSectionId | null;
  next_question_slot_id: string | null;
  required_open_slot_ids: string[];
  transition_allowed: boolean;
  last_transition_reason: string | null;
}
```

### 7.5 `system_assessment`

Contains:

- completion scores
- confidence maps
- missing / weak / unconfirmed fields
- last-turn diagnostics
- follow-up attempts
- pending conflicts
- loop guard
- model route used
- `preview_slots`
- `confirmed_slot_ids`

### 7.6 `preview_projection`

Stores the user-facing preview sections plus metadata such as:

- `meta.user_confirmed`
- `meta.user_edited`
- `meta.last_user_action`
- revision log
- turn delta
- confirmation targets

Source: `src/lib/types.ts`, `src/lib/state.ts`

---

## 8. Sections and Preview Slots

The app uses six user-visible sections:

| Index | Section ID                           | Name                             | Modules                                                      |
| ----- | ------------------------------------ | -------------------------------- | ------------------------------------------------------------ |
| 0     | `company_understanding`              | Company Understanding            | `company_profile`, `brand_story`, `product_service`          |
| 1     | `audience_understanding`             | Audience Understanding           | `market_audience`                                            |
| 2     | `linkedin_content_strategy`          | LinkedIn Content Strategy        | `linkedin_content_strategy`                                  |
| 3     | `evidence_and_proof_assets`          | Evidence & Proof Assets          | `evidence_library`                                           |
| 4     | `content_preferences_and_boundaries` | Content Preferences & Boundaries | `content_preferences`, `content_dislikes`, `constraints_and_boundaries`, `user_concerns` |
| 5     | `generation_plan`                    | Generation Plan                  | `content_readiness`                                          |

### 8.1 Slot model

Each preview slot includes:

- `id`
- `section`
- `label`
- `question_label`
- `question_target_field`
- `status`
- `verification_state`
- `source_fields`
- `checklist_item_ids`
- `required_for_section_completion`
- `blocking_priority`
- `display_value`

### 8.2 Required slot examples

#### Company Understanding

- `company_understanding.company_summary`
- `company_understanding.brand_story`
- `company_understanding.main_offering`
- `company_understanding.problem_solved`
- `company_understanding.differentiator`

#### Audience Understanding

- `audience_understanding.primary_audience`
- `audience_understanding.core_problems`
- `audience_understanding.desired_outcomes`
- `audience_understanding.linkedin_attraction_goal`

#### LinkedIn Content Strategy

- `linkedin_content_strategy.main_content_goal`
- `linkedin_content_strategy.topics_and_formats`

Other section slots may exist without blocking completion.

### 8.3 Slot completion policy

Current slot readiness is evaluated by `isSlotOpenForCompletion()`.

General rule:

- `missing` and `weak` are open blockers

Special explicit rule:

- `audience_understanding.linkedin_attraction_goal` remains open until `verification_state === "user_confirmed"`

This is the main section-specific exception currently implemented.

### 8.4 Cross-section slot selection

`selectNextPreviewSlot()` looks from the current section forward and picks the highest-priority open required slot across current and later sections.

That is useful for planning, but it is one reason the system can still feel slightly ahead-of-itself if workflow handling is not treated as a hard stop.

Source: `src/server/services/preview-slots.ts`

---

## 9. Workflow State Machine

The workflow service in `src/server/services/workflow.ts` is the live source of truth for progression.

### 9.1 `syncWorkflowState(state)`

This function:

1. syncs preview slots
2. determines current active section from `conversation_meta.current_section_index`
3. collects current-section required blockers
4. computes `next_question_slot_id`
5. sets the workflow phase

Current phase rules:

- if `pending_review_section_id` exists → `confirming_section`
- else if no current-section required blockers exist → `confirming_section`
- else if next action is checkpoint → `checkpoint`
- else if next action is generate_brief → `generation_ready`
- else if next action is handoff → `handoff`
- else → `interviewing`

### 9.2 `confirmPendingSectionAndAdvance(state, sectionId)`

This function:

- validates that the requested section matches `pending_review_section_id`
- increments `current_section_index`
- resets section turn count
- clears pending review
- re-syncs workflow

### 9.3 Practical meaning of phases

| Phase                | Meaning                                                      |
| -------------------- | ------------------------------------------------------------ |
| `interviewing`       | Section still has blockers; continue gathering information   |
| `confirming_section` | Current section is ready for review; frontend should open the confirmation panel |
| `checkpoint`         | Midpoint/global verification step recommended                |
| `generation_ready`   | System believes first-brief generation can happen            |
| `handoff`            | Human strategist intervention is preferred                   |

### 9.4 Current nuance

Workflow is authoritative for **UI review state**, but planner output is still mostly expressed as a “question + planner action” rather than a richer “interaction module contract.”

Source: `src/server/services/workflow.ts`

---

## 10. Extraction Pipeline

Extraction runs on every user message in `src/server/services/extraction.ts`.

### 10.1 Two extraction passes

1. `heuristicExtract()`
2. model extraction via `generateModelObject()`

Then:

- `mergeUpdates()` combines them
- `applyExtraction()` writes updates into state

### 10.2 Important extraction behaviors

- field-specific status is derived from the extracted value
- verification state defaults to `ai_inferred` or `unverified` depending on source
- cross-mapping can infer related values, for example:
  - mission statement to founding story
  - pain points to outcomes
  - LinkedIn goal to content readiness helper fields

### 10.3 Direct-answer confirmation path

The current code explicitly supports a direct-answer path:

- if `workflow.next_question_slot_id` points at a required slot
- and the new user message clearly answers that slot
- then extraction can mark that field `user_confirmed`
- and `confirmPreviewSlots()` stores explicit confirmation for that slot

This is especially important for the Audience blocker on `market_audience.attraction_goal`.

### 10.4 Checklist advancement

After field updates, extraction calls `advanceChecklistItems()`.

Current-section and past-section checklist items may reach `answered`.

Future-section items are capped at `partial`, preserving data without letting them complete future sections prematurely.

### 10.5 Workflow sync after extraction

The extraction service now re-runs `syncWorkflowState(state)` at the end of the turn update, so a direct answer can immediately move a section into `confirming_section`.

Source: `src/server/services/extraction.ts`

---

## 11. Checklist Layer

The checklist layer lives in `src/server/rules/checklist.ts`.

### 11.1 What the checklist still does

- tracks question coverage
- tracks supporting evidence and turn IDs
- records cross-section captures
- builds completion maps
- supports legacy target resolution
- feeds diagnostics and tests

### 11.2 Field-to-checklist mapping

Examples:

- `company_profile.company_one_liner` → `cp_what_does_company_do`
- `product_service.problem_solved` → `ps_problem_solved`
- `market_audience.attraction_goal` → `ma_linkedin_attraction_goal`
- `linkedin_content_strategy.primary_content_goal` → `lcs_what_achieve`

### 11.3 Cross-section behavior

When extraction captures future-section data:

- the state field is updated immediately
- the corresponding checklist item becomes `partial`
- it does not count as full completion for the current section

### 11.4 Legacy section helpers

`advanceSectionIfComplete()` still exists, and `isSectionComplete()` now delegates to preview-slot completion.

However, in the live engine:

- workflow sync is the main progression authority
- `advanceSectionIfComplete()` is no longer the top-level engine driver

So this file is still important, but it is no longer the sole source of progression truth.

Source: `src/server/rules/checklist.ts`

---

## 12. Planner Runtime

Planner runtime lives in `src/server/planner/runtime.ts`.

It still thinks primarily in terms of:

- planner action
- question style
- question type
- next question

### 12.1 Decision priority order

Current implemented priority order:

1. resolve contradictions
2. handoff if completion says handoff-ready
3. generate if generation is allowed and checkpoint approved
4. checkpoint if score or fatigue thresholds say so
5. summarize if many fields were captured this turn
6. ask to fill critical/high blockers
7. default to a selected follow-up question

### 12.2 Structured-choice fallback

The planner can now emit a `StructuredChoicePrompt` for specific high-friction slots.

Currently implemented examples:

- `audience_understanding.linkedin_attraction_goal`
- `linkedin_content_strategy.main_content_goal`

A structured choice payload contains:

- `slot_id`
- `prompt`
- `options[]`
- `allow_other`
- optional `other_placeholder`

### 12.3 Important current limitation

The planner is not yet fully “interaction-module-first.”

It can still compute a next question even though workflow is conceptually in a confirmation-ready state. The frontend review panel is workflow-driven, but planner output is still question-oriented.

That means the current architecture is best described as:

- **workflow-first for review UI**
- **planner/question-first for conversational turn composition**

Source: `src/server/planner/runtime.ts`

---

## 13. Follow-up Layer

The follow-up rule layer in `src/server/rules/followup.ts` provides field strategies and fallback ladders.

It contains:

- field-specific question ladders
- fatigue-aware module reprioritization
- slot-based fallback targeting
- generic slot question generation

Representative strategies exist for:

- company one-liner
- brand core belief
- primary offering
- primary audience
- LinkedIn main content goal
- evidence/proof
- tone/preferences
- concerns and boundaries

This layer is used as a recovery and question-selection aid, not the only planner policy.

Source: `src/server/rules/followup.ts`

---

## 14. Assistant Generation

Assistant response generation lives in `src/server/services/assistant.ts`.

### 14.1 Current response assembly pattern

The assistant is a hybrid:

- backend provides deterministic workflow framing
- model writes the conversational body

Implemented safeguards:

- `deterministicWorkflowLine()` prepends either:
  - `We're still in <section>.`
  - `We are confirming <section> before moving on.`
- `stripUnauthorizedTransitions()` removes some transition claims when workflow does not allow them
- fallback mode uses sanitized question output if model generation fails

### 14.2 Prompt inputs

The assistant prompt includes:

- current section
- captured fields this turn
- recent messages
- workflow phase
- transition allowed flag
- pending review section name

### 14.3 Current limitation

Transition stripping is implemented, but still regex-based. So this layer reduces narration drift, but does not fully replace a richer interaction contract.

Source: `src/server/services/assistant.ts`, `src/server/prompts/interview.ts`

---

## 15. Preview Composition

The preview service in `src/server/services/preview.ts` rebuilds the preview every turn from preview slots and state modules.

### 15.1 User-visible sections

1. Company Understanding
2. Audience Understanding
3. LinkedIn Content Strategy
4. Evidence & Proof Assets
5. AI Suggested Content Directions
6. Generation Plan

### 15.2 What the preview contains

- section summaries
- verification indicators
- turn delta
- open items
- confirmation chips
- weak / missing / unconfirmed lists
- founder voice summary
- recommended formats
- internal preview data for debugging/UI logic

### 15.3 Internal preview payload

`internal_preview` includes:

- all preview slots
- current section slots
- current section open slots
- current section ID
- module completion status
- checklist completion status
- confidence scores
- weak/unconfirmed fields
- generation readiness flag

### 15.4 Important implementation details

- `open_items` now uses `isSlotOpenForCompletion()`, so special blockers like unconfirmed Audience attraction also surface there
- Audience verification display includes `desired_outcomes`
- AI Suggested Content Directions are derived content, not a separate workflow-controlled section with its own review panel

Source: `src/server/services/preview.ts`

---

## 16. Frontend Architecture

The main UI lives in `src/components/interview-app.tsx`.

### 16.1 Primary UI areas

- left chat panel
- context window ring
- input area
- optional review panel in the input area
- optional structured choice card in the input area
- right preview accordion

### 16.2 Workflow-driven rendering

The frontend consumes:

- `workflow_state`
- `structured_choice`
- `updated_preview`

and uses them to render:

- current section badge
- active preview highlight
- yellow confirming state
- section review panel
- blocker explanation text

### 16.3 Review panel

The review panel is only opened when:

- `workflow.phase === "confirming_section"`
- `workflow.pending_review_section_id` maps to a reviewable section

It steps through one item at a time and allows:

- confirm
- suggest change
- direct save edit

Current behavior:

- suggest-change is a direct user edit path
- it does **not** trigger an AI rewrite loop at this stage

### 16.4 Structured choice card

When `structured_choice` is present, the input area can render:

- predefined option buttons
- `Other` text input

This uses the same `sendMessage()` path as normal text input.

### 16.5 Review-state helpers

`src/components/interview-review-state.ts` provides:

- mapping from workflow section IDs to UI section labels
- preview focus logic
- confirming vs active visual-state helpers

Source: `src/components/interview-app.tsx`, `src/components/interview-review-state.ts`

---

## 17. API Contract

### 17.1 `POST /api/interview/message`

Request:

```json
{
  "session_id": "uuid",
  "user_message": "string"
}
```

Response fields currently include:

- `assistant_message`
- `updated_preview`
- `completion_state`
- `next_action`
- `handoff_summary`
- `captured_fields_this_turn`
- `captured_checklist_items_this_turn`
- `deferred_fields`
- `conflicts_detected`
- `question_reason`
- `planner_action`
- `question_style`
- `checkpoint_recommended`
- `user_facing_progress_note`
- `model_route_used`
- `planner_confidence`
- `verification_coverage`
- `open_checklist_items`
- `current_section_index`
- `current_section_name`
- `section_advanced`
- `workflow_state`
- `structured_choice`
- `context_window`
- `cumulative_tokens`

Source: `app/api/interview/message/route.ts`

### 17.2 `POST /api/interview/preview/approve`

Purpose:

- approve one or more reviewed sections
- promote strong fields to verified/user-confirmed
- confirm preview section slots
- deterministically advance workflow if the approved section matches the pending review section

Important behavior:

- `payload.all` acts like a checkpoint/global approval path
- approval updates preview meta flags such as `meta.user_confirmed`

Source: `app/api/interview/preview/approve/route.ts`

### 17.3 `POST /api/interview/preview/edit`

Purpose:

- handle direct edits from the review panel
- map edited fields back to preview slot IDs
- mark edited slots confirmed
- persist state and refresh workflow/preview

Important behavior:

- this is explicitly a direct-edit path, not an AI rewrite path

Source: `app/api/interview/preview/edit/route.ts`

---

## 18. Persistence Layer

The repository contract supports:

- session CRUD
- state CRUD
- messages
- tool action logs
- payload patch logs
- chat-book entries
- checkpoint snapshots
- handoff summaries
- generated content artifacts

Implementations:

- PostgreSQL JSONB repo
- in-memory repo for development/tests

Per-turn persistence saves:

- state JSON
- preview JSON
- completion level
- completion score
- updated session metadata

Source: `src/server/repo/contracts.ts`, `src/server/services/persistence.ts`

---

## 19. Planner Tool Logging

Planner tool wrappers in `src/server/planner/tools.ts` log each tool call with:

- tool name
- reason
- input
- output
- success flag

Core tools include:

- `extract_facts`
- `update_checklist`
- `append_chat_book`
- `mark_conflict`
- `evaluate_completion`
- `select_next_question`
- `build_checkpoint_preview`
- `prepare_brief_candidate`

These tools do not let the model mutate state directly; they provide auditable backend operations.

---

## 20. Model Routing and Telemetry

Model routing is implemented in `src/server/model/adapters.ts`.

### 20.1 Routing strategy

- choose explicit/available primary model if possible
- use the opposite provider as co-primary
- fall back to DeepSeek if needed

Default names:

- primary: `gemini-3.1-flash-lite-preview`
- co-primary: `gpt-5`
- fallback: `deepseek-chat`

### 20.2 Safety features

- hard timeout via `MODEL_TIMEOUT_MS`
- provider key presence checks
- test-environment model-call disablement

### 20.3 Telemetry

The adapter tracks:

- last model route
- last token usage
- cumulative token usage
- estimated context utilization
- per-turn estimated cost

These values feed the frontend context-window ring.

---

## 21. Current Data Flow Diagram

```text
User sends message
    │
    ▼
API route loads session + state
    │
    ▼
Engine receives turn
    │
    ├─ migrate state if needed
    ├─ detect fatigue
    ├─ extract updates
    │    ├─ heuristics
    │    ├─ model extraction
    │    ├─ write state
    │    ├─ advance checklist items
    │    └─ sync workflow
    ├─ evaluate completion
    ├─ run planner
    │    ├─ choose planner action
    │    ├─ choose next question
    │    └─ maybe emit structured choice
    ├─ build assistant reply
    │    ├─ deterministic workflow line
    │    └─ model-generated body
    └─ compose preview
          ├─ sections
          ├─ open items
          └─ internal preview
    │
    ▼
API persists state + preview
    │
    ▼
Frontend renders
  - chat
  - preview
  - blocker badge
  - confirmation panel if `confirming_section`
  - structured choice card if present
```

---

## 22. Current Architectural Truths

These statements are true of the codebase today:

1. **Workflow is the UI source of truth for confirmation state.**
2. **Preview slots are the main section-readiness abstraction.**
3. **Checklist still exists, but is no longer the only progression authority.**
4. **Direct answers can explicitly confirm the active required slot.**
5. **Structured choice exists, but only for selected friction-heavy slots.**
6. **Assistant wording is partially constrained by workflow, but still not a full interaction-module protocol.**
7. **Review confirmation is backend-triggered, not inferred locally by preview heuristics.**
8. **AI Suggested Content Directions are derived preview content, not a fully separate review-driven workflow section.**

---

## 23. Known Architectural Gaps

The current codebase has already moved far toward deterministic workflow control, but these gaps still exist:

1. The planner still outputs mostly “question-first” decisions rather than a richer generic interaction-module contract.
2. `selectNextPreviewSlot()` can look ahead into later sections, which is useful for planning but can still create mental drift if not strictly bounded by workflow mode.
3. Assistant transition filtering is regex-based, so it reduces but does not fully eliminate narration leakage.
4. Confirmation UI is workflow-driven, but not every future interaction type is yet expressed as a first-class backend UI module.

These are not documentation errors; they are current implementation realities.

---

## 24. Design Principles

1. **Deterministic state mutation**: backend owns all durable state.
2. **Workflow-first review control**: confirmation panels open from workflow truth, not assistant wording.
3. **Meaning capture via LLM**: extraction remains model-assisted so the UX stays flexible and natural.
4. **Preview-slot alignment**: display, blocker logic, and section readiness are all grounded in the same slot layer.
5. **Auditable operations**: tool actions, turn diagnostics, and state updates are logged.
6. **Progressive visibility**: users always see a live preview of what the system currently believes.

# Architecture — AI Strategist Agent System

> Last updated: 2026-03-12
>
> This document describes the **target architecture** for the next refactor of the AI strategist. It is based on lessons from the current implementation, but updates the system to an **agent-centered, interaction-module-driven architecture**.
>
> The current implementation already contains valuable foundations — especially the frontend shell, preview/checklist structures, workflow rendering, persistence, and model-routing ideas. This document keeps those reusable parts and refactors the orchestration model around a true AI agent core.

---

## 1. System Overview

The app is a dual-panel AI strategist that guides a user through a structured strategic interview.

At a high level:

- The **left panel** is a chat workspace where the user answers, asks for help, or discusses.
- The **right panel** is a live, structured strategy/checklist view that reflects deterministic progress.
- At the center is an **AI agent orchestrator** that receives every user message first, identifies the task type of the turn, calls tools/modules, and decides what interaction happens next.

The system is not just a chatbot and not just a form.

It is best understood as:

> a **deterministic interview engine managed by an AI agent orchestrator**

Primary architectural intent:

- preserve natural conversation
- keep progression deterministic
- let AI help users when they are stuck
- separate discussion from state mutation
- make UI interaction modules first-class backend-controlled operations

Target high-level flow:

```text
Frontend chat + live checklist
        │
        ▼
POST /api/interview/message
        │
        ▼
AI Agent Runtime
  receive turn
    → planner step
    → route to task module
    → call tools / UI interaction modules
    → update deterministic state when allowed
    → compose assistant response
        │
        ▼
JSON response
  - assistant message
  - updated checklist / preview
  - workflow state
  - active interaction module
  - optional structured interaction payload
        │
        ▼
Frontend renders
  - chat turn
  - live checklist state
  - confirmation panel
  - option selection panel
  - any future interaction modules
```

---

## 2. Architectural Direction

This refactor changes the center of gravity of the system.

### Current implementation strengths worth keeping

The current codebase already has strong building blocks that should be preserved:

- dual-panel frontend experience
- live preview / checklist rendering
- backend-owned state mutation
- workflow-driven confirmation UI
- structured-choice UI pattern
- PostgreSQL + JSONB persistence model
- model routing abstraction
- audit / telemetry mindset

### What must change

The current implementation is still mostly:

- workflow-first for review UI
- planner/question-first for conversational turn composition

The target architecture should instead become:

- **agent-first for orchestration**
- **interaction-module-first for next-step execution**
- **deterministic checklist-first for durable progress truth**

That means the planner should no longer mainly output “the next question.”
It should output **which task branch to execute** and **which interaction module should be active**.

---

## 3. Responsibility Split

### AI agent-owned responsibilities

- receive every user turn first
- interpret what the user is trying to do in this turn
- run the planner step
- choose the correct task branch
- call tools and UI interaction modules
- generate conversational help, suggestions, and follow-up phrasing
- operate under AGENT.md rules

### Backend-owned responsibilities

- deterministic state mutation
- checklist truth
- section order and completion policy
- workflow / interaction state
- tool execution
- persistence
- model routing and fallback
- audit logs and telemetry

### Frontend-owned responsibilities

- render backend-returned state directly
- render the live checklist / preview
- render active interaction modules
- render confirmation and structured selection UIs
- never infer progression from assistant wording alone

---

## 4. Core Architecture

### 4.1 Top-level modules

The target system has these top-level modules:

1. **Frontend UI**
2. **AI Agent Core**
3. **Planner Step**
4. **Task Execution Modules**
5. **Tool / Interaction Module Layer**
6. **Deterministic Checklist State**
7. **Persistence / Telemetry Layer**
8. **Model Routing Layer**
9. **AGENT.md Prompt System**

### 4.2 Core execution shape

```text
User message
   │
   ▼
AI Agent Core
   │
   ▼
Planner Step
(classify turn)
   │
   ├─ Answer Question
   ├─ Ask for Help About Question
   └─ Other / Discussion
   │
   ▼
Task Execution Module
   │
   ▼
Call tools / interaction modules
   │
   ▼
Update checklist state when allowed
   │
   ▼
Compose assistant response + UI payload
   │
   ▼
Frontend renders
```

---

## 5. Planner Step

The **planner step** is the first major decision point for every turn.

Its job is:

> determine what the user is trying to do in this turn, then assign the correct task branch

The target planner has exactly **three primary task types**.

### 5.1 Task Type A — Answer Question

This is the main path.

Use this branch when the user is directly answering the current strategic question(s).

Examples:

- giving a company description
- describing the audience
- stating goals or preferences
- selecting an option that should become the answer

### 5.2 Task Type B — Ask for Help About Question

Use this branch when the user is not really answering yet, but needs help to answer.

Examples:

- “I’m not sure.”
- “Do you have suggestions?”
- “Can you give me better ideas?”
- “What should I write here?”

This branch should lead to a structured support interaction, not a normal follow-up question.

### 5.3 Task Type C — Other / Discussion

This is the fallback conversational branch.

Use this branch when the user is:

- asking for clarification
- discussing ideas
- chatting about the question
- exploring meaning
- expressing confusion
- doing something that should not directly mutate checklist state

This branch is conversationally useful, but should usually avoid durable checklist mutation.

---

## 6. Task Execution Modules

Each planner outcome routes into a dedicated execution module.

### 6.1 Answer Question Module

This is the main deterministic completion engine.

Workflow:

1. retrieve current checklist state
2. identify which current question / field the user is answering
3. update the corresponding structured answer(s)
4. evaluate whether the current section is complete
5. if complete, activate confirmation interaction
6. if incomplete, ask the next needed question

Possible outcomes:

- updated checklist answers
- updated live preview
- next follow-up question
- section confirmation interaction

### 6.2 Help About Question Module

This module exists to reduce user friction when they do not know how to answer.

Workflow:

1. retrieve current checklist context
2. retrieve relevant conversation history
3. identify the active question / strategic gap
4. generate structured suggestions/options
5. open an option-selection interaction module
6. when the user chooses an option, route that result into the Answer Question Module

This is important:

- help is not a side chat
- help should feed back into deterministic progress

### 6.3 Other / Discussion Module

This module handles open discussion and clarification.

Workflow:

1. retrieve checklist and recent history
2. understand where the user currently is in the interview
3. provide explanation, discussion, or clarification
4. avoid direct checklist mutation unless the turn clearly becomes an answer turn

This module behaves most like a general-purpose AI assistant, but still stays grounded in the structured interview context.

---

## 7. Tool and Interaction Module Layer

The AI agent must have modular tools it can call at any time.

These should be treated as first-class backend capabilities.

### 7.1 Core tool categories

#### State / data tools

- **Checklist Reader**
  - read current checklist state
  - read active section
  - read missing / completed items

- **Checklist Updater**
  - write structured answers
  - mark item status
  - store evidence / provenance

- **History Reader**
  - retrieve recent conversation history
  - retrieve relevant prior discussion for context

- **Session / State Reader**
  - retrieve workflow state
  - retrieve pending interaction state

#### Interaction tools

- **Confirmation Window Tool**
  - open section confirmation UI
  - collect confirmation result

- **Option Selection Tool**
  - open structured suggestion-choice UI
  - collect selected option or `Other`

- **Future Interaction Modules**
  - checkpoint review tool
  - contradiction-resolution tool
  - handoff-to-human tool
  - rewrite-suggestion tool

### 7.2 Key design rule

Every UI interaction that matters to workflow should be represented as a backend-managed tool / interaction module.

The frontend renders it.
The agent activates it.
The backend owns its meaning.

---

## 8. Deterministic Checklist Backbone

The checklist remains the durable structured backbone of the application.

### 8.1 Checklist role

The checklist should continue to provide:

- ordered sections
- required questions
- completion status
- evidence/provenance
- live progress view for the right panel
- section completeness checks

### 8.2 Section model

The strategist currently uses **six ordered sections**.
Each section contains deterministic required items.
The exact wording or display can evolve, but the ordered structure remains stable.

Example shape:

```text
Section 1
  - Question A
  - Question B
  - Question C

Section 2
  - Question A
  - Question B

...

Section 6
```

### 8.3 Checklist truth policy

The checklist should remain the truth for durable progress, but unlike the current implementation, the agent runtime should consult it through explicit tools and execution modules rather than blending it too deeply into question-first planner logic.

### 8.4 Live right-panel behavior

The right panel should remain a **dynamic, live update** of what the system currently believes, based on the deterministic checklist/state model.

This panel is not just visual decoration.
It is the live structured state view of the agent-managed interview.

---

## 9. Workflow and Interaction State

The system still needs workflow state, but it should become more clearly aligned with interaction modules.

### 9.1 Recommended workflow shape

The workflow should track at least:

- active section
- active question / target item
- planner task type for current turn
- pending interaction module
- whether section confirmation is required
- whether generation/handoff/checkpoint is available

### 9.2 Recommended phase framing

A practical target phase model is:

- `interviewing`
- `confirming_section`
- `structured_help_selection`
- `checkpoint`
- `generation_ready`
- `handoff`

Compared with the current implementation, this adds a more explicit interaction-state framing rather than treating everything as question progression plus some conditional UI.

---

## 10. AGENT.md Prompt System

AGENT.md remains essential and should be treated as the behavioral operating manual of the agent.

It should define:

- high-level mission
- planner-step rules
- exact meaning of the three task types
- when checklist mutation is allowed
- when to open interaction modules
- how to ask follow-ups
- how to help without over-advancing
- how to behave during confirmation / discussion / structured choice turns

In short:

> AGENT.md is the soul of the agent, but backend rules remain the durable authority.

---

## 11. Model Layer and Provider Strategy

The model layer must support provider flexibility.

### 11.1 Product requirement

The system should allow the main/default model to be chosen between:

- **OpenAI GPT**
- **Google Gemini**

And the backup model should be:

- **DeepSeek**

### 11.2 Recommended engineering approach

Use a provider-agnostic model layer with explicit routing and fallback.

Recommended stack direction:

- **Vercel AI SDK** for model abstraction, streaming, tool compatibility, and frontend integration
- **provider routing layer** for explicit primary/co-primary selection
- **DeepSeek fallback** for resilient backup behavior

### 11.3 Routing concept

The routing layer should support:

- explicit selected primary provider/model
- optional co-primary provider/model
- hard fallback order
- timeout handling
- telemetry on route used and cost

Example policy:

- primary: user-configurable between GPT and Gemini
- co-primary: the other major provider
- fallback: DeepSeek

---

## 12. Persistence and Telemetry

These parts from the current system are still good and should be preserved.

### 12.1 Persistence

Keep:

- PostgreSQL + JSONB persistence
- in-memory repo for development/tests
- per-session state saving
- message history
- tool action logs
- checkpoint / handoff artifacts when needed

### 12.2 Telemetry

Keep and extend:

- model route used
- token usage
- cost estimation
- tool call logs
- planner trace / task classification trace
- active interaction module trace

This remains important for debugging and trust.

---

## 13. Frontend Architecture

The current dual-panel frontend design should largely remain.

### 13.1 Left panel

Keep:

- chat interface
- input area
- optional active interaction card in input region

### 13.2 Right panel

Keep:

- live checklist / preview
- active-section highlighting
- progress / blocker visibility
- confirmation-focused state cues

### 13.3 New frontend principle

The frontend should become a renderer of **active interaction modules**, not just a renderer of review panels plus optional structured choice.

That means the UI contract should evolve toward:

- `interaction_module.type`
- `interaction_module.payload`
- `workflow_state`
- `updated_preview`

Possible interaction module types:

- `confirm_section`
- `select_help_option`
- `checkpoint_review`
- `resolve_conflict`
- `none`

---

## 14. Recommended API Contract Direction

The main message endpoint can remain, but its response should evolve.

### 14.1 Main turn endpoint

```json
{
  "session_id": "uuid",
  "user_message": "string"
}
```

### 14.2 Recommended response shape

```json
{
  "assistant_message": "string",
  "updated_preview": {},
  "workflow_state": {},
  "planner_task_type": "answer_question | ask_for_help | other_discussion",
  "interaction_module": {
    "type": "confirm_section | select_help_option | none",
    "payload": {}
  },
  "model_route_used": {},
  "tool_trace": [],
  "planner_trace": {}
}
```

This is a cleaner evolution from the current architecture because it makes the next interaction explicit.

---

## 15. Architecture Diagram

```text
┌──────────────────────────────────────────────────────────┐
│                         USER UI                          │
│                                                          │
│  ┌─────────────────────────┐   ┌───────────────────────┐ │
│  │      Chat Interface     │   │   Live Checklist UI   │ │
│  │       (Left Panel)      │   │    (Right Panel)      │ │
│  └──────────────┬──────────┘   └───────────┬───────────┘ │
└─────────────────┼──────────────────────────┼─────────────┘
                  │                          │
                  ▼                          │
        ┌───────────────────────────────┐    │
        │          AI AGENT CORE        │◄───┘
        │       (Core Orchestrator)     │
        └───────────────┬───────────────┘
                        │
                        ▼
              ┌───────────────────────┐
              │      PLANNER STEP     │
              │   (Turn Classifier)   │
              └───────┬───────┬──────┘
                      │       │
      ┌───────────────┘       └───────────────┐
      ▼                                       ▼
┌───────────────┐                     ┌──────────────────┐
│ ANSWER TASK   │                     │ OTHER / DISCUSS  │
│ MODULE        │                     │ MODULE           │
└───────┬───────┘                     └────────┬─────────┘
        │                                      │
        ▼                                      ▼
┌────────────────────┐                ┌──────────────────┐
│ Read Checklist     │                │ Read Context     │
│ Update Answers     │                │ Clarify / Explain│
│ Check Completion   │                │ No direct write  │
└───────┬────────────┘                └──────────────────┘
        │
        ▼
┌────────────────────┐
│ Section complete?  │
└───────┬────────────┘
        │
  ┌─────┴─────┐
  ▼           ▼
 NO           YES
 │            │
 ▼            ▼
Ask next      Activate confirmation
question      interaction module


Planner alternate branch:

┌───────────────────────┐
│ HELP ABOUT QUESTION   │
│ MODULE                │
└──────────┬────────────┘
           ▼
   Read checklist + history
           ▼
   Generate structured suggestions
           ▼
   Activate option-selection module
           ▼
   User selects option
           ▼
   Route selected option into
   Answer Task Module
```

---

## 16. What We Keep vs Refactor

### 16.1 Keep

These current concepts are still valuable and should be reused:

- dual-panel app structure
- backend-owned mutation
- persistence layer
- model routing abstraction
- workflow-driven confirmation idea
- structured choice UI pattern
- checklist data structure mindset
- telemetry / audit logging
- preview as live structured state view

### 16.2 Refactor

These are the main changes:

1. replace question-first planner framing with **task-type planner framing**
2. make interaction modules first-class backend contracts
3. let “help me answer” become a dedicated module, not just a phrasing variation
4. simplify durable truth around checklist progression
5. reduce narration drift by making the interaction contract explicit
6. reframe the system around a true **AI agent core** rather than a workflow pipeline that only partially behaves like an agent

---

## 17. Practical Engineering Recommendation

For implementation, the most suitable engineering direction is:

- keep the current **Next.js + TypeScript** application base
- keep a **provider-agnostic model layer**
- use **Vercel AI SDK** for multi-provider model access, structured output support, streaming, and UI integration
- keep backend-owned orchestration logic rather than delegating product truth to a generic autonomous agent framework
- optionally use a workflow runtime only if it helps express the planner/task branches cleanly

The key point is:

> do not outsource the product logic to a generic agent framework

The real product value is the deterministic planner/task/checklist system.
The agent runtime should support that system, not replace it.

---

## 18. Design Principles

1. **AI agent as orchestrator**: every turn starts with the agent core.
2. **Deterministic durable truth**: backend owns checklist progression and persistence.
3. **Task-type planning before question phrasing**: first decide what kind of turn this is.
4. **Interaction-module-first UI control**: important UI behaviors are backend-managed modules.
5. **Natural but bounded conversation**: AI stays helpful without owning state truth.
6. **Reusable modular tools**: checklist, history, confirmation, and structured selection should all be callable tools.
7. **Provider flexibility**: GPT and Gemini as primary choices, DeepSeek as backup.
8. **Auditability**: tool calls, planner decisions, and routing should be observable.

---

## 19. Summary

The current implementation already proved several good ideas, especially around frontend rendering, preview/checklist visibility, backend-controlled truth, confirmation UI, and model routing.

The next architecture should preserve those strengths while refactoring the center of the system into:

- an **AI agent core**
- a **planner step with three task types**
- dedicated **execution modules**
- modular **interaction tools**
- and a deterministic **checklist backbone**

That is the target architecture this project should now move toward.
