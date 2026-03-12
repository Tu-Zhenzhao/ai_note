import {
  CompletionLevel,
  CompletionState,
  InterviewState,
  ModuleStatus,
  PlannerAction,
} from "@/lib/types";
import {
  HARD_REQUIRED_MODULES,
  MODULE_WEIGHTS,
  moduleScore,
} from "@/lib/state";
import { computeChecklistCompletionMap, getOpenChecklistItems } from "@/server/rules/checklist";
import { syncPreviewSlots } from "@/server/services/preview-slots";

function hasText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

function hasItems<T>(arr: T[] | null | undefined): boolean {
  return Array.isArray(arr) && arr.length > 0;
}

function mergeModuleStatus(current: ModuleStatus, candidate: ModuleStatus): ModuleStatus {
  const rank: Record<ModuleStatus, number> = {
    not_started: 0,
    partial: 1,
    strong: 2,
    verified: 3,
  };
  return rank[candidate] > rank[current] ? candidate : current;
}

function moduleStatusFromFieldStates(states: Array<"missing" | "partial" | "strong" | "verified">): ModuleStatus {
  let moduleStatus: ModuleStatus = "not_started";
  for (const status of states) {
    if (status === "verified") {
      moduleStatus = mergeModuleStatus(moduleStatus, "verified");
    } else if (status === "strong") {
      moduleStatus = mergeModuleStatus(moduleStatus, "strong");
    } else if (status === "partial") {
      moduleStatus = mergeModuleStatus(moduleStatus, "partial");
    }
  }
  return moduleStatus;
}

function evaluateCompanyProfile(state: InterviewState): ModuleStatus {
  const cp = state.company_profile;
  const oneLiner = cp.company_one_liner.status;
  const industry = cp.industry.value.length > 0 ? cp.industry.status : "missing";
  const businessModel = cp.business_model.value.length > 0 ? cp.business_model.status : "missing";
  if (oneLiner === "strong" || oneLiner === "verified") {
    if ([industry, businessModel].some((s) => s === "strong" || s === "verified")) {
      return oneLiner === "verified" ? "verified" : "strong";
    }
    return "partial";
  }
  return moduleStatusFromFieldStates([oneLiner, industry, businessModel]);
}

function evaluateBrandStory(state: InterviewState): ModuleStatus {
  const bs = state.brand_story;
  const anchors = [
    bs.founding_story.status,
    bs.origin_context.status,
    bs.mission_statement.status,
    bs.core_belief.status,
  ];
  const remember = bs.what_should_people_remember.status;
  const strongCount = anchors.filter((s) => s === "strong" || s === "verified").length;
  if (strongCount >= 2 && (remember === "strong" || remember === "verified")) {
    return "strong";
  }
  return moduleStatusFromFieldStates([...anchors, remember]);
}

function evaluateProductService(state: InterviewState): ModuleStatus {
  const ps = state.product_service;
  const offeringStrong = ps.primary_offering.status === "strong" || ps.primary_offering.status === "verified";
  const problemStrong = ps.problem_solved.status === "strong" || ps.problem_solved.status === "verified";
  const diffStrong = ps.key_differentiators.status === "strong" || ps.key_differentiators.status === "verified";
  if (offeringStrong && problemStrong && diffStrong) return "strong";
  return moduleStatusFromFieldStates([
    ps.primary_offering.status,
    ps.problem_solved.status,
    ps.key_differentiators.status,
    ps.customer_value_outcomes.status,
  ]);
}

function evaluateMarketAudience(state: InterviewState): ModuleStatus {
  const ma = state.market_audience;
  const audienceStrong = ma.primary_audience.status === "strong" || ma.primary_audience.status === "verified";
  const painStrong = ma.audience_pain_points.status === "strong" || ma.audience_pain_points.status === "verified";
  const outcomeStrong =
    ma.audience_desired_outcomes.status === "strong" || ma.audience_desired_outcomes.status === "verified";
  if (audienceStrong && painStrong && outcomeStrong) return "strong";
  return moduleStatusFromFieldStates([
    ma.primary_audience.status,
    ma.audience_pain_points.status,
    ma.audience_desired_outcomes.status,
    ma.attraction_goal.status,
  ]);
}

function evaluateLinkedinStrategy(state: InterviewState): ModuleStatus {
  const ls = state.linkedin_content_strategy;
  const goalStrong = ls.primary_content_goal.status === "strong" || ls.primary_content_goal.status === "verified";
  const attractionStrong = state.market_audience.attraction_goal.status === "strong" || state.market_audience.attraction_goal.status === "verified";
  const formatStrong = ls.desired_content_formats.status === "strong" || ls.priority_format.status === "strong";
  if (goalStrong && attractionStrong && formatStrong) return "strong";
  return moduleStatusFromFieldStates([
    ls.primary_content_goal.status,
    ls.desired_content_formats.status,
    ls.priority_format.status,
    ls.topics_they_want_to_talk_about.status,
  ]);
}

function evaluateContentPreferences(state: InterviewState): ModuleStatus {
  const cp = state.content_preferences;
  const tone = cp.preferred_tone.status;
  const voice = cp.preferred_voice.status;
  const style = cp.preferred_style_tags.status;
  const depth = cp.preferred_content_depth.status;
  if (
    (tone === "strong" || tone === "verified") &&
    (voice === "strong" || voice === "verified") &&
    (style === "strong" || style === "verified") &&
    (depth === "strong" || depth === "verified")
  ) {
    return "strong";
  }
  return moduleStatusFromFieldStates([tone, voice, style, depth]);
}

function evaluateEvidenceLibrary(state: InterviewState): ModuleStatus {
  const ev = state.evidence_library;
  const hasNarrativeAnchor =
    hasItems(ev.case_studies.value) ||
    hasItems(ev.milestones_and_updates.value) ||
    state.brand_story.founding_story.status === "strong" ||
    state.brand_story.mission_statement.status === "strong";

  const hasSupportLayer =
    hasItems(ev.metrics_and_proof_points.value) || hasItems(ev.assets.value) || hasItems(ev.source_material_links);

  if (hasNarrativeAnchor && hasSupportLayer) return "strong";
  if (hasNarrativeAnchor || hasSupportLayer) return "partial";
  return "not_started";
}

function evaluateSimplePartial(fields: Array<"missing" | "partial" | "strong" | "verified">): ModuleStatus {
  return moduleStatusFromFieldStates(fields);
}

function computeModuleStatuses(state: InterviewState): Record<string, ModuleStatus> {
  return {
    company_profile: evaluateCompanyProfile(state),
    brand_story: evaluateBrandStory(state),
    product_service: evaluateProductService(state),
    market_audience: evaluateMarketAudience(state),
    linkedin_content_strategy: evaluateLinkedinStrategy(state),
    content_preferences: evaluateContentPreferences(state),
    evidence_library: evaluateEvidenceLibrary(state),
    content_dislikes: evaluateSimplePartial([
      state.content_dislikes.disliked_tone.status,
      state.content_dislikes.disliked_messaging_patterns.status,
      state.content_dislikes.things_that_feel_too_marketing.status,
    ]),
    constraints_and_boundaries: evaluateSimplePartial([
      state.constraints_and_boundaries.forbidden_topics.status,
      state.constraints_and_boundaries.claims_policy.status,
      state.constraints_and_boundaries.tone_boundaries.status,
    ]),
    user_concerns: evaluateSimplePartial([
      state.user_concerns.main_concerns.status,
      state.user_concerns.past_content_problems.status,
      state.user_concerns.most_desired_ai_help.status,
    ]),
    content_readiness: evaluateSimplePartial([
      state.content_readiness.ai_suggested_first_content_topic.status,
      state.content_readiness.ai_suggested_first_content_format.status,
      state.content_readiness.ai_suggested_first_content_goal.status,
    ]),
  };
}

function computeScore(moduleMap: Record<string, ModuleStatus>): number {
  let total = 0;
  for (const [module, weight] of Object.entries(MODULE_WEIGHTS)) {
    total += weight * moduleScore(moduleMap[module] ?? "not_started");
  }
  return Math.round(total);
}

function detectMissingWeakUnconfirmed(state: InterviewState, moduleMap: Record<string, ModuleStatus>) {
  const slots = syncPreviewSlots(state);
  const missing = slots
    .filter((slot) => slot.required_for_section_completion && slot.status === "missing")
    .map((slot) => slot.question_label);
  const weak = slots
    .filter((slot) => slot.required_for_section_completion && slot.status === "weak")
    .map((slot) => slot.question_label);
  const unconfirmed = slots
    .filter(
      (slot) =>
        slot.required_for_section_completion &&
        slot.status !== "missing" &&
        slot.status !== "verified" &&
        slot.verification_state !== "user_confirmed",
    )
    .map((slot) => slot.label);

  for (const [module, status] of Object.entries(moduleMap)) {
    if (
      status === "not_started" &&
      HARD_REQUIRED_MODULES.includes(module as (typeof HARD_REQUIRED_MODULES)[number])
    ) {
      const label = module.replace(/_/g, " ");
      if (!missing.includes(label)) {
        missing.push(label);
      }
    }
  }

  return { missing, weak, unconfirmed };
}

function computeVerificationCoverage(state: InterviewState): number {
  const criticalFields = [
    state.company_profile.company_one_liner,
    state.market_audience.primary_audience,
    state.linkedin_content_strategy.primary_content_goal,
    state.content_readiness.ai_suggested_first_content_topic,
    state.constraints_and_boundaries.forbidden_topics,
  ];

  let confirmed = 0;
  let relevant = 0;
  for (const field of criticalFields) {
    if (field.status !== "missing") {
      relevant += 1;
      if (field.verification_state === "user_confirmed" || field.status === "verified") {
        confirmed += 1;
      }
    }
  }

  return relevant > 0 ? confirmed / relevant : 0;
}

function computeEvidenceConfidence(state: InterviewState): number {
  const ev = state.evidence_library;
  let score = 0;
  if (hasItems(ev.case_studies.value)) score += 0.3;
  if (hasItems(ev.metrics_and_proof_points.value)) score += 0.3;
  if (hasItems(ev.assets.value)) score += 0.15;
  if (hasItems(ev.milestones_and_updates.value)) score += 0.15;
  if (hasItems(ev.source_material_links)) score += 0.1;
  return Math.min(score, 1);
}

function detectRedLineBlockers(state: InterviewState, moduleMap: Record<string, ModuleStatus>) {
  const blockers: string[] = [];

  if (moduleMap.company_profile !== "strong" && moduleMap.company_profile !== "verified") {
    blockers.push("company_not_clear");
  }

  if (moduleMap.market_audience !== "strong" && moduleMap.market_audience !== "verified") {
    blockers.push("primary_audience_unclear");
  }

  const goal = state.linkedin_content_strategy.primary_content_goal;
  if (!(goal.status === "strong" || goal.status === "verified") || !hasText(goal.value)) {
    blockers.push("linkedin_goal_unclear");
  }

  if (moduleMap.evidence_library !== "strong" && moduleMap.evidence_library !== "verified") {
    blockers.push("evidence_foundation_missing");
  }

  const boundaryPolicy = state.constraints_and_boundaries.claims_policy;
  if (!hasText(boundaryPolicy.value) && state.constraints_and_boundaries.forbidden_topics.status === "missing") {
    blockers.push("boundaries_unclear");
  }

  const topic = state.content_readiness.ai_suggested_first_content_topic;
  const format = state.content_readiness.ai_suggested_first_content_format;
  const goalSuggestion = state.content_readiness.ai_suggested_first_content_goal;
  if (!hasText(topic.value) || !hasText(format.value) || !hasText(goalSuggestion.value)) {
    blockers.push("first_brief_incoherent");
  }

  return blockers;
}

function checkHardRequired(moduleMap: Record<string, ModuleStatus>) {
  return HARD_REQUIRED_MODULES.every((module) => {
    const status = moduleMap[module];
    return status === "strong" || status === "verified";
  });
}

function coreStrongCount(moduleMap: Record<string, ModuleStatus>) {
  return HARD_REQUIRED_MODULES.filter((module) => {
    const status = moduleMap[module];
    return status === "strong" || status === "verified";
  }).length;
}

function decideCompletionLevel(input: {
  score: number;
  moduleMap: Record<string, ModuleStatus>;
  blockers: string[];
  checkpointApproved: boolean;
}): CompletionLevel {
  const hardRequiredReady = checkHardRequired(input.moduleMap);

  if (input.score < 55) {
    return "incomplete";
  }

  if (input.score >= 75 && input.checkpointApproved && hardRequiredReady && input.blockers.length === 0) {
    return "generation_ready";
  }

  return "minimally_ready";
}

function decideNextBestMove(params: {
  completionLevel: CompletionLevel;
  generationPermission: boolean;
  unresolvedConflicts: number;
  checkpointRecommended: boolean;
  score: number;
}): PlannerAction {
  if (params.completionLevel === "handoff_ready") return "handoff";
  if (params.generationPermission) return "generate_brief";
  if (params.unresolvedConflicts > 0) return "confirm";
  if (params.checkpointRecommended || params.score >= 65) return "checkpoint";
  return "ask";
}

export function evaluateCompletion(state: InterviewState): CompletionState {
  const moduleMap = computeModuleStatuses(state);
  const score = computeScore(moduleMap);
  const { missing, weak, unconfirmed } = detectMissingWeakUnconfirmed(state, moduleMap);
  const blockers = detectRedLineBlockers(state, moduleMap);
  const verificationCoverage = computeVerificationCoverage(state);
  const evidenceConfidence = computeEvidenceConfidence(state);

  // Checklist integration
  const checklistMap = computeChecklistCompletionMap(state);
  const openItems = getOpenChecklistItems(state);
  const openChecklistItemIds = openItems.map((item) => item.id);
  const resolvedItems = state.checklist
    .filter((item) => item.status === "answered" || item.status === "verified")
    .map((item) => item.id);

  let completionLevel = decideCompletionLevel({
    score,
    moduleMap,
    blockers,
    checkpointApproved: state.system_assessment.checkpoint_approved,
  });

  if (
    (state.conversation_meta.needs_human_review || state.system_assessment.user_fatigue_risk === "high") &&
    (score >= 65 || blockers.length > 0)
  ) {
    completionLevel = "handoff_ready";
  }

  const conversationalReadiness =
    state.system_assessment.user_fatigue_risk === "high" &&
    score >= 60 &&
    coreStrongCount(moduleMap) >= 3 &&
    !state.system_assessment.checkpoint_approved;

  const generationPermissionFlag =
    completionLevel === "generation_ready" &&
    blockers.length === 0 &&
    state.system_assessment.checkpoint_approved &&
    verificationCoverage >= 0.5;

  const unresolvedConflicts = state.system_assessment.pending_conflicts.filter(
    (c) => c.status === "pending",
  ).length;

  const checkpointRecommended = score >= 65 || conversationalReadiness;
  const plannerConfidence = Math.min(
    (score / 100) * 0.5 + verificationCoverage * 0.3 + evidenceConfidence * 0.2,
    1,
  );

  const nextBestMove = decideNextBestMove({
    completionLevel,
    generationPermission: generationPermissionFlag,
    unresolvedConflicts,
    checkpointRecommended,
    score,
  });

  // ── Write back to state ─

  state.system_assessment.module_completion_map = moduleMap;
  state.system_assessment.checklist_completion_map = checklistMap;
  state.system_assessment.global_completion_score = score;
  state.system_assessment.highest_priority_missing_fields = missing.slice(0, 5);
  state.system_assessment.highest_priority_partial_fields = weak.slice(0, 5);
  state.system_assessment.weak_fields = weak;
  state.system_assessment.missing_fields = missing;
  state.system_assessment.unconfirmed_fields = unconfirmed;
  state.system_assessment.red_line_blockers = blockers;
  state.system_assessment.open_checklist_items = openChecklistItemIds;
  state.system_assessment.resolved_checklist_items = resolvedItems;
  state.system_assessment.ready_for_checkpoint_summary = score >= 65;
  state.system_assessment.ready_for_final_review = score >= 75;
  state.system_assessment.checkpoint_recommended = checkpointRecommended;
  state.system_assessment.next_action =
    completionLevel === "handoff_ready"
      ? "handoff"
      : generationPermissionFlag
        ? "generate_brief"
        : checkpointRecommended
          ? "checkpoint"
          : "continue";

  state.system_assessment.confidence_scores = {
    company_understanding: moduleScore(moduleMap.company_profile),
    audience_clarity: moduleScore(moduleMap.market_audience),
    strategy_coherence: moduleScore(moduleMap.linkedin_content_strategy),
    evidence_strength: moduleScore(moduleMap.evidence_library),
    verification_confidence: verificationCoverage,
    generation_confidence: generationPermissionFlag ? 0.9 : score / 100,
  };

  state.content_readiness.brief_can_be_generated_now = generationPermissionFlag;
  state.content_readiness.first_content_readiness_score = score;

  return {
    completion_level: completionLevel,
    completion_score: score,
    generation_permission_flag: generationPermissionFlag,
    missing_fields: missing,
    weak_fields: weak,
    unconfirmed_fields: unconfirmed,
    red_line_blockers: blockers,
    open_checklist_items: openChecklistItemIds,
    checkpoint_recommended: checkpointRecommended,
    next_best_move: nextBestMove,
    verification_coverage: verificationCoverage,
    evidence_confidence_score: evidenceConfidence,
    planner_confidence: plannerConfidence,
    model_route_used: state.system_assessment.model_route_used,
  };
}
