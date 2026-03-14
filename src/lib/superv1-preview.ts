type VerificationState =
  | "confirmed_by_user"
  | "inferred_from_conversation"
  | "needs_confirmation";

type SuperV1AnswerStatus = "empty" | "filled" | "needs_clarification" | "confirmed";

export interface SuperV1AnswerView {
  question_id: string;
  status: SuperV1AnswerStatus;
  value: unknown;
  confidence: number | null;
  evidence_text: string | null;
}

export interface SuperV1StateForPreview {
  answers: SuperV1AnswerView[];
  ai_suggested_directions?: {
    ai_suggested_directions?: Array<{
      id?: "dir_1" | "dir_2" | "dir_3";
      title?: string;
      target_audience?: string;
      core_insight?: string;
      content_angle?: string;
      suggested_formats?: string[];
      example_hook?: string;
      proof_to_use?: string[];
      risk_boundary_check?: string;
      why_fit?: string;
      execution_difficulty?: "Low" | "Medium" | "High";
    }>;
    recommendation_summary?: {
      best_starting_direction_id?: "dir_1" | "dir_2" | "dir_3";
      reason?: string;
      first_week_plan?: string[];
    };
  } | null;
}

type SuperV1Preview = Record<string, unknown>;

const QUESTION_LABELS: Record<string, string> = {
  cp_what_does_company_do: "What does the company do?",
  cp_category: "What category does it belong to?",
  cp_business_model: "What business model fits best?",
  bs_why_exist: "Why does the company exist?",
  bs_what_believe: "What does it believe?",
  bs_what_remember: "What should people remember?",
  ps_main_offering: "What is the main offering?",
  ps_problem_solved: "What problem does it solve?",
  ps_why_different: "Why is it different?",
  ma_primary_audience: "Who is the primary audience?",
  ma_struggles: "What do they struggle with?",
  ma_outcomes: "What outcomes do they want?",
  ma_linkedin_attraction_goal: "Who should be attracted on LinkedIn?",
  lcs_what_achieve: "What should content achieve?",
  lcs_topics_formats: "What topics and formats make sense?",
  cpref_feel: "What should the output feel like?",
  cpref_tone_voice_style: "What tone, voice, and style are preferred?",
  cdis_avoid_style: "What should content avoid stylistically?",
  ev_proof: "What proof exists?",
  ev_assets: "What assets exist?",
  ev_support: "What support material can be used?",
  cb_not_said: "What should not be said?",
  cb_sensitive: "What is sensitive or non-public?",
  uc_worries: "What worries the user about AI-generated content?",
  cr_first_topic: "What is the first plausible topic?",
  cr_first_format: "What is the first plausible format?",
  cr_blockers: "What still blocks first content generation?",
};

function normalizeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => normalizeText(item))
      .map((item) => item.trim())
      .filter(Boolean);
    return parts.join(", ");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const preferredKeys = ["label", "name", "title", "description", "value", "text"];
    for (const key of preferredKeys) {
      const text = normalizeText(obj[key]);
      if (text) return text;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function normalizeTextList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n;,]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const one = normalizeText(value);
  return one ? [one] : [];
}

function statusToVerification(status: SuperV1AnswerStatus): VerificationState {
  if (status === "confirmed") return "confirmed_by_user";
  if (status === "needs_clarification") return "needs_confirmation";
  return "inferred_from_conversation";
}

function statusToSlotStatus(status: SuperV1AnswerStatus): "missing" | "weak" | "strong" | "verified" {
  if (status === "empty") return "missing";
  if (status === "needs_clarification") return "weak";
  if (status === "confirmed") return "verified";
  return "strong";
}

function buildVerificationIndicators(
  answers: Map<string, SuperV1AnswerView>,
  questionIds: string[],
): Array<{ label: string; state: VerificationState }> {
  const indicators: Array<{ label: string; state: VerificationState }> = [];
  for (const questionId of questionIds) {
    const answer = answers.get(questionId);
    if (!answer || answer.status === "empty") continue;
    indicators.push({
      label: QUESTION_LABELS[questionId] ?? questionId,
      state: statusToVerification(answer.status),
    });
  }
  return indicators;
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
}

export function buildPreviewFromSuperV1State(state: SuperV1StateForPreview): SuperV1Preview {
  const answers = new Map(state.answers.map((answer) => [answer.question_id, answer]));
  const getValue = (questionId: string) => answers.get(questionId)?.value ?? null;
  const companySummary = normalizeText(getValue("cp_what_does_company_do"));
  const shortBrandStory = firstNonEmpty(
    getValue("bs_why_exist"),
    getValue("bs_what_believe"),
    getValue("bs_what_remember"),
  );
  const mainOffering = normalizeText(getValue("ps_main_offering"));
  const problemSolved = normalizeText(getValue("ps_problem_solved"));
  const differentiator = normalizeText(getValue("ps_why_different"));

  const primaryAudience = normalizeText(getValue("ma_primary_audience"));
  const coreProblems = normalizeTextList(getValue("ma_struggles"));
  const desiredOutcomes = normalizeTextList(getValue("ma_outcomes"));
  const attractionGoal = normalizeText(getValue("ma_linkedin_attraction_goal"));

  const mainContentGoal = normalizeText(getValue("lcs_what_achieve"));
  const topicsAndFormats = normalizeTextList(getValue("lcs_topics_formats"));
  const contentPositioning = firstNonEmpty(getValue("cpref_tone_voice_style"), getValue("cpref_feel"));
  const topicsToAvoid = normalizeTextList(getValue("cdis_avoid_style"));

  const narrativeProof = normalizeTextList(getValue("ev_proof"));
  const metricsProofPoints = normalizeTextList(getValue("ev_proof"));
  const supportingAssets = normalizeTextList(getValue("ev_assets"));
  const missingProofAreas = normalizeTextList(getValue("cr_blockers"));
  const confidenceScore = [
    answers.get("ev_proof"),
    answers.get("ev_assets"),
  ].reduce((max, answer) => {
    if (!answer?.confidence) return max;
    return Math.max(max, answer.confidence);
  }, 0);
  const evidenceConfidenceLevel = confidenceScore >= 0.85 ? "high" : confidenceScore >= 0.75 ? "medium" : "low";

  const firstTopic = normalizeText(getValue("cr_first_topic"));
  const firstFormat = normalizeText(getValue("cr_first_format"));
  const proofPlan = firstNonEmpty(getValue("ev_support"), getValue("cr_blockers"), getValue("ev_proof"));
  const preferredTone = normalizeTextList(getValue("cpref_feel"));
  const voiceAndStyle = [
    ...normalizeTextList(getValue("cpref_tone_voice_style")),
  ];
  const avoidStyle = normalizeTextList(getValue("cdis_avoid_style"));
  const boundaries = [
    ...normalizeTextList(getValue("cb_not_said")),
    ...normalizeTextList(getValue("cb_sensitive")),
  ];
  const concerns = normalizeTextList(getValue("uc_worries"));

  const aiDirectionsFromState = state.ai_suggested_directions?.ai_suggested_directions ?? [];
  const aiSuggestedDirections = aiDirectionsFromState
    .map((direction) => ({
      id: direction.id ?? "",
      title: direction.title ?? "",
      target_audience: direction.target_audience ?? "",
      core_insight: direction.core_insight ?? "",
      angle: direction.content_angle ?? "",
      suggested_formats: direction.suggested_formats ?? [],
      example_hook: direction.example_hook ?? "",
      proof_to_use: direction.proof_to_use ?? [],
      risk_boundary_check: direction.risk_boundary_check ?? "",
      why_it_fits: direction.why_fit ?? "",
      execution_difficulty: direction.execution_difficulty ?? "Medium",
    }))
    .filter((direction) => direction.title || direction.angle || direction.example_hook);
  const aiRecommendation = state.ai_suggested_directions?.recommendation_summary ?? null;

  return {
    sections: {
      company_understanding: {
        company_summary: companySummary,
        short_brand_story: shortBrandStory,
        main_offering: mainOffering,
        problem_solved: problemSolved,
        differentiator,
        verification: buildVerificationIndicators(answers, [
          "cp_what_does_company_do",
          "bs_why_exist",
          "bs_what_believe",
          "bs_what_remember",
          "ps_main_offering",
          "ps_problem_solved",
          "ps_why_different",
        ]),
      },
      audience_understanding: {
        primary_audience: primaryAudience,
        core_problems: coreProblems,
        desired_outcomes: desiredOutcomes,
        who_to_attract_on_linkedin: attractionGoal,
        verification: buildVerificationIndicators(answers, [
          "ma_primary_audience",
          "ma_struggles",
          "ma_outcomes",
          "ma_linkedin_attraction_goal",
        ]),
      },
      linkedin_content_strategy: {
        main_content_goal: mainContentGoal,
        content_positioning: contentPositioning,
        topics_to_emphasize: topicsAndFormats,
        topics_to_avoid: topicsToAvoid,
        verification: buildVerificationIndicators(answers, [
          "lcs_what_achieve",
          "lcs_topics_formats",
          "cpref_tone_voice_style",
          "cdis_avoid_style",
        ]),
      },
      evidence_and_proof_assets: {
        narrative_proof: narrativeProof,
        metrics_proof_points: metricsProofPoints,
        supporting_assets: supportingAssets,
        missing_proof_areas: missingProofAreas,
        evidence_confidence_level: evidenceConfidenceLevel,
        verification: buildVerificationIndicators(answers, ["ev_proof", "ev_assets", "cr_blockers"]),
      },
      content_preferences_and_boundaries: {
        preferred_tone: preferredTone,
        voice_and_style: voiceAndStyle,
        avoid_style: avoidStyle,
        boundaries,
        concerns,
        verification: buildVerificationIndicators(answers, [
          "cpref_feel",
          "cpref_tone_voice_style",
          "cdis_avoid_style",
          "cb_not_said",
          "cb_sensitive",
          "uc_worries",
        ]),
      },
      ai_suggested_content_directions: aiSuggestedDirections,
      generation_plan: {
        planned_first_topic: firstTopic,
        planned_format: firstFormat,
        intended_structure: topicsAndFormats.slice(0, 3),
        audience_fit: firstNonEmpty(attractionGoal, primaryAudience),
        proof_plan: proofPlan,
        verification: buildVerificationIndicators(answers, ["cr_first_topic", "cr_first_format", "cr_blockers"]),
      },
      ai_suggested_recommendation: aiRecommendation,
    },
    internal_preview: {
      preview_slots: state.answers.map((answer) => ({
        id: answer.question_id,
        label: QUESTION_LABELS[answer.question_id] ?? answer.question_id,
        question_label: QUESTION_LABELS[answer.question_id] ?? answer.question_id,
        status: statusToSlotStatus(answer.status),
        verification_state: statusToVerification(answer.status),
      })),
    },
  };
}
