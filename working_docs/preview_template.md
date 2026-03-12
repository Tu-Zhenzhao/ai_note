# Document 4 — Preview Template
**Project:** AI Content Strategist Interviewer
**Version:** Agent Checkpoint Preview v2
**Language:** English
**Scope:** User-facing preview and checkpoint behavior between interview and generation

## 1. Purpose

The preview is the checkpoint surface between:
- conversational interview
and
- generation

It should help the user immediately understand:
- what the system now believes
- what changed recently
- what is still weak or unconfirmed
- whether generation is appropriate yet

The preview is not the source of truth.
It is a user-facing projection of internal state.

## 2. Core UX Goal

The preview should feel like:
- a strategist summary
- a live working brief
- a checkpoint for alignment

It should not feel like:
- raw internal state
- debug output
- database fields rendered on screen

## 3. Required Sections

The preview contains six main sections:

1. `Company Understanding`
2. `Audience Understanding`
3. `LinkedIn Content Strategy`
4. `Evidence & Proof Assets`
5. `AI Suggested Content Directions`
6. `Generation Plan`

## 4. Required Meta Areas

The preview should also include:
- completion score
- generation readiness
- strategist confidence indicators
- verification indicators (what has been confirmed by the user vs inferred)
- what changed this turn
- weak areas
- missing areas
- unconfirmed areas
- next recommended step

## 5. Header

Title:
`Content Strategy Preview`

Subtitle:
`Here is how I currently understand your company and how LinkedIn content could work for you. Please review this before we generate the first content piece.`

## 6. Completion Status Block

Show:
- `Completion Score`
- `Generation Readiness`
- `Checkpoint Status`
- verification coverage

Confidence indicators:
- company understanding
- audience clarity
- evidence strength
- content strategy clarity
- verification confidence

## 7. Section 1 — Company Understanding

Show:
- company summary
- short brand story
- main offering
- problem solved
- differentiator

The writing should sound like a strategist summary, not a raw transcript.

## 8. Section 2 — Audience Understanding

Show:
- primary audience
- core problems
- desired outcomes
- who the company wants to attract on LinkedIn

## 9. Section 3 — LinkedIn Content Strategy

Show:
- main content goal
- content positioning
- target impact
- topics to emphasize
- topics to avoid if useful

## 10. Section 4 — Evidence & Proof Assets

Show:
- narrative proof
- metrics / proof points
- supporting assets
- evidence confidence level
- missing proof areas

This section should make it obvious whether the first content piece can be proof-backed.

## 11. Section 5 — AI Suggested Content Directions

Show three directions:
- one primary
- two alternatives

Each direction should show:
- topic
- format
- angle
- why it fits current understanding

## 12. Section 6 — Generation Plan

Show:
- planned first topic
- planned format
- intended structure
- audience fit
- proof plan

This section should answer:
`If we generate now, what exactly will we make first?`

## 13. Turn Delta Block

This should be visible in the preview or nearby UI.

Show:
- what changed from the last user answer
- which sections were updated
- what was newly captured
- what remains open
- whether any items moved to "confirmed"

This helps the user see that the system is learning and updating its understanding continuously.

## 14. Open Items Block

Show in human language:

- Still missing
- Still weak
- Needs confirmation

Items should be phrased as strategist questions rather than schema fields.

Bad:
- company_profile.company_one_liner

Good:
- A sharper one‑sentence explanation of what your company does

Open items should also indicate priority where useful:

- critical before generation
- helpful but optional

## 15. Confirmation Targets

The preview should support confirmation chips or lightweight confirmation actions for important items such as:
- company one-liner
- primary audience
- main content goal
- first topic

### Verification Indicators

Important preview statements may include lightweight verification indicators such as:

- Confirmed by you
- Inferred from conversation
- Needs confirmation

These indicators help the user quickly see which parts of the strategist understanding are reliable and which still require validation.

## 16. Editing Path

The user should be able to say:
- `not exactly`
- `use this wording instead`
- `this part is sensitive`
- `this is not public`

Those corrections should update internal state, not only the UI.

## 17. Generation Gating Rule

The preview may recommend generation only when:
- readiness is high enough
- hard blockers are cleared
- the user has approved the checkpoint

The `Generate First Brief` action must remain blocked until approval is complete.

## 18. Tone Rule

Preview text should be:
- clear
- concise
- strategic
- human-readable

It should not:
- over-explain
- expose internal diagnostics
- read like a machine report

## 19. Example Summary Pattern

A good preview summary sounds like:

`You help operations and IT teams make their internal files searchable through an API-based product. The main LinkedIn opportunity is to build authority around practical search infrastructure and attract technical buyers who are tired of manual document retrieval.`

That is the tone target.

## 20. Summary

The preview in v2 is:

`a live strategist checkpoint, not a debug panel`

That is the correct design goal.
