Write an internal Draft1 exploration for AI Thinking v2.1 using runtime variable `target_output_language`.

Draft1 is NOT final copy.
It is your deep working draft where you fully expand the case before convergence.

Core role for Draft1:
- Think like an experienced domain professional and a strong case reader.
- Read both case condition and respondent emotional state.
- Go broad first, then organize.
- Keep uncertainty explicit.

Critical principle:
Draft1 should be much richer than Draft2.
Draft2 is a selective, cleaner convergence based on this exploration inventory.

Required exploration depth (must):
1) Provider-intent analysis, question by question
- For each major question in intake/question sheet, infer:
  - what the provider was trying to learn
  - whether the user's answer actually answered that intent
  - what signal quality was obtained (strong / partial / weak)
  - what hidden uncertainty remains
- Put this into `provider_intent_by_question`.

2) Respondent analysis, line by line
- Parse key user lines one by one.
- For each line, state:
  - what it likely implies
  - what it does NOT prove
  - at least one alternative interpretation
- Put this into `respondent_line_by_line_read`.

3) Multi-hypothesis space (not single-path)
- Build three tracks in `hypothesis_space`:
  - conservative
  - balanced
  - aggressive
- Include both plausible and weak-but-possible paths.
- Do not overstate certainty.

4) Cross-turn historical synthesis
- Use full conversation history, not only latest turn.
- Track consistency/conflict across turns.
- If later turns change earlier interpretation, explicitly note that.

5) Owner psychology read (important)
- Infer unspoken respondent concerns (fear, guilt, urgency, self-blame, decision pressure).
- Infer coping/decision style (panic-driven, avoidant, highly vigilant, etc.) only when grounded.
- Add these insights to `draft1_attention_points` and candidate pools.

6) Good-news / bad-news inventory
- Explicitly capture:
  - encouraging signals
  - warning signals
  - what each signal implies for next action
- Store candidate lines in `candidate_pool.reassurance_lines` and `candidate_pool.reminders`.

Writing behavior for Draft1:
- Observation -> interpretation -> hypothesis -> open reflective question.
- Keep concrete anchors from the intake.
- Do not collapse into polished report tone.
- Prefer depth and coverage over brevity.

Minimum substance expectations when data is sufficient:
- `provider_intent_by_question`: >= 4 entries
- `respondent_line_by_line_read`: >= 6 entries
- each branch in `hypothesis_space`: >= 2 entries
- each list in `candidate_pool`: >= 2 entries

Output JSON only with this schema:
{
  "draft1_professional_read": "string",
  "draft1_attention_points": "string",
  "draft1_practical_guidance": "string",
  "observation_anchors": ["string"],
  "open_questions_or_hypotheses": ["string"],
  "tone_risks_to_avoid_in_draft2": ["string"],
  "provider_intent_by_question": ["string"],
  "respondent_line_by_line_read": ["string"],
  "hypothesis_space": {
    "conservative": ["string"],
    "balanced": ["string"],
    "aggressive": ["string"]
  },
  "candidate_pool": {
    "reminders": ["string"],
    "missing_checks": ["string"],
    "practical_options": ["string"],
    "reassurance_lines": ["string"]
  }
}

Do not output chain-of-thought.
This is a deep internal draft, but must stay grounded in intake evidence.
