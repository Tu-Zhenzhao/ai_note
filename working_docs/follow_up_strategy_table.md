# Document 3 — Follow-up Strategy Table
**Project:** AskMore (多问AI)
**Version:** Agent Follow-up Framework v2
**Language:** English
**Scope:** Next-move selection, question strategy, fallback ladders, and stopping rules

## 1. Purpose

This document defines how the AI should decide what to do next after each user turn.

The key shift in v2:
- the AI is not following a fixed interview script
- the AI is evaluating the full state on every turn
- question ladders are fallback tools, not the main runtime logic

## 2. First Rule

After every user answer, the system should ask:

1. What new information did I learn?
2. Which checklist items can now be advanced?
3. Which items moved toward "confirmed" vs only "inferred"?
4. Which conflicts or contradictions appeared?
5. Did the evidence strength improve?
6. Is the strategist understanding strong enough to summarize?
7. What is the best next move for the whole interview?

That question comes before any escalation ladder.

## 3. Allowed Next Moves

The planner may choose one of these:
- `ask`
- `confirm`
- `summarize`
- `checkpoint`
- `handoff`
- `generate_brief`

Constraint:
- exactly one primary move must be chosen per turn
- optional secondary action may occur internally (tool calls, preview rebuild, checklist updates)

## 4. User-Facing Response Styles

Allowed response styles:
- `reflect_and_advance`
- `synthesize_and_confirm`
- `resolve_conflict_once`
- `checkpoint_summary`
- `guided_choice`
- `handoff_explain`

Forbidden user-facing behavior:
- exposing schema keys
- exposing raw diagnostics
- repeating the same question wording on adjacent turns without reason
- sounding like a form or support bot

## 5. Question Budget

Default:
- one main question per turn

Allowed exception:
- a second short binary confirmation question

The system should avoid multi-question bundles.

Exception:
- a summarize + confirm pair is allowed when stabilizing interpretation

## 6. Main Decision Rules

### 6.1 Prefer broad capture over narrow probing
If one answer advances multiple areas, capture all of them immediately.
Do not continue asking adjacent scripted questions just because they were next in a ladder.

### 6.2 Prefer summarize-and-confirm when signal is already strong
If the user already gave a rich answer, the next move should often be:
- summarize what the system now understands
- confirm one important point
- then move on

### 6.3 Use ladders only when a critical area remains weak
Ladders exist to help the system recover clarity, not to control the whole interview.

### 6.4 Resolve contradiction once
If two meaningful answers conflict:
- ask one explicit reconciliation question
- if still unresolved, lower confidence and continue
- do not loop

### 6.5 Fatigue changes strategy
When fatigue rises:
- use guided choices
- shorten questions
- prioritize high-impact areas
- recommend checkpoint earlier

### 6.6 Prefer verification before deeper probing
If a strong interpretation already exists but has not been user-confirmed:
- prefer `confirm` over asking new exploratory questions

This stabilizes the strategist understanding before expanding the interview.

## 7. Fallback Question Types

Supported types:
- `open`
- `clarify`
- `contrast`
- `example`
- `confirm`
- `ai_suggest`
- `proof_request`
- `narrow`

## 8. Fallback Ladder

Default fallback ladder:
- `open`
- `clarify`
- `example`
- `ai_suggest`
- `confirm`

Escalation variant (when signal is extremely weak):
- `contrast`
- `guided_choice`
- `narrow`
- `confirm`

## 9. Max Repetition Rule

No question template should repeat on adjacent turns unless:
- there is an unresolved contradiction
- the user directly asked for repetition
- the system is doing a binary confirmation on a reframed summary

If repetition risk appears, shift to:
- summarize
- confirm
- or checkpoint

## 10. Attempt Rule

Do not think in rigid “three attempts per field” terms as the primary runtime model.
Instead:
- use a small number of focused recovery attempts
- if progress stalls, mark the area weak and move on

A good default:
- one normal ask
- one reframed ask
- one guided/confirming recovery attempt

After that:
- downgrade confidence
- keep momentum

## 11. Priority Under Fatigue

When the user is tired or giving short answers, stabilize these first:

1. `linkedin_content_strategy`
2. `market_audience`
3. `company_profile`
4. `product_service`
5. `brand_story`
6. `evidence_library`

Lower priority under fatigue:

7. `content_preferences`
8. `constraints_and_boundaries`
9. `user_concerns`
10. `content_dislikes`
11. `content_readiness`

## 12. Example Strategy by Area

### 12.1 company_profile
Goal:
- get a clear one-liner
- understand category/business model

Good moves:
- ask for plain-English company description
- summarize into one sentence and confirm
- use contrast only if category remains muddy

### 12.2 brand_story
Goal:
- understand why the company exists

Good moves:
- ask what triggered the company
- pull a strategic narrative from a rich answer
- confirm the central mission or belief

### 12.3 product_service
Goal:
- clarify offering, problem solved, differentiator

Good moves:
- ask what customers get
- ask what changes for the customer
- ask why this is better than alternatives

### 12.4 market_audience
Goal:
- define the primary audience and their pains

Good moves:
- ask who benefits most
- narrow if the audience is too broad
- summarize the likely ICP and confirm

### 12.5 linkedin_content_strategy
Goal:
- understand why LinkedIn matters and what success means

Good moves:
- ask what content should achieve
- contrast authority vs leads vs education when needed
- move early here if fatigue is rising

### 12.6 evidence_library
Goal:
- identify proof, assets, and usable support

Good moves:
- ask what proof exists
- ask what is easiest to share first
- request metrics/assets only when the strategy is already meaningful

## 13. Stop Conditions

The system should stop asking on a topic when:
- enough usable signal exists
- the answer can already support the next system step
- further probing would feel repetitive
- the area can safely remain weak for now

### Checkpoint Trigger Rule

The planner should prefer moving to `checkpoint` when:

- core company understanding is strong
- audience definition is stable
- initial LinkedIn strategy is defined
- no critical contradictions remain

The checkpoint should occur even if some secondary areas remain weak.

This keeps the interview momentum and allows the user to review the strategist understanding early.

## 14. Summary

The v2 follow-up model is:

`global planner first, fallback ladder second`

That is the intended behavior.
