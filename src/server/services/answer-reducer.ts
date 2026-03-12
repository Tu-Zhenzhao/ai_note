import {
  ExtractionOutput,
  ExtractionResult,
  FieldStatus,
  InterviewState,
  ReductionResult,
  TurnDiagnostics,
  VerificationState,
} from "@/lib/types";
import { advanceChecklistItems } from "@/server/rules/checklist";
import {
  confirmPreviewSectionSlots,
  confirmPreviewSlots,
  getPreviewSlots,
} from "@/server/services/preview-slots";
import { confirmPendingSectionAndAdvance, syncWorkflowState } from "@/server/services/workflow";

function statusFromString(value: string): FieldStatus {
  if (!value.trim()) return "missing";
  if (value.trim().split(/\s+/).length >= 8) return "strong";
  return "partial";
}

function statusFromArray(values: string[]): FieldStatus {
  if (!values.length) return "missing";
  if (values.length >= 2) return "strong";
  return "partial";
}

function arraysDifferent(a: string[], b: string[]) {
  if (a.length !== b.length) return true;
  const normA = [...a].sort().join("|");
  const normB = [...b].sort().join("|");
  return normA !== normB;
}

function deriveVerificationState(sourceType: "direct" | "light_inference"): VerificationState {
  return sourceType === "light_inference" ? "ai_inferred" : "unverified";
}

function setStringValue(
  target: {
    value: string;
    status: string;
    verification_state?: string;
    source_turn_ids?: string[];
    last_updated_at?: string;
  },
  value: string,
  verificationState: VerificationState,
  turnId: string,
  now: string,
) {
  const changed = target.value !== value;
  target.value = value;
  target.status = statusFromString(value);
  target.verification_state = verificationState;
  target.source_turn_ids = [...(target.source_turn_ids ?? []), turnId].slice(-10);
  target.last_updated_at = now;
  return changed;
}

function setArrayValue(
  target: {
    value: string[];
    status: string;
    verification_state?: string;
    source_turn_ids?: string[];
    last_updated_at?: string;
  },
  value: string[],
  verificationState: VerificationState,
  turnId: string,
  now: string,
) {
  const changed = arraysDifferent(target.value, value);
  target.value = value;
  target.status = statusFromArray(value);
  target.verification_state = verificationState;
  target.source_turn_ids = [...(target.source_turn_ids ?? []), turnId].slice(-10);
  target.last_updated_at = now;
  return changed;
}

function classifyUpdatedFields(params: {
  state: InterviewState;
  updatedFields: string[];
  activeSlotId: string | null;
  activeSectionId: string;
}): {
  activeSlotUpdates: string[];
  currentSectionSupportingUpdates: string[];
  crossSectionCandidates: string[];
} {
  const previewSlots = getPreviewSlots(params.state);
  const activeSlot = params.activeSlotId
    ? previewSlots.find((slot) => slot.id === params.activeSlotId) ?? null
    : null;

  const mapFieldToSlot = (field: string) => {
    const exact = previewSlots.find((slot) => slot.question_target_field === field);
    if (exact) return exact;
    if (activeSlot?.source_fields.includes(field)) return activeSlot;
    const sameSection = previewSlots.find(
      (slot) => slot.section === params.activeSectionId && slot.source_fields.includes(field),
    );
    if (sameSection) return sameSection;
    return previewSlots.find((slot) => slot.source_fields.includes(field)) ?? null;
  };

  const activeSlotUpdates = new Set<string>();
  const currentSectionSupportingUpdates = new Set<string>();
  const crossSectionCandidates = new Set<string>();

  for (const field of params.updatedFields) {
    const mappedSlot = mapFieldToSlot(field);
    if (params.activeSlotId && mappedSlot?.id === params.activeSlotId) {
      activeSlotUpdates.add(field);
      continue;
    }
    if (mappedSlot?.section === params.activeSectionId) {
      currentSectionSupportingUpdates.add(field);
      continue;
    }
    crossSectionCandidates.add(field);
  }

  return {
    activeSlotUpdates: Array.from(activeSlotUpdates),
    currentSectionSupportingUpdates: Array.from(currentSectionSupportingUpdates),
    crossSectionCandidates: Array.from(crossSectionCandidates),
  };
}

function updateDiagnostics(params: {
  state: InterviewState;
  userMessage: string;
  updatedFields: string[];
  checklistItemsAdvanced: string[];
  extractionOutput: ExtractionOutput;
  confirmationsApplied: string[];
}) {
  const diagnostics: TurnDiagnostics = {
    direct_user_facts: [params.userMessage],
    assistant_inferences: [],
    evidence_links: params.state.system_assessment.last_turn_diagnostics.evidence_links,
    confidence: params.extractionOutput.answered_active_slot
      ? 0.85
      : params.updatedFields.length > 0
        ? 0.7
        : params.confirmationsApplied.length > 0
          ? 0.9
          : 0.4,
    captured_fields_this_turn: params.updatedFields,
    captured_checklist_items_this_turn: params.checklistItemsAdvanced,
    deferred_fields: [],
    conflicts_detected: [],
    question_reason: params.state.system_assessment.last_turn_diagnostics.question_reason || "answer_turn_reduction",
    tool_actions_used: [
      "answer_turn_extraction",
      ...(params.confirmationsApplied.length > 0 ? ["answer_turn_confirmation"] : []),
    ],
  };
  params.state.system_assessment.last_turn_diagnostics = diagnostics;
  params.state.system_assessment.state_updates_this_turn = params.updatedFields;
  params.state.system_assessment.last_extraction_output = params.extractionOutput;
}

export function reduceAnswerTurn(params: {
  state: InterviewState;
  extraction: ExtractionResult;
  sourceTurnId: string;
  userMessage: string;
  activeSectionId: string;
  activeSlotId: string | null;
  sectionIndexBefore: number;
}): ReductionResult {
  const { state, extraction, sourceTurnId } = params;
  const now = new Date().toISOString();
  const updatedFields: string[] = [];
  const confirmedSlotIds: string[] = [];
  let confirmedSectionId = null as ReductionResult["confirmed_section_id"];

  for (const fact of extraction.facts) {
    const verificationState = deriveVerificationState(fact.source_type);
    let changed = false;

    switch (fact.field_path) {
      case "company_profile.company_one_liner":
        changed = setStringValue(
          state.company_profile.company_one_liner,
          String(fact.normalized_value),
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "company_profile.industry":
        changed = setArrayValue(
          state.company_profile.industry,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "company_profile.business_model":
        changed = setArrayValue(
          state.company_profile.business_model,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "brand_story.founding_story":
        changed = setStringValue(
          state.brand_story.founding_story,
          String(fact.normalized_value),
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "brand_story.mission_statement":
        changed = setStringValue(
          state.brand_story.mission_statement,
          String(fact.normalized_value),
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "brand_story.core_belief":
        changed = setStringValue(
          state.brand_story.core_belief,
          String(fact.normalized_value),
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "brand_story.what_should_people_remember":
        changed = setStringValue(
          state.brand_story.what_should_people_remember,
          String(fact.normalized_value),
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "product_service.primary_offering": {
        const nextValue = fact.normalized_value as {
          name: string;
          type: string;
          description: string;
          target_user: string;
          main_use_case: string;
          status: FieldStatus;
        };
        changed = state.product_service.primary_offering.value?.name !== nextValue.name;
        state.product_service.primary_offering.value = nextValue;
        state.product_service.primary_offering.status = statusFromString(nextValue.name);
        state.product_service.primary_offering.verification_state = verificationState;
        state.product_service.primary_offering.source_turn_ids = [
          ...(state.product_service.primary_offering.source_turn_ids ?? []),
          sourceTurnId,
        ].slice(-10);
        state.product_service.primary_offering.last_updated_at = now;
        break;
      }
      case "product_service.problem_solved":
        changed = setArrayValue(
          state.product_service.problem_solved,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "product_service.key_differentiators":
        changed = setArrayValue(
          state.product_service.key_differentiators,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "market_audience.primary_audience": {
        const nextValue = fact.normalized_value as {
          label: string;
          roles: string[];
          industries: string[];
          company_size: string[];
          regions: string[];
          pain_points: string[];
          desired_outcomes: string[];
          content_resonance_angle: string;
          status: FieldStatus;
        };
        changed = state.market_audience.primary_audience.value?.label !== nextValue.label;
        state.market_audience.primary_audience.value = nextValue;
        state.market_audience.primary_audience.status = statusFromString(nextValue.label);
        state.market_audience.primary_audience.verification_state = verificationState;
        state.market_audience.primary_audience.source_turn_ids = [
          ...(state.market_audience.primary_audience.source_turn_ids ?? []),
          sourceTurnId,
        ].slice(-10);
        state.market_audience.primary_audience.last_updated_at = now;
        break;
      }
      case "market_audience.audience_roles":
        changed = setArrayValue(
          state.market_audience.audience_roles,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "market_audience.audience_pain_points":
        changed = setArrayValue(
          state.market_audience.audience_pain_points,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "market_audience.audience_desired_outcomes":
        changed = setArrayValue(
          state.market_audience.audience_desired_outcomes,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "market_audience.attraction_goal":
        changed = setStringValue(
          state.market_audience.attraction_goal,
          String(fact.normalized_value),
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "linkedin_content_strategy.primary_content_goal":
        changed = setStringValue(
          state.linkedin_content_strategy.primary_content_goal,
          String(fact.normalized_value),
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "linkedin_content_strategy.desired_content_formats":
        changed = setArrayValue(
          state.linkedin_content_strategy.desired_content_formats,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "linkedin_content_strategy.topics_they_want_to_talk_about":
        changed = setArrayValue(
          state.linkedin_content_strategy.topics_they_want_to_talk_about,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "linkedin_content_strategy.topics_to_avoid_or_deprioritize":
        changed = setArrayValue(
          state.linkedin_content_strategy.topics_to_avoid_or_deprioritize,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "content_preferences.preferred_tone":
        changed = setArrayValue(
          state.content_preferences.preferred_tone,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "content_preferences.preferred_voice":
        changed = setArrayValue(
          state.content_preferences.preferred_voice,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "content_preferences.preferred_style_tags":
        changed = setArrayValue(
          state.content_preferences.preferred_style_tags,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "content_dislikes.disliked_tone":
        changed = setArrayValue(
          state.content_dislikes.disliked_tone,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "constraints_and_boundaries.forbidden_topics":
        changed = setArrayValue(
          state.constraints_and_boundaries.forbidden_topics,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "constraints_and_boundaries.claims_policy":
        changed = setStringValue(
          state.constraints_and_boundaries.claims_policy,
          String(fact.normalized_value),
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "user_concerns.main_concerns":
        changed = setArrayValue(
          state.user_concerns.main_concerns,
          fact.normalized_value as string[],
          verificationState,
          sourceTurnId,
          now,
        );
        break;
      case "evidence_library.case_studies": {
        const value = String(fact.normalized_value).trim();
        changed = value.length > 0;
        if (value) {
          state.evidence_library.case_studies.value = [
            ...state.evidence_library.case_studies.value,
            {
              title: value.slice(0, 60),
              client_type: "",
              problem: value,
              solution: "",
              result: "",
              metrics: [],
              permission_level: "public",
              status: "partial" as const,
            },
          ].slice(-20);
          state.evidence_library.case_studies.status = "partial";
          state.evidence_library.case_studies.verification_state = verificationState;
          state.evidence_library.case_studies.last_updated_at = now;
        }
        break;
      }
      case "evidence_library.metrics_and_proof_points": {
        const value = String(fact.normalized_value).trim();
        changed = value.length > 0;
        if (value) {
          state.evidence_library.metrics_and_proof_points.value = [
            ...state.evidence_library.metrics_and_proof_points.value,
            {
              metric_name: "Reported metric",
              metric_value: value,
              metric_context: "User provided",
              timeframe: "",
              confidence_level: "medium",
              can_publish_publicly: true,
              status: "partial" as const,
            },
          ].slice(-20);
          state.evidence_library.metrics_and_proof_points.status = "partial";
          state.evidence_library.metrics_and_proof_points.verification_state = verificationState;
          state.evidence_library.metrics_and_proof_points.last_updated_at = now;
        }
        break;
      }
      case "evidence_library.assets": {
        const value = String(fact.normalized_value).trim();
        changed = value.length > 0;
        if (value) {
          state.evidence_library.assets.value = [
            ...state.evidence_library.assets.value,
            {
              asset_type: "general",
              asset_name: value.slice(0, 60),
              description: value,
              link_or_storage_ref: null,
              usable_for_formats: ["LinkedIn Carousel"],
              usage_limitations: [],
              status: "partial" as const,
            },
          ].slice(-20);
          state.evidence_library.assets.status = "partial";
          state.evidence_library.assets.verification_state = verificationState;
          state.evidence_library.assets.last_updated_at = now;
        }
        break;
      }
      case "evidence_library.source_material_links": {
        const value = String(fact.normalized_value).trim();
        changed = value.length > 0;
        if (value) {
          state.evidence_library.source_material_links = [
            ...state.evidence_library.source_material_links,
            {
              label: value,
              url: value,
              material_type: "link",
              relevance_note: "user shared",
              status: "partial" as const,
            },
          ].slice(-20);
        }
        break;
      }
      default:
        break;
    }

    if (changed) updatedFields.push(fact.field_path);
  }

  for (const confirmation of extraction.confirmations) {
    if (confirmation.kind === "slot_summary_confirm" && confirmation.target_slot_id) {
      confirmPreviewSlots(state, [confirmation.target_slot_id]);
      confirmedSlotIds.push(confirmation.target_slot_id);
      if (state.workflow.pending_confirmation_slot_id === confirmation.target_slot_id) {
        state.workflow.pending_confirmation_slot_id = null;
      }
    }

    if (confirmation.kind === "section_confirm" && state.workflow.pending_review_section_id) {
      const sectionId = state.workflow.pending_review_section_id;
      confirmPreviewSectionSlots(state, sectionId);
      const advanced = confirmPendingSectionAndAdvance(state, sectionId);
      if (advanced) {
        confirmedSectionId = sectionId;
      }
    }
  }

  const bucketed = classifyUpdatedFields({
    state,
    updatedFields,
    activeSlotId: params.activeSlotId,
    activeSectionId: params.activeSectionId,
  });

  const noNewAnswer =
    updatedFields.length === 0 &&
    confirmedSlotIds.length === 0 &&
    confirmedSectionId == null;

  const extractionOutput: ExtractionOutput = {
    active_slot_updates: bucketed.activeSlotUpdates,
    current_section_supporting_updates: bucketed.currentSectionSupportingUpdates,
    cross_slot_candidates: bucketed.crossSectionCandidates,
    answered_active_slot: bucketed.activeSlotUpdates.length > 0 || confirmedSlotIds.includes(params.activeSlotId ?? ""),
    no_new_answer: noNewAnswer,
    reason: confirmedSectionId
      ? "section_confirmed"
      : confirmedSlotIds.length > 0
        ? "slot_confirmed"
        : bucketed.activeSlotUpdates.length > 0
          ? "active_slot_updated"
          : bucketed.currentSectionSupportingUpdates.length > 0
            ? "current_section_supporting_updated"
            : bucketed.crossSectionCandidates.length > 0
              ? "cross_section_candidates_only"
              : "no_new_answer",
    evidence: extraction.evidence.map((item) => ({
      ...item,
      turn_id: params.sourceTurnId,
    })),
    confidence: {
      active_slot: bucketed.activeSlotUpdates.length > 0 || confirmedSlotIds.includes(params.activeSlotId ?? "") ? 0.9 : 0.2,
      current_section: bucketed.currentSectionSupportingUpdates.length > 0 ? 0.7 : 0.1,
      cross_slot: bucketed.crossSectionCandidates.length > 0 ? 0.55 : 0.1,
    },
  };

  const checklistItemsAdvanced = advanceChecklistItems(
    state,
    [
      ...extractionOutput.active_slot_updates,
      ...extractionOutput.current_section_supporting_updates,
    ],
    params.sourceTurnId,
    params.sectionIndexBefore,
  );

  syncWorkflowState(state);
  updateDiagnostics({
    state,
    userMessage: params.userMessage,
    updatedFields,
    checklistItemsAdvanced,
    extractionOutput,
    confirmationsApplied: [
      ...confirmedSlotIds,
      ...(confirmedSectionId ? [confirmedSectionId] : []),
    ],
  });

  return {
    updated_fields: updatedFields,
    confirmed_slot_ids: confirmedSlotIds,
    confirmed_section_id: confirmedSectionId,
    checklist_items_advanced: checklistItemsAdvanced,
    extraction_contract_summary: extractionOutput,
  };
}
