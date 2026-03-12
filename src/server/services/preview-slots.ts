import {
  InterviewState,
  PreviewSectionId,
  PreviewSlot,
  PreviewSlotStatus,
  StatusValue,
  VerificationState,
} from "@/lib/types";

export const PREVIEW_SECTION_ORDER: Array<{
  id: PreviewSectionId;
  name: string;
  modules: string[];
}> = [
  {
    id: "company_understanding",
    name: "Company Understanding",
    modules: ["company_profile", "brand_story", "product_service"],
  },
  {
    id: "audience_understanding",
    name: "Audience Understanding",
    modules: ["market_audience"],
  },
  {
    id: "linkedin_content_strategy",
    name: "LinkedIn Content Strategy",
    modules: ["linkedin_content_strategy"],
  },
  {
    id: "evidence_and_proof_assets",
    name: "Evidence & Proof Assets",
    modules: ["evidence_library"],
  },
  {
    id: "content_preferences_and_boundaries",
    name: "Content Preferences & Boundaries",
    modules: [
      "content_preferences",
      "content_dislikes",
      "constraints_and_boundaries",
      "user_concerns",
    ],
  },
  {
    id: "generation_plan",
    name: "Generation Plan",
    modules: ["content_readiness"],
  },
];

export const PREVIEW_SLOT_IDS_BY_SECTION: Record<PreviewSectionId, string[]> = {
  company_understanding: [
    "company_understanding.company_summary",
    "company_understanding.brand_story",
    "company_understanding.main_offering",
    "company_understanding.problem_solved",
    "company_understanding.differentiator",
  ],
  audience_understanding: [
    "audience_understanding.primary_audience",
    "audience_understanding.core_problems",
    "audience_understanding.desired_outcomes",
    "audience_understanding.linkedin_attraction_goal",
  ],
  linkedin_content_strategy: [
    "linkedin_content_strategy.main_content_goal",
    "linkedin_content_strategy.content_positioning",
    "linkedin_content_strategy.topics_and_formats",
    "linkedin_content_strategy.topics_to_avoid",
  ],
  evidence_and_proof_assets: [
    "evidence_and_proof_assets.proof_anchor",
    "evidence_and_proof_assets.supporting_assets",
  ],
  content_preferences_and_boundaries: [
    "content_preferences_and_boundaries.preferred_tone",
    "content_preferences_and_boundaries.voice_and_style",
    "content_preferences_and_boundaries.avoid_style",
    "content_preferences_and_boundaries.boundaries",
    "content_preferences_and_boundaries.concerns",
  ],
  generation_plan: [
    "generation_plan.first_topic",
    "generation_plan.first_format",
    "generation_plan.proof_plan",
  ],
};

export function isSlotOpenForCompletion(slot: PreviewSlot): boolean {
  if (slot.status === "missing" || slot.status === "weak") return true;
  // Explicit policy: Audience LinkedIn-attraction intent must be user-confirmed.
  if (
    slot.id === "audience_understanding.linkedin_attraction_goal" &&
    slot.verification_state !== "user_confirmed"
  ) {
    return true;
  }
  return false;
}

export function getTargetFieldForSlotId(state: InterviewState, slotId: string): string | null {
  const slot = getPreviewSlots(state).find((entry) => entry.id === slotId);
  return slot?.question_target_field ?? null;
}

type StatusLike = {
  status: string;
  verification_state?: VerificationState;
  last_updated_at?: string;
};

function firstOrFallback(arr: string[], fallback: string) {
  return arr.length > 0 ? arr[0] : fallback;
}

function latestTimestamp(...values: Array<StatusLike | undefined>): string | null {
  const timestamps = values
    .map((value) => value?.last_updated_at)
    .filter((value): value is string => !!value)
    .sort();
  return timestamps[timestamps.length - 1] ?? null;
}

function previewStatusFromField(status: string): PreviewSlotStatus {
  if (status === "verified") return "verified";
  if (status === "strong") return "strong";
  if (status === "partial") return "weak";
  return "missing";
}

function verificationFromFields(
  ...values: Array<StatusLike | undefined>
): VerificationState | "mixed" {
  const states = Array.from(
    new Set(
      values
        .map((value) => value?.verification_state)
        .filter((value): value is VerificationState => !!value),
    ),
  );

  if (states.length === 0) return "unverified";
  if (states.length === 1) return states[0];
  if (states.includes("user_confirmed")) return "mixed";
  if (states.includes("ai_inferred")) return "ai_inferred";
  return "mixed";
}

function allStrong(...statuses: PreviewSlotStatus[]): boolean {
  return statuses.every((status) => status === "strong" || status === "verified");
}

function anyPresent(...statuses: PreviewSlotStatus[]): boolean {
  return statuses.some((status) => status !== "missing");
}

function anyStrong(...statuses: PreviewSlotStatus[]): boolean {
  return statuses.some((status) => status === "strong" || status === "verified");
}

function countStrong(...statuses: PreviewSlotStatus[]): number {
  return statuses.filter((status) => status === "strong" || status === "verified").length;
}

function buildCompanySummary(state: InterviewState): string {
  const parts: string[] = [];
  const name = state.company_profile.company_name.value;
  const oneLiner = state.company_profile.company_one_liner.value;
  const industry = state.company_profile.industry.value;
  const model = state.company_profile.business_model.value;

  if (name && oneLiner) {
    parts.push(`${name} — ${oneLiner}`);
  } else if (oneLiner) {
    parts.push(oneLiner);
  } else if (name) {
    parts.push(name);
  }

  if (industry.length > 0) {
    parts.push(`Category: ${industry.join(", ")}`);
  }
  if (model.length > 0) {
    parts.push(`Model: ${model.join(", ")}`);
  }

  return parts.join(". ") || "Company details not captured yet.";
}

function buildBrandStorySummary(state: InterviewState): string {
  const founding = state.brand_story.founding_story.value;
  const mission = state.brand_story.mission_statement.value;
  const belief = state.brand_story.core_belief.value;
  const remember = state.brand_story.what_should_people_remember.value;

  const parts = [founding, mission, belief, remember].filter(Boolean);
  return parts.join(" ").trim() || "Narrative still being refined.";
}

function buildProofPlan(state: InterviewState): string {
  const evidenceNarratives = state.evidence_library.case_studies.value
    .map((entry) => entry.title)
    .slice(0, 3);
  return evidenceNarratives.length > 0
    ? `Anchor on: ${evidenceNarratives[0]}`
    : "No proof anchor yet — may need a case or metric first.";
}

function buildSlot(input: Omit<PreviewSlot, "value" | "display_value"> & {
  value?: string | string[];
  displayValue?: string | string[];
}): PreviewSlot {
  return {
    ...input,
    value: input.value ?? input.displayValue ?? "",
    display_value: input.displayValue ?? input.value ?? "",
  };
}

function applySlotConfirmationOverrides(state: InterviewState, slots: PreviewSlot[]): PreviewSlot[] {
  const confirmedSlotIds = new Set(state.system_assessment.confirmed_slot_ids ?? []);
  if (confirmedSlotIds.size === 0) return slots;
  return slots.map((slot) =>
    confirmedSlotIds.has(slot.id)
      ? { ...slot, verification_state: "user_confirmed" }
      : slot,
  );
}

export function confirmPreviewSlots(state: InterviewState, slotIds: string[]) {
  const existing = new Set(state.system_assessment.confirmed_slot_ids ?? []);
  for (const slotId of slotIds) {
    existing.add(slotId);
  }
  state.system_assessment.confirmed_slot_ids = Array.from(existing);
}

export function confirmPreviewSectionSlots(state: InterviewState, sectionId: PreviewSectionId) {
  confirmPreviewSlots(state, PREVIEW_SLOT_IDS_BY_SECTION[sectionId] ?? []);
}

export function buildPreviewSlots(state: InterviewState): PreviewSlot[] {
  const companySummaryStatus = previewStatusFromField(
    state.company_profile.company_one_liner.status,
  );
  const companyIndustryStatus = previewStatusFromField(state.company_profile.industry.status);
  const companyModelStatus = previewStatusFromField(
    state.company_profile.business_model.status,
  );

  const foundingStatus = previewStatusFromField(state.brand_story.founding_story.status);
  const missionStatus = previewStatusFromField(state.brand_story.mission_statement.status);
  const beliefStatus = previewStatusFromField(state.brand_story.core_belief.status);
  const rememberStatus = previewStatusFromField(
    state.brand_story.what_should_people_remember.status,
  );

  const brandStoryStrong =
    (anyStrong(foundingStatus, missionStatus, beliefStatus) &&
      anyStrong(rememberStatus, beliefStatus, missionStatus)) ||
    countStrong(foundingStatus, missionStatus, beliefStatus, rememberStatus) >= 2;
  const brandStoryPresent = anyPresent(
    foundingStatus,
    missionStatus,
    beliefStatus,
    rememberStatus,
  );

  const offeringStatus = previewStatusFromField(state.product_service.primary_offering.status);
  const problemStatus = previewStatusFromField(state.product_service.problem_solved.status);
  const diffStatus = previewStatusFromField(
    state.product_service.key_differentiators.status,
  );

  const audienceStatus = previewStatusFromField(state.market_audience.primary_audience.status);
  const painStatus = previewStatusFromField(
    state.market_audience.audience_pain_points.status,
  );
  const outcomeStatus = previewStatusFromField(
    state.market_audience.audience_desired_outcomes.status,
  );
  const attractionStatus = previewStatusFromField(
    state.market_audience.attraction_goal.status,
  );

  const contentGoalStatus = previewStatusFromField(
    state.linkedin_content_strategy.primary_content_goal.status,
  );
  const positioningStatus = previewStatusFromField(
    state.linkedin_content_strategy.desired_brand_perception.status,
  );
  const topicsStatus = previewStatusFromField(
    state.linkedin_content_strategy.topics_they_want_to_talk_about.status,
  );
  const formatsStatus = previewStatusFromField(
    state.linkedin_content_strategy.desired_content_formats.status,
  );
  const avoidTopicsStatus = previewStatusFromField(
    state.linkedin_content_strategy.topics_to_avoid_or_deprioritize.status,
  );

  const caseStudyStatus = previewStatusFromField(state.evidence_library.case_studies.status);
  const metricStatus = previewStatusFromField(
    state.evidence_library.metrics_and_proof_points.status,
  );
  const assetStatus = previewStatusFromField(state.evidence_library.assets.status);

  const toneStatus = previewStatusFromField(state.content_preferences.preferred_tone.status);
  const voiceStatus = previewStatusFromField(state.content_preferences.preferred_voice.status);
  const styleStatus = previewStatusFromField(
    state.content_preferences.preferred_style_tags.status,
  );
  const dislikeStatus = previewStatusFromField(state.content_dislikes.disliked_tone.status);
  const boundaryStatus = previewStatusFromField(
    state.constraints_and_boundaries.forbidden_topics.status,
  );
  const concernStatus = previewStatusFromField(state.user_concerns.main_concerns.status);

  const firstTopicStatus = previewStatusFromField(
    state.content_readiness.ai_suggested_first_content_topic.status,
  );
  const firstFormatStatus = previewStatusFromField(
    state.content_readiness.ai_suggested_first_content_format.status,
  );

  const slots = [
    buildSlot({
      id: "company_understanding.company_summary",
      section: "company_understanding",
      label: "Company summary",
      question_label: "What does the company do?",
      question_intent: "Capture a clear one-line description of the company.",
      question_target_field: "company_profile.company_one_liner",
      status: companySummaryStatus === "missing" && anyPresent(companyIndustryStatus, companyModelStatus)
        ? "weak"
        : companySummaryStatus,
      verification_state: verificationFromFields(
        state.company_profile.company_one_liner,
        state.company_profile.industry,
        state.company_profile.business_model,
      ),
      source_fields: [
        "company_profile.company_one_liner",
        "company_profile.industry",
        "company_profile.business_model",
      ],
      checklist_item_ids: ["cp_what_does_company_do", "cp_category", "cp_business_model"],
      required_for_section_completion: true,
      blocking_priority: "critical",
      last_updated_at: latestTimestamp(
        state.company_profile.company_one_liner,
        state.company_profile.industry,
        state.company_profile.business_model,
      ),
      displayValue: buildCompanySummary(state),
    }),
    buildSlot({
      id: "company_understanding.brand_story",
      section: "company_understanding",
      label: "Brand story",
      question_label:
        "What core belief drives the company, and what do you want people to remember most?",
      question_intent: "Capture the deeper why behind the brand, not just the product.",
      question_target_field: "brand_story.core_belief",
      status: brandStoryStrong
        ? rememberStatus === "verified" || beliefStatus === "verified" || missionStatus === "verified"
          ? "verified"
          : "strong"
        : brandStoryPresent
          ? "weak"
          : "missing",
      verification_state: verificationFromFields(
        state.brand_story.founding_story,
        state.brand_story.mission_statement,
        state.brand_story.core_belief,
        state.brand_story.what_should_people_remember,
      ),
      source_fields: [
        "brand_story.founding_story",
        "brand_story.mission_statement",
        "brand_story.core_belief",
        "brand_story.what_should_people_remember",
      ],
      checklist_item_ids: ["bs_why_exist", "bs_what_believe", "bs_what_remember"],
      required_for_section_completion: true,
      blocking_priority: "high",
      last_updated_at: latestTimestamp(
        state.brand_story.founding_story,
        state.brand_story.mission_statement,
        state.brand_story.core_belief,
        state.brand_story.what_should_people_remember,
      ),
      displayValue: buildBrandStorySummary(state),
    }),
    buildSlot({
      id: "company_understanding.main_offering",
      section: "company_understanding",
      label: "Main offering",
      question_label: "What is the main product or service you offer?",
      question_intent: "Capture the primary offering in plain language.",
      question_target_field: "product_service.primary_offering",
      status: offeringStatus,
      verification_state: verificationFromFields(state.product_service.primary_offering),
      source_fields: ["product_service.primary_offering"],
      checklist_item_ids: ["ps_main_offering"],
      required_for_section_completion: true,
      blocking_priority: "critical",
      last_updated_at: latestTimestamp(state.product_service.primary_offering),
      displayValue:
        state.product_service.primary_offering.value?.name ||
        state.product_service.primary_offering.value?.description ||
        "",
    }),
    buildSlot({
      id: "company_understanding.problem_solved",
      section: "company_understanding",
      label: "Problem solved",
      question_label: "What problem does the product solve?",
      question_intent: "Capture the core pain the company addresses.",
      question_target_field: "product_service.problem_solved",
      status: problemStatus,
      verification_state: verificationFromFields(state.product_service.problem_solved),
      source_fields: ["product_service.problem_solved"],
      checklist_item_ids: ["ps_problem_solved"],
      required_for_section_completion: true,
      blocking_priority: "critical",
      last_updated_at: latestTimestamp(state.product_service.problem_solved),
      displayValue: state.product_service.problem_solved.value,
    }),
    buildSlot({
      id: "company_understanding.differentiator",
      section: "company_understanding",
      label: "Differentiator",
      question_label: "What makes your approach different from alternatives?",
      question_intent: "Capture the clearest differentiator versus other options.",
      question_target_field: "product_service.key_differentiators",
      status: diffStatus,
      verification_state: verificationFromFields(state.product_service.key_differentiators),
      source_fields: ["product_service.key_differentiators"],
      checklist_item_ids: ["ps_why_different"],
      required_for_section_completion: true,
      blocking_priority: "high",
      last_updated_at: latestTimestamp(state.product_service.key_differentiators),
      displayValue: state.product_service.key_differentiators.value,
    }),

    buildSlot({
      id: "audience_understanding.primary_audience",
      section: "audience_understanding",
      label: "Primary audience",
      question_label: "Who is the primary audience?",
      question_intent: "Define the clearest buyer or user group.",
      question_target_field: "market_audience.primary_audience",
      status: audienceStatus,
      verification_state: verificationFromFields(state.market_audience.primary_audience),
      source_fields: ["market_audience.primary_audience", "market_audience.audience_roles"],
      checklist_item_ids: ["ma_primary_audience"],
      required_for_section_completion: true,
      blocking_priority: "critical",
      last_updated_at: latestTimestamp(
        state.market_audience.primary_audience,
        state.market_audience.audience_roles,
      ),
      displayValue:
        state.market_audience.primary_audience.value?.label ||
        "Primary audience not confirmed yet",
    }),
    buildSlot({
      id: "audience_understanding.core_problems",
      section: "audience_understanding",
      label: "Core problems",
      question_label: "What do they struggle with today?",
      question_intent: "Capture the audience's concrete pain points.",
      question_target_field: "market_audience.audience_pain_points",
      status: painStatus,
      verification_state: verificationFromFields(state.market_audience.audience_pain_points),
      source_fields: ["market_audience.audience_pain_points"],
      checklist_item_ids: ["ma_struggles"],
      required_for_section_completion: true,
      blocking_priority: "high",
      last_updated_at: latestTimestamp(state.market_audience.audience_pain_points),
      displayValue: state.market_audience.audience_pain_points.value,
    }),
    buildSlot({
      id: "audience_understanding.desired_outcomes",
      section: "audience_understanding",
      label: "Desired outcomes",
      question_label: "What outcomes do they want most?",
      question_intent: "Capture the result the audience hopes to achieve.",
      question_target_field: "market_audience.audience_desired_outcomes",
      status: outcomeStatus,
      verification_state: verificationFromFields(
        state.market_audience.audience_desired_outcomes,
      ),
      source_fields: ["market_audience.audience_desired_outcomes"],
      checklist_item_ids: ["ma_outcomes"],
      required_for_section_completion: true,
      blocking_priority: "high",
      last_updated_at: latestTimestamp(state.market_audience.audience_desired_outcomes),
      displayValue: state.market_audience.audience_desired_outcomes.value,
    }),
    buildSlot({
      id: "audience_understanding.linkedin_attraction_goal",
      section: "audience_understanding",
      label: "Who to attract on LinkedIn",
      question_label:
        "Who exactly do you want to attract on LinkedIn from this audience?",
      question_intent: "Capture the LinkedIn-facing attraction goal for the audience.",
      question_target_field: "market_audience.attraction_goal",
      status: attractionStatus,
      verification_state: verificationFromFields(state.market_audience.attraction_goal),
      source_fields: ["market_audience.attraction_goal"],
      checklist_item_ids: ["ma_linkedin_attraction_goal"],
      required_for_section_completion: true,
      blocking_priority: "high",
      last_updated_at: latestTimestamp(state.market_audience.attraction_goal),
      displayValue: state.market_audience.attraction_goal.value,
    }),

    buildSlot({
      id: "linkedin_content_strategy.main_content_goal",
      section: "linkedin_content_strategy",
      label: "Main content goal",
      question_label: "What should LinkedIn content achieve for the business?",
      question_intent: "Define the main business goal for LinkedIn content.",
      question_target_field: "linkedin_content_strategy.primary_content_goal",
      status: contentGoalStatus,
      verification_state: verificationFromFields(
        state.linkedin_content_strategy.primary_content_goal,
      ),
      source_fields: ["linkedin_content_strategy.primary_content_goal"],
      checklist_item_ids: ["lcs_what_achieve"],
      required_for_section_completion: true,
      blocking_priority: "critical",
      last_updated_at: latestTimestamp(state.linkedin_content_strategy.primary_content_goal),
      displayValue: state.linkedin_content_strategy.primary_content_goal.value,
    }),
    buildSlot({
      id: "linkedin_content_strategy.content_positioning",
      section: "linkedin_content_strategy",
      label: "Content positioning",
      question_label: "How should your brand be perceived through content?",
      question_intent: "Capture the desired positioning or perception in-market.",
      question_target_field: "linkedin_content_strategy.desired_brand_perception",
      status: positioningStatus,
      verification_state: verificationFromFields(
        state.linkedin_content_strategy.desired_brand_perception,
      ),
      source_fields: ["linkedin_content_strategy.desired_brand_perception"],
      checklist_item_ids: [],
      required_for_section_completion: false,
      blocking_priority: "medium",
      last_updated_at: latestTimestamp(
        state.linkedin_content_strategy.desired_brand_perception,
      ),
      displayValue: state.linkedin_content_strategy.desired_brand_perception.value,
    }),
    buildSlot({
      id: "linkedin_content_strategy.topics_and_formats",
      section: "linkedin_content_strategy",
      label: "Topics and formats",
      question_label: "What topics and formats make the most sense on LinkedIn?",
      question_intent: "Capture the subjects and formats that fit the strategy.",
      question_target_field: "linkedin_content_strategy.topics_they_want_to_talk_about",
      status:
        allStrong(topicsStatus, formatsStatus)
          ? topicsStatus === "verified" || formatsStatus === "verified"
            ? "verified"
            : "strong"
          : anyPresent(topicsStatus, formatsStatus)
            ? "weak"
            : "missing",
      verification_state: verificationFromFields(
        state.linkedin_content_strategy.topics_they_want_to_talk_about,
        state.linkedin_content_strategy.desired_content_formats,
      ),
      source_fields: [
        "linkedin_content_strategy.topics_they_want_to_talk_about",
        "linkedin_content_strategy.desired_content_formats",
      ],
      checklist_item_ids: ["lcs_topics_formats"],
      required_for_section_completion: true,
      blocking_priority: "high",
      last_updated_at: latestTimestamp(
        state.linkedin_content_strategy.topics_they_want_to_talk_about,
        state.linkedin_content_strategy.desired_content_formats,
      ),
      displayValue: [
        ...state.linkedin_content_strategy.topics_they_want_to_talk_about.value,
        ...state.linkedin_content_strategy.desired_content_formats.value,
      ],
    }),
    buildSlot({
      id: "linkedin_content_strategy.topics_to_avoid",
      section: "linkedin_content_strategy",
      label: "Topics to avoid",
      question_label: "Are there topics or styles you want to avoid on LinkedIn?",
      question_intent: "Capture any topics or styles to avoid or deprioritize.",
      question_target_field:
        "linkedin_content_strategy.topics_to_avoid_or_deprioritize",
      status: avoidTopicsStatus,
      verification_state: verificationFromFields(
        state.linkedin_content_strategy.topics_to_avoid_or_deprioritize,
      ),
      source_fields: ["linkedin_content_strategy.topics_to_avoid_or_deprioritize"],
      checklist_item_ids: [],
      required_for_section_completion: false,
      blocking_priority: "low",
      last_updated_at: latestTimestamp(
        state.linkedin_content_strategy.topics_to_avoid_or_deprioritize,
      ),
      displayValue: state.linkedin_content_strategy.topics_to_avoid_or_deprioritize.value,
    }),

    buildSlot({
      id: "evidence_and_proof_assets.proof_anchor",
      section: "evidence_and_proof_assets",
      label: "Proof anchor",
      question_label: "What proof, case, metric, or milestone can support your content?",
      question_intent: "Capture at least one concrete proof element for credibility.",
      question_target_field: "evidence_library.case_studies",
      status:
        anyStrong(caseStudyStatus, metricStatus)
          ? caseStudyStatus === "verified" || metricStatus === "verified"
            ? "verified"
            : "strong"
          : anyPresent(caseStudyStatus, metricStatus)
            ? "weak"
            : "missing",
      verification_state: verificationFromFields(
        state.evidence_library.case_studies,
        state.evidence_library.metrics_and_proof_points,
      ),
      source_fields: [
        "evidence_library.case_studies",
        "evidence_library.metrics_and_proof_points",
        "evidence_library.milestones_and_updates",
      ],
      checklist_item_ids: ["ev_proof"],
      required_for_section_completion: true,
      blocking_priority: "critical",
      last_updated_at: latestTimestamp(
        state.evidence_library.case_studies,
        state.evidence_library.metrics_and_proof_points,
      ),
      displayValue: [
        ...state.evidence_library.case_studies.value.map((entry) => entry.title),
        ...state.evidence_library.metrics_and_proof_points.value.map(
          (metric) => `${metric.metric_name}: ${metric.metric_value}`,
        ),
      ],
    }),
    buildSlot({
      id: "evidence_and_proof_assets.supporting_assets",
      section: "evidence_and_proof_assets",
      label: "Supporting assets",
      question_label: "What supporting assets or source material can we use?",
      question_intent: "Capture reusable assets, links, or source material.",
      question_target_field: "evidence_library.assets",
      status:
        anyStrong(assetStatus, previewStatusFromField(state.evidence_library.strongest_proof_points.status))
          ? "strong"
          : anyPresent(assetStatus)
            ? "weak"
            : "missing",
      verification_state: verificationFromFields(
        state.evidence_library.assets,
        state.evidence_library.strongest_proof_points,
      ),
      source_fields: [
        "evidence_library.assets",
        "evidence_library.source_material_links",
        "evidence_library.strongest_proof_points",
      ],
      checklist_item_ids: ["ev_assets", "ev_support"],
      required_for_section_completion: false,
      blocking_priority: "medium",
      last_updated_at: latestTimestamp(
        state.evidence_library.assets,
        state.evidence_library.strongest_proof_points,
      ),
      displayValue: state.evidence_library.assets.value.map((asset) => asset.asset_name),
    }),

    buildSlot({
      id: "content_preferences_and_boundaries.preferred_tone",
      section: "content_preferences_and_boundaries",
      label: "Preferred tone",
      question_label: "What should your content feel like?",
      question_intent: "Capture the tone the content should have.",
      question_target_field: "content_preferences.preferred_tone",
      status: toneStatus,
      verification_state: verificationFromFields(state.content_preferences.preferred_tone),
      source_fields: ["content_preferences.preferred_tone"],
      checklist_item_ids: ["cpref_feel"],
      required_for_section_completion: true,
      blocking_priority: "medium",
      last_updated_at: latestTimestamp(state.content_preferences.preferred_tone),
      displayValue: state.content_preferences.preferred_tone.value,
    }),
    buildSlot({
      id: "content_preferences_and_boundaries.voice_and_style",
      section: "content_preferences_and_boundaries",
      label: "Voice and style",
      question_label: "What voice and style should the content use?",
      question_intent: "Capture stylistic preferences that shape the content.",
      question_target_field: "content_preferences.preferred_style_tags",
      status:
        allStrong(voiceStatus, styleStatus)
          ? voiceStatus === "verified" || styleStatus === "verified"
            ? "verified"
            : "strong"
          : anyPresent(voiceStatus, styleStatus)
            ? "weak"
            : "missing",
      verification_state: verificationFromFields(
        state.content_preferences.preferred_voice,
        state.content_preferences.preferred_style_tags,
      ),
      source_fields: [
        "content_preferences.preferred_voice",
        "content_preferences.preferred_style_tags",
      ],
      checklist_item_ids: ["cpref_tone_voice_style"],
      required_for_section_completion: true,
      blocking_priority: "medium",
      last_updated_at: latestTimestamp(
        state.content_preferences.preferred_voice,
        state.content_preferences.preferred_style_tags,
      ),
      displayValue: [
        ...state.content_preferences.preferred_voice.value,
        ...state.content_preferences.preferred_style_tags.value,
      ],
    }),
    buildSlot({
      id: "content_preferences_and_boundaries.avoid_style",
      section: "content_preferences_and_boundaries",
      label: "Avoided style",
      question_label: "What should the content avoid stylistically?",
      question_intent: "Capture styles or patterns that should be avoided.",
      question_target_field: "content_dislikes.disliked_tone",
      status: dislikeStatus,
      verification_state: verificationFromFields(state.content_dislikes.disliked_tone),
      source_fields: [
        "content_dislikes.disliked_tone",
        "content_dislikes.disliked_messaging_patterns",
      ],
      checklist_item_ids: ["cdis_avoid_style"],
      required_for_section_completion: false,
      blocking_priority: "low",
      last_updated_at: latestTimestamp(
        state.content_dislikes.disliked_tone,
        state.content_dislikes.disliked_messaging_patterns,
      ),
      displayValue: [
        ...state.content_dislikes.disliked_tone.value,
        ...state.content_dislikes.disliked_messaging_patterns.value,
      ],
    }),
    buildSlot({
      id: "content_preferences_and_boundaries.boundaries",
      section: "content_preferences_and_boundaries",
      label: "Boundaries",
      question_label: "What topics, claims, or information should not appear publicly?",
      question_intent: "Capture hard content boundaries before generation.",
      question_target_field: "constraints_and_boundaries.forbidden_topics",
      status: boundaryStatus,
      verification_state: verificationFromFields(
        state.constraints_and_boundaries.forbidden_topics,
      ),
      source_fields: [
        "constraints_and_boundaries.forbidden_topics",
        "constraints_and_boundaries.claims_policy",
      ],
      checklist_item_ids: ["cb_not_said", "cb_sensitive"],
      required_for_section_completion: true,
      blocking_priority: "high",
      last_updated_at: latestTimestamp(
        state.constraints_and_boundaries.forbidden_topics,
        state.constraints_and_boundaries.claims_policy,
      ),
      displayValue: [
        ...state.constraints_and_boundaries.forbidden_topics.value,
        state.constraints_and_boundaries.claims_policy.value,
      ].filter(Boolean),
    }),
    buildSlot({
      id: "content_preferences_and_boundaries.concerns",
      section: "content_preferences_and_boundaries",
      label: "User concerns",
      question_label: "What worries you most about AI-generated content?",
      question_intent: "Capture concerns that need to be respected in the output.",
      question_target_field: "user_concerns.main_concerns",
      status: concernStatus,
      verification_state: verificationFromFields(state.user_concerns.main_concerns),
      source_fields: ["user_concerns.main_concerns"],
      checklist_item_ids: ["uc_worries"],
      required_for_section_completion: false,
      blocking_priority: "low",
      last_updated_at: latestTimestamp(state.user_concerns.main_concerns),
      displayValue: state.user_concerns.main_concerns.value,
    }),

    buildSlot({
      id: "generation_plan.first_topic",
      section: "generation_plan",
      label: "First topic",
      question_label: "What is the first plausible topic we should generate?",
      question_intent: "Lock the strongest first-topic direction.",
      question_target_field: "content_readiness.ai_suggested_first_content_topic",
      status: firstTopicStatus,
      verification_state: verificationFromFields(
        state.content_readiness.ai_suggested_first_content_topic,
      ),
      source_fields: ["content_readiness.ai_suggested_first_content_topic"],
      checklist_item_ids: ["cr_first_topic"],
      required_for_section_completion: true,
      blocking_priority: "high",
      last_updated_at: latestTimestamp(
        state.content_readiness.ai_suggested_first_content_topic,
      ),
      displayValue:
        state.content_readiness.ai_suggested_first_content_topic.value ||
        "Core customer problem and practical solution",
    }),
    buildSlot({
      id: "generation_plan.first_format",
      section: "generation_plan",
      label: "First format",
      question_label: "What format should the first piece use?",
      question_intent: "Choose the strongest starting format.",
      question_target_field: "content_readiness.ai_suggested_first_content_format",
      status: firstFormatStatus,
      verification_state: verificationFromFields(
        state.content_readiness.ai_suggested_first_content_format,
      ),
      source_fields: ["content_readiness.ai_suggested_first_content_format"],
      checklist_item_ids: ["cr_first_format"],
      required_for_section_completion: true,
      blocking_priority: "medium",
      last_updated_at: latestTimestamp(
        state.content_readiness.ai_suggested_first_content_format,
      ),
      displayValue:
        state.content_readiness.ai_suggested_first_content_format.value ||
        firstOrFallback(
          state.linkedin_content_strategy.desired_content_formats.value,
          "LinkedIn Carousel",
        ),
    }),
    buildSlot({
      id: "generation_plan.proof_plan",
      section: "generation_plan",
      label: "Proof plan",
      question_label: "What proof should anchor the first piece?",
      question_intent: "Make sure the first piece has enough proof behind it.",
      question_target_field: "content_readiness.required_missing_inputs_for_first_content",
      status: buildProofPlan(state).startsWith("Anchor on:") ? "strong" : "weak",
      verification_state: verificationFromFields(state.evidence_library.case_studies),
      source_fields: [
        "evidence_library.case_studies",
        "evidence_library.metrics_and_proof_points",
      ],
      checklist_item_ids: ["cr_blockers"],
      required_for_section_completion: false,
      blocking_priority: "medium",
      last_updated_at: latestTimestamp(
        state.evidence_library.case_studies,
        state.evidence_library.metrics_and_proof_points,
      ),
      displayValue: buildProofPlan(state),
    }),
  ];

  return applySlotConfirmationOverrides(state, slots);
}

export function syncPreviewSlots(state: InterviewState): PreviewSlot[] {
  const slots = buildPreviewSlots(state);
  state.system_assessment.preview_slots = slots;
  return slots;
}

export function getPreviewSlots(state: InterviewState): PreviewSlot[] {
  return state.system_assessment.preview_slots.length > 0
    ? state.system_assessment.preview_slots
    : syncPreviewSlots(state);
}

export function getSectionIdForIndex(index: number): PreviewSectionId {
  return PREVIEW_SECTION_ORDER[Math.min(index, PREVIEW_SECTION_ORDER.length - 1)]?.id
    ?? "company_understanding";
}

export function getSectionNameForIndex(index: number): string {
  return PREVIEW_SECTION_ORDER[Math.min(index, PREVIEW_SECTION_ORDER.length - 1)]?.name
    ?? "Company Understanding";
}

export function getPreviewSlotsForSectionIndex(
  state: InterviewState,
  sectionIndex: number,
): PreviewSlot[] {
  const sectionId = getSectionIdForIndex(sectionIndex);
  return getPreviewSlots(state).filter((slot) => slot.section === sectionId);
}

export function getOpenPreviewSlotsForSectionIndex(
  state: InterviewState,
  sectionIndex: number,
): PreviewSlot[] {
  return getPreviewSlotsForSectionIndex(state, sectionIndex).filter(
    (slot) => slot.required_for_section_completion && isSlotOpenForCompletion(slot),
  );
}

export function isPreviewSectionComplete(
  state: InterviewState,
  sectionIndex: number,
): boolean {
  return getOpenPreviewSlotsForSectionIndex(state, sectionIndex).length === 0;
}

export function selectNextPreviewSlot(state: InterviewState): PreviewSlot | null {
  const slots = getPreviewSlots(state);
  const priorityOrder = ["critical", "high", "medium", "low"] as const;
  const currentSectionIndex = state.conversation_meta.current_section_index;

  for (let sectionIndex = currentSectionIndex; sectionIndex < PREVIEW_SECTION_ORDER.length; sectionIndex += 1) {
    const sectionSlots = slots.filter(
      (slot) =>
        slot.section === getSectionIdForIndex(sectionIndex) &&
        isSlotOpenForCompletion(slot) &&
        slot.required_for_section_completion,
    );

    for (const priority of priorityOrder) {
      const match = sectionSlots.find((slot) => slot.blocking_priority === priority);
      if (match) return match;
    }
  }

  return null;
}
