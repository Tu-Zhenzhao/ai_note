import { InterviewState, PreviewSlot, VerificationIndicator } from "@/lib/types";
import {
  getOpenPreviewSlotsForSectionIndex,
  getPreviewSlotsForSectionIndex,
  getSectionIdForIndex,
  syncPreviewSlots,
} from "@/server/services/preview-slots";

function firstOrFallback(arr: string[], fallback: string) {
  return arr.length > 0 ? arr[0] : fallback;
}

function verificationFromSlot(slot: PreviewSlot, label = slot.label): VerificationIndicator {
  if (slot.status === "verified" || slot.verification_state === "user_confirmed") {
    return { label, state: "confirmed_by_user" };
  }
  if (slot.verification_state === "ai_inferred" || slot.verification_state === "mixed") {
    return { label, state: "inferred_from_conversation" };
  }
  return { label, state: "needs_confirmation" };
}

function asText(value: string | string[], fallback = ""): string {
  if (Array.isArray(value)) {
    return value.join("; ") || fallback;
  }
  return value || fallback;
}

function asList(value: string | string[]): string[] {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function buildDirections(state: InterviewState) {
  const topic = state.content_readiness.ai_suggested_first_content_topic.value || "Core customer problem and practical solution";
  const goal =
    state.linkedin_content_strategy.primary_content_goal.value ||
    "Build authority and attract relevant inbound conversations";
  const fallbackFormats = [
    "LinkedIn Carousel",
    "LinkedIn Long Image",
    "LinkedIn Short Video Script",
  ];
  const preferred = state.linkedin_content_strategy.desired_content_formats.value;

  return [
    {
      topic,
      format: firstOrFallback(preferred, fallbackFormats[0]),
      angle: `${goal}. Use one practical framework plus one proof point.`,
      why_it_fits: "Directly addresses primary content goal with available proof.",
    },
    {
      topic: `3 mistakes around ${topic.toLowerCase()}`,
      format: preferred[1] ?? fallbackFormats[1],
      angle: "Educational breakdown with concise operator-focused takeaways.",
      why_it_fits: "Educational angle builds trust with target audience.",
    },
    {
      topic: `Case study behind ${topic.toLowerCase()}`,
      format: preferred[2] ?? fallbackFormats[2],
      angle: "Mini-story with result and replicable process.",
      why_it_fits: "Proof-backed narrative strengthens credibility.",
    },
  ];
}

export function composePreview(state: InterviewState) {
  const slots = syncPreviewSlots(state);
  const companySummary = slots.find((slot) => slot.id === "company_understanding.company_summary");
  const brandStory = slots.find((slot) => slot.id === "company_understanding.brand_story");
  const mainOffering = slots.find((slot) => slot.id === "company_understanding.main_offering");
  const problemSolved = slots.find((slot) => slot.id === "company_understanding.problem_solved");
  const differentiator = slots.find((slot) => slot.id === "company_understanding.differentiator");
  const primaryAudience = slots.find((slot) => slot.id === "audience_understanding.primary_audience");
  const coreProblems = slots.find((slot) => slot.id === "audience_understanding.core_problems");
  const desiredOutcomes = slots.find((slot) => slot.id === "audience_understanding.desired_outcomes");
  const attractionGoal = slots.find((slot) => slot.id === "audience_understanding.linkedin_attraction_goal");
  const mainContentGoal = slots.find((slot) => slot.id === "linkedin_content_strategy.main_content_goal");
  const contentPositioning = slots.find((slot) => slot.id === "linkedin_content_strategy.content_positioning");
  const topicsAndFormats = slots.find((slot) => slot.id === "linkedin_content_strategy.topics_and_formats");
  const topicsToAvoid = slots.find((slot) => slot.id === "linkedin_content_strategy.topics_to_avoid");
  const proofAnchor = slots.find((slot) => slot.id === "evidence_and_proof_assets.proof_anchor");
  const supportingAssets = slots.find((slot) => slot.id === "evidence_and_proof_assets.supporting_assets");
  const firstTopic = slots.find((slot) => slot.id === "generation_plan.first_topic");
  const firstFormat = slots.find((slot) => slot.id === "generation_plan.first_format");
  const proofPlan = slots.find((slot) => slot.id === "generation_plan.proof_plan");

  const audienceLabel = state.market_audience.primary_audience.value?.label ?? "Primary audience not confirmed yet";

  console.log("[preview] composing:", {
    companySummary: asText(companySummary?.display_value ?? "").slice(0, 80),
    brandStory: asText(brandStory?.display_value ?? "").slice(0, 60),
    audienceLabel: audienceLabel.slice(0, 60),
    offering: state.product_service.primary_offering.value?.name?.slice(0, 40) ?? "none",
    problems: state.product_service.problem_solved.value.length,
    diffs: state.product_service.key_differentiators.value.length,
    painPoints: state.market_audience.audience_pain_points.value.length,
    contentGoal: state.linkedin_content_strategy.primary_content_goal.value?.slice(0, 40) ?? "none",
    sectionIndex: state.conversation_meta.current_section_index,
  });
  const evidenceNarratives = state.evidence_library.case_studies.value.map((entry) => entry.title).slice(0, 3);
  const metricProofs = state.evidence_library.metrics_and_proof_points.value.map((m) => `${m.metric_name}: ${m.metric_value}`);
  const assets = state.evidence_library.assets.value.map((asset) => asset.asset_name).slice(0, 5);
  const directions = buildDirections(state);
  const primaryDirection = directions[0];
  const diagnostics = state.system_assessment.last_turn_diagnostics;

  state.preview_projection.company_understanding = {
    company_summary: asText(companySummary?.display_value ?? "", "Company details not captured yet."),
    short_brand_story: asText(brandStory?.display_value ?? "", "Narrative still being refined."),
    main_offering: asText(mainOffering?.display_value ?? ""),
    problem_solved: asText(problemSolved?.display_value ?? ""),
    differentiator: asText(
      differentiator?.display_value ?? "",
      "Differentiator still being clarified",
    ),
    verification: [companySummary, brandStory, mainOffering]
      .filter((slot): slot is PreviewSlot => !!slot)
      .map((slot) => verificationFromSlot(slot)),
    meta: state.preview_projection.company_understanding.meta,
  };

  // ── Section 2: Audience Understanding ─
  const audienceRoles = state.market_audience.audience_roles.value;
  const displayAudience = audienceRoles.length > 0
    ? `${audienceLabel} (${audienceRoles.join(", ")})`
    : audienceLabel;

  state.preview_projection.audience_understanding = {
    primary_audience: asText(primaryAudience?.display_value ?? displayAudience, displayAudience),
    core_problems: asList(coreProblems?.display_value ?? []),
    desired_outcomes: asList(desiredOutcomes?.display_value ?? []),
    who_to_attract_on_linkedin: asText(attractionGoal?.display_value ?? ""),
    verification: [primaryAudience, coreProblems, attractionGoal]
      .filter((slot): slot is PreviewSlot => !!slot)
      .map((slot) => verificationFromSlot(slot)),
    meta: state.preview_projection.audience_understanding.meta,
  };

  // ── Section 3: LinkedIn Content Strategy ─
  state.preview_projection.linkedin_content_strategy = {
    main_content_goal: asText(mainContentGoal?.display_value ?? ""),
    content_positioning: firstOrFallback(asList(contentPositioning?.display_value ?? []), ""),
    target_impact: state.linkedin_content_strategy.secondary_content_goals,
    topics_to_emphasize: asList(topicsAndFormats?.display_value ?? []).filter(
      (entry) => !entry.startsWith("LinkedIn "),
    ),
    topics_to_avoid: [
      ...state.content_dislikes.disliked_tone.value,
      ...asList(topicsToAvoid?.display_value ?? []),
    ],
    verification: [mainContentGoal, topicsAndFormats]
      .filter((slot): slot is PreviewSlot => !!slot)
      .map((slot) => verificationFromSlot(slot)),
    meta: state.preview_projection.linkedin_content_strategy.meta,
  };

  // ── Section 4: Evidence & Proof Assets ─

  const evidenceConfidence =
    evidenceNarratives.length > 0 && metricProofs.length > 0
      ? "high"
      : evidenceNarratives.length > 0 || metricProofs.length > 0
        ? "medium"
        : "low";

  state.preview_projection.evidence_and_proof = {
    narrative_proof: evidenceNarratives,
    metrics_proof_points: metricProofs,
    supporting_assets: assets,
    evidence_confidence_level: evidenceConfidence,
    missing_proof_areas: state.evidence_library.missing_proof_areas.value,
    verification: [proofAnchor, supportingAssets]
      .filter((slot): slot is PreviewSlot => !!slot)
      .map((slot) => verificationFromSlot(slot)),
    meta: state.preview_projection.evidence_and_proof.meta,
  };

  // ── Section 5: AI Suggested Content Directions ─

  state.preview_projection.ai_suggested_directions = directions;

  // ── Section 6: Generation Plan ─

  state.preview_projection.generation_plan = {
    planned_first_topic: asText(firstTopic?.display_value ?? primaryDirection.topic, primaryDirection.topic),
    planned_format: asText(firstFormat?.display_value ?? primaryDirection.format, primaryDirection.format),
    intended_structure: ["Hook", "Problem", "Insight", "Supporting proof", "Practical takeaway", "CTA"],
    audience_fit: audienceLabel,
    proof_plan: asText(
      proofPlan?.display_value ?? "",
      evidenceNarratives.length > 0
        ? `Anchor on: ${evidenceNarratives[0]}`
        : "No proof anchor yet — may need a case or metric first.",
    ),
    verification: [firstTopic, firstFormat]
      .filter((slot): slot is PreviewSlot => !!slot)
      .map((slot) => verificationFromSlot(slot)),
    meta: state.preview_projection.generation_plan.meta,
  };

  // ── Turn Delta ─

  state.preview_projection.turn_delta = {
    what_changed: diagnostics.captured_fields_this_turn,
    sections_updated: Array.from(new Set(diagnostics.captured_fields_this_turn.map((f) => f.split(".")[0]))),
    newly_captured: diagnostics.captured_fields_this_turn,
    remains_open: slots
      .filter((slot) => slot.status === "missing" || slot.status === "weak")
      .map((slot) => slot.question_label),
    items_confirmed: state.checklist
      .filter((c) => c.status === "verified")
      .map((c) => c.question_label),
  };

  // ── Open Items (humanized) ─

  state.preview_projection.open_items = slots
    .filter((slot) => slot.status === "missing" || slot.status === "weak")
    .map((slot) => ({
      human_label: slot.question_label,
      priority: slot.required_for_section_completion
        ? "critical_before_generation" as const
        : "helpful_but_optional" as const,
    }));

  // ── Confirmation Targets ─

  state.preview_projection.confirmation_targets = [
    {
      id: "company_one_liner",
      label: "Company One-Liner",
      confirmed: state.company_profile.company_one_liner.status === "verified",
      section: "company_understanding",
    },
    {
      id: "primary_audience",
      label: "Primary Audience",
      confirmed: state.market_audience.primary_audience.status === "verified",
      section: "audience_understanding",
    },
    {
      id: "main_content_goal",
      label: "Main Content Goal",
      confirmed: state.linkedin_content_strategy.primary_content_goal.status === "verified",
      section: "linkedin_content_strategy",
    },
    {
      id: "first_topic",
      label: "First Topic",
      confirmed: state.content_readiness.ai_suggested_first_content_topic.status === "verified",
      section: "generation_plan",
    },
  ];

  // ── Update summary ─

  const captured = diagnostics.captured_fields_this_turn.slice(0, 3).join(", ") || "no new fields captured";
  const summary = `Updated preview: captured ${captured}; score ${state.system_assessment.global_completion_score}; next action ${state.system_assessment.next_action}.`;
  state.preview_projection.last_preview_update_summary = summary;
  state.preview_projection.preview_revision_log.push({ at: new Date().toISOString(), summary });

  // ── Return full preview output ─

  return {
    header: {
      title: "Content Strategy Preview",
      subtitle:
        "Here is how I currently understand your company and how LinkedIn content could work for you. Please review this before we generate the first content piece.",
    },
    completion_status: {
      completion_score: state.system_assessment.global_completion_score,
      generation_readiness: state.content_readiness.brief_can_be_generated_now ? "Ready" : "Not Ready",
      checkpoint_status: state.system_assessment.checkpoint_approved ? "Approved" : "Pending",
      confidence_indicators: {
        company_understanding: state.system_assessment.confidence_scores.company_understanding,
        audience_clarity: state.system_assessment.confidence_scores.audience_clarity,
        evidence_strength: state.system_assessment.confidence_scores.evidence_strength,
        content_strategy_clarity: state.system_assessment.confidence_scores.strategy_coherence,
        verification_confidence: state.system_assessment.confidence_scores.verification_confidence,
      },
    },
    sections: {
      company_understanding: state.preview_projection.company_understanding,
      audience_understanding: state.preview_projection.audience_understanding,
      linkedin_content_strategy: state.preview_projection.linkedin_content_strategy,
      evidence_and_proof_assets: state.preview_projection.evidence_and_proof,
      ai_suggested_content_directions: state.preview_projection.ai_suggested_directions,
      generation_plan: state.preview_projection.generation_plan,
    },
    turn_delta: state.preview_projection.turn_delta,
    open_items: state.preview_projection.open_items,
    confirmation_chips: state.preview_projection.confirmation_targets,
    weak_missing_unconfirmed: {
      missing: slots
        .filter((slot) => slot.status === "missing")
        .map((slot) => slot.question_label),
      weak: slots
        .filter((slot) => slot.status === "weak")
        .map((slot) => slot.question_label),
      unconfirmed: slots
        .filter(
          (slot) =>
            slot.status !== "missing" &&
            slot.verification_state !== "user_confirmed" &&
            slot.status !== "verified",
        )
        .map((slot) => slot.label),
    },
    founder_voice: {
      tone: state.content_preferences.preferred_tone.value,
      style: state.content_preferences.preferred_style_tags.value,
    },
    recommended_formats: ["LinkedIn Carousel", "LinkedIn Long Image", "LinkedIn Short Video Script", "LinkedIn Post"],
    next_steps: [
      "Approve this preview",
      "Edit any section",
      "Regenerate suggested content directions",
      "Continue interview if needed",
    ],
    internal_preview: {
      preview_slots: slots,
      current_section_slots: getPreviewSlotsForSectionIndex(
        state,
        state.conversation_meta.current_section_index,
      ),
      current_section_open_slots: getOpenPreviewSlotsForSectionIndex(
        state,
        state.conversation_meta.current_section_index,
      ),
      current_section_id: getSectionIdForIndex(
        state.conversation_meta.current_section_index,
      ),
      module_completion_status: state.system_assessment.module_completion_map,
      checklist_completion_status: state.system_assessment.checklist_completion_map,
      confidence_scores: state.system_assessment.confidence_scores,
      weak_fields: state.system_assessment.weak_fields,
      unconfirmed_fields: state.system_assessment.unconfirmed_fields,
      evidence_strength: state.system_assessment.confidence_scores.evidence_strength,
      strategy_confidence: state.system_assessment.confidence_scores.strategy_coherence,
      generation_ready_flag: state.content_readiness.brief_can_be_generated_now,
    },
  };
}
