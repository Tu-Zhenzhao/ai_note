# Document 2 — Completion Rules
**Project:** AI Content Strategist Interviewer
**Version:** Agent Completion Framework v2
**Language:** English
**Scope:** Completion logic for interview continuation, checkpointing, generation readiness, and handoff readiness

## 1. Purpose

This document defines how the system judges whether it should:
- keep interviewing
- summarize and confirm
- recommend checkpoint
- allow generation
- prepare handoff

Completion is based on the **current usable state**, not on whether the AI asked a predefined path of questions.

## 2. Core Principle

The system should evaluate completion after every turn from the full state:
- structured fields
- checklist status
- evidence strength
- consistency
- boundary clarity
- checkpoint status

The system must not assume progress just because the conversation is long.

## 3. Global Completion Levels

### 3.1 `incomplete`
Use when one or more critical generation areas are still too weak.

Typical cases:
- company is not clear
- audience is too broad
- LinkedIn goal is vague
- proof is absent
- first direction is not usable

### 3.2 `minimally_ready`
Use when there is enough useful understanding for summary and strategic thinking, but not enough for reliable autonomous generation.

Typical cases:
- strong narrative exists
- company and audience are mostly understandable
- but proof is weak or strategy is still too fuzzy

### 3.3 `generation_ready`
Use when the system can generate the first content brief with acceptable confidence.

This requires:
- hard-required modules strong enough
- no major unresolved blocker
- checkpoint approval

### 3.4 `handoff_ready`
Use when the session is valuable but too sensitive, complex, contradictory, or custom for autonomous generation.

## 4. Evaluation Dimensions

Completion must consider all of these:

1. `coverage`
Were the important business questions answered?

2. `specificity`
Are the answers concrete enough to use?

3. `consistency`
Do the answers fit together?

4. `evidence strength`
Is there enough proof for the first content piece?

5. `strategic usability`
Can the system propose a coherent first direction?

6. `boundary safety`
Are constraints clear enough?

7. `checkpoint stability`
Has the system reflected understanding back before generation?

8. `verification reliability`
Are important statements confirmed by the user or only inferred by the AI?

## 5. Completion Inputs

The completion engine should consume:
- module status
- checklist item status
- unresolved conflicts
- evidence readiness
- confirmation state
- fatigue risk
- checkpoint approval
- evidence confidence
- verification state
- model routing diagnostics
- planner confidence

## 6. Hard-Required Modules for `generation_ready`

These must be `strong` or `verified`:
- `company_profile`
- `brand_story`
- `product_service`
- `market_audience`
- `linkedin_content_strategy`
- `content_preferences`
- `evidence_library`

## 7. Allowed Partial Modules at Generation Time

These may remain `partial` if clearly flagged:
- `content_dislikes`
- `constraints_and_boundaries`
- `user_concerns`
- `content_readiness`

If partial, the system must:
- show them in preview
- treat confidence as lower
- optionally recommend follow-up after first output

## 8. Hard Blockers

Generation must remain blocked if any of these are true:
- company one-liner is still vague
- primary audience is unclear
- main LinkedIn goal is unclear
- proof/evidence requirement is not satisfied
- major safety boundary is unclear
- checkpoint has not been approved

## 9. Evidence Rule

Narrative alone is not enough for `generation_ready`.

The system should require at least:
- one usable narrative/proof anchor
and
- one support layer

Examples of narrative/proof anchors:
- case story
- milestone
- founder story with strategic relevance

Examples of support layer:
- metric
- screenshot
- testimonial
- source material
- asset library item

Without both layers, the session may become `minimally_ready` but not `generation_ready`.

Evidence strength should also consider confidence levels:

- high: explicit user confirmation + concrete supporting material
- medium: clear narrative with partial support
- low: inferred narrative without proof

Low-confidence evidence should prevent the system from moving to `generation_ready`.

## 10. Checklist Completion Rule

Checklist completion should inform readiness more directly than question count.

The engine should ask:
- are the key company questions answered?
- are the key audience questions answered?
- are the key strategy questions answered?
- are the key proof questions answered?
- are the key boundary questions answered enough?

The engine should not ask:
- did the AI walk the whole interview script?

## 11. Checkpoint Recommendation Rule

The system may recommend checkpoint before full readiness when:
- core modules show good progress
- user fatigue increases
- enough summary value exists
- remaining gaps are explicit and manageable

The system should prefer an earlier checkpoint rather than extending the interview indefinitely when:

- the core narrative appears stable
- remaining gaps are secondary
- user responses become shorter or slower

Early checkpoint improves user trust and prevents interview fatigue.

## 12. Generation Permission Rule

Generation permission should only be true when:
- completion level is `generation_ready`
- hard blockers are zero
- verification coverage for critical fields is sufficient
- checkpoint is approved

Score alone must never override these gates.

## 13. Handoff Rule

The system should move toward handoff when:
- repeated contradictions remain
- the user keeps correcting central framing
- the session contains strong sensitivity/compliance issues
- multiple competing strategic directions remain unresolved
- the system has useful information but unstable confidence

## 14. AI Suggestions Rule

The system may suggest missing framing when the user struggles.
But AI-suggested values should not be treated as fully reliable until the user confirms or clearly accepts them.

## 15. Completion Output

The completion engine should produce:
- `completion_level`
- `completion_score`
- `generation_permission_flag`
- `missing_fields`
- `weak_fields`
- `unconfirmed_fields`
- `open_checklist_items`
- `red_line_blockers`
- `checkpoint_recommended`
- `next_best_move`
- `verification_coverage`
- `evidence_confidence_score`
- `planner_confidence`
- `model_route_used`

These outputs help the system explain why generation was allowed or blocked.

## 16. Summary

Completion in v2 means:

`enough trustworthy state to support the next system move`

Sometimes that move is:
- another question
- a confirmation
- a checkpoint
- a handoff
- or generation

That is the correct framing.
