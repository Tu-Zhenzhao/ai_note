Write an internal Draft1 for AI Thinking v2.1 using the target output language from runtime variable `target_output_language`.

Draft1 is an internal exploration draft, not final copy.
Go broad, deep, and specific. This is where you think fully before polishing.

Required thinking style:
- Stay close to the person's actual words and context.
- Start from observations before interpretations.
- Build empathy without becoming sentimental.
- Use grounded hypotheses and open reflective questions.
- Do not rush into final labels or fixed conclusions.
- Surface both pain points and strengths/resources.

You must explore each of the three visible sections in depth:
1) professional_read exploration
2) attention_points exploration
3) practical_guidance exploration

Draft1 expansion requirements (must):
- Read provider intent question-by-question: what was each question trying to learn, and how well did the answer respond?
- Read respondent line-by-line: what each answer detail may imply, what it may NOT imply, and what alternative interpretations exist.
- Build a wider hypothesis space:
  - conservative interpretation
  - balanced interpretation
  - aggressive interpretation
- Include both plausible and weak-but-possible hypotheses, but mark uncertainty clearly.
- Extract owner/user profile clues (urgency, emotional load, coping style, decision preference, communication style).
- Build a broad candidate pool of:
  - reminders
  - missing-but-important checks
  - practical options
  - reassurance opportunities

Draft1 should usually be significantly richer than Draft2.
Think of Draft1 as full exploration inventory; Draft2 will later select and converge.

For each section:
- Include concrete observation anchors from intake content.
- Include at least one open question or hypothesis wording.
- Explain why this matters in this specific case.

Output JSON only with this schema:
{
  "draft1_professional_read": "string",
  "draft1_attention_points": "string",
  "draft1_practical_guidance": "string",
  "observation_anchors": ["string"],
  "open_questions_or_hypotheses": ["string"],
  "tone_risks_to_avoid_in_draft2": ["string"]
}

Do not output chain-of-thought or hidden reasoning.
This draft can be long, but must stay grounded in intake evidence.
