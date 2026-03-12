# Document 1 — Interview State Schema
**Project:** AI Content Strategist Interviewer
**Version:** Agent Checklist Schema v2
**Language:** English
**Scope:** Runtime state for conversational interviewing, checklist tracking, preview projection, and generation gating

## 1. Purpose

This schema exists to support an AI agent loop that:
- interviews users conversationally
- updates structured understanding after every turn
- tracks which strategic questions are answered well enough
- builds a live preview
- decides whether to continue, checkpoint, handoff, or generate

The schema is not designed for a linear survey.
It is designed for a planner-driven runtime.

## 2. Design Principles

1. `conversation-first`
One user answer may update many structured fields.

2. `checklist-backed`
The backend must know which strategic questions are still open.

3. `tool-friendly`
The schema should be easy for tools to update safely.

4. `generation-oriented`
The state should directly support brief and content generation.

5. `human-readable`
Internal state can be technical, but it should support clean preview summaries.

## 3. High-Level Modules

The interview state contains 14 major modules:

1. `conversation_meta`
2. `company_profile`
3. `brand_story`
4. `product_service`
5. `market_audience`
6. `linkedin_content_strategy`
7. `content_preferences`
8. `content_dislikes`
9. `evidence_library`
10. `constraints_and_boundaries`
11. `user_concerns`
12. `content_readiness`
13. `system_assessment`
14. `preview_projection`

## 4. Field Status Model

Every major field should support:
- `value`
- `status`
- optional `confidence`
- optional `source_turn_ids`
- optional `last_updated_at`
- optional `ai_suggested`

Allowed field status values:
- `missing`
- `partial`
- `strong`
- `verified`

Field updates should also include an optional `verification_state` separate from `status` when needed.

Recommended verification states:
- `unverified`
- `user_confirmed`
- `ai_inferred`
- `contradicted`

This separation allows the system to track both completeness and verification independently.

## 5. Checklist Model

The checklist is the runtime bridge between natural conversation and structured state.

Each checklist item represents one business question the system cares about.

### 5.1 Checklist Item Shape

Each item should support:
- `id`
- `module`
- `question_label`
- `question_intent`
- `status`
- `answer_summary`
- `evidence_for_answer`
- `evidence_confidence`
- `supporting_turn_ids`
- `filled_from_fields`
- `priority`
- `last_touched_turn_id`
- `verification_needed`

### 5.2 Checklist Item Status
- `unanswered`
- `partial`
- `answered`
- `verified`
- `not_applicable`

### 5.3 Checklist Rule
Checklist items are not asked one-by-one in order.
They are evaluated globally on each turn.

## 6. conversation_meta

Purpose: runtime tracking for the agent loop.

Required fields:
- `interview_id`
- `language`
- `interview_stage`
- `user_engagement_level`
- `needs_human_review`
- `handoff_reason`
- `current_focus_modules`
- `current_focus_checklist_ids`
- `last_planner_move`
- `last_planner_reason`
- `model_provider`
- `model_name`
- `tool_call_trace_ids`
- `runtime_version`
- `state_schema_version`

Recommended enums:
- `interview_stage`: `opening`, `discovery`, `clarification`, `checkpoint`, `generation_planning`, `handoff`, `completed`
- `user_engagement_level`: `low`, `medium`, `high`

## 7. Strategy Modules

The following modules still matter and should remain structured:

### 7.1 company_profile
Core questions:
- What does the company do?
- What category does it belong to?
- What business model fits best?

### 7.2 brand_story
Core questions:
- Why does the company exist?
- What does it believe?
- What should people remember?

### 7.3 product_service
Core questions:
- What is the main offering?
- What problem does it solve?
- Why is it different?

### 7.4 market_audience
Core questions:
- Who is the primary audience?
- What do they struggle with?
- What outcomes do they want?

### 7.5 linkedin_content_strategy
Core questions:
- Why use LinkedIn?
- What should content achieve?
- What topics and formats make sense?

### 7.6 content_preferences
Core questions:
- What should the output feel like?
- What tone, voice, and style are preferred?

### 7.7 content_dislikes
Core questions:
- What should content avoid stylistically?

### 7.8 evidence_library
Core questions:
- What proof exists?
- What assets exist?
- What support material can be used?

### 7.9 constraints_and_boundaries
Core questions:
- What should not be said?
- What is sensitive or non-public?

### 7.10 user_concerns
Core questions:
- What worries the user about AI-generated content?

### 7.11 content_readiness
Core questions:
- What is the first plausible topic?
- What is the first plausible format?
- What still blocks first content generation?

## 8. system_assessment

This module becomes much more important in v2.

It should include:
- `field_completion_map`
- `module_completion_map`
- `checklist_completion_map`
- `global_completion_score`
- `missing_fields`
- `weak_fields`
- `unconfirmed_fields`
- `open_checklist_items`
- `resolved_checklist_items`
- `follow_up_candidates`
- `pending_conflicts`
- `user_fatigue_risk`
- `checkpoint_recommended`
- `checkpoint_approved`
- `generation_blockers`
- `last_turn_diagnostics`
- `last_planner_action`
- `last_question_style`
- `last_user_facing_progress_note`
- `model_route_used`
- `tool_calls_this_turn`
- `state_updates_this_turn`
- `planner_confidence`

## 9. last_turn_diagnostics

This is internal-only runtime support.

It should capture:
- `direct_user_facts`
- `assistant_inferences`
- `captured_fields_this_turn`
- `captured_checklist_items_this_turn`
- `deferred_fields`
- `conflicts_detected`
- `question_reason`
- `tool_actions_used`

## 10. preview_projection

The preview remains derived-only.

It should support:
- company understanding
- audience understanding
- LinkedIn strategy
- evidence and proof assets
- suggested directions
- generation plan
- what changed this turn
- what remains open
- confirmation targets

The preview must never become the source of truth.

## 11. Chat Memory Support

If a chat-book or memory layer exists, it should store:
- user facts
- assistant inferences
- unresolved conflicts
- checkpoint summaries
- strategic notes

This memory layer is supportive, but canonical truth still belongs to structured state plus checklist status.

## 12. Update Rules

After each user turn:

1. update any direct fields supported by the answer
2. update any checklist items that can be advanced
3. mark conflicts if contradictions appear
4. recompute module completion
5. recompute global readiness
6. rebuild preview

The system should prefer broad update coverage over single-field fixation.

## 13. Verification Rule

Verification should happen when the system restates an important understanding and the user confirms it.

Strong candidates for verification:
- company one-liner
- primary audience
- main LinkedIn goal
- first content direction
- sensitive boundaries

## 14. Summary

The schema is no longer just a set of interview fields.
It is:

`structured business state + checklist state + planner state + preview projection`

That combination supports the agent loop.

## 15. Runtime Metadata

To support debugging, observability, and replayability of the agent system, the runtime should track additional metadata alongside the main interview state.

Suggested fields:

- `planner_trace`
  - chronological log of planner decisions

- `tool_execution_log`
  - ordered list of tool calls and results

- `model_routing_history`
  - records which model handled each turn (Gemini, GPT‑5, DeepSeek fallback)

- `state_change_log`
  - structured diff of state changes after each turn

- `checkpoint_history`
  - record of checkpoint previews and approvals

This metadata should not influence business logic directly but must be available for debugging, analytics, and evaluation of the strategist system.
