import { randomUUID } from "crypto";
import {
  CompletionLevel,
  FieldStatus,
  InterviewState,
  ModuleStatus,
  OutputFormat,
  StatusValue,
  VerificationState,
} from "@/lib/types";
import { createDefaultChecklist } from "@/server/rules/checklist";

const RUNTIME_VERSION = "3.0.0";
const STATE_SCHEMA_VERSION = "3";

function nowIso() {
  return new Date().toISOString();
}

export function statusValue<T>(
  value: T,
  status: FieldStatus = "missing",
  aiSuggested = false,
  verificationState: VerificationState = "unverified",
): StatusValue<T> {
  return {
    value,
    status,
    ai_suggested: aiSuggested,
    verification_state: verificationState,
    last_updated_at: nowIso(),
  };
}

function emptyPreviewMeta() {
  return {
    user_confirmed: false,
    user_edited: false,
    sensitivity_flag: false,
    public_usage_allowed: true,
    last_user_action: "none" as const,
  };
}

export function createInitialState(interviewId?: string): InterviewState {
  const id = interviewId ?? randomUUID();
  return {
    conversation_meta: {
      interview_id: id,
      language: "en",
      interview_stage: "opening",
      user_engagement_level: "high",
      needs_human_review: false,
      handoff_reason: null,
      current_section_index: 0,
      current_focus_modules: ["company_profile"],
      current_focus_checklist_ids: ["cp_what_does_company_do"],
      last_planner_move: null,
      last_planner_reason: null,
      model_provider: null,
      model_name: null,
      tool_call_trace_ids: [],
      current_section_turn_count: 0,
      runtime_version: RUNTIME_VERSION,
      state_schema_version: STATE_SCHEMA_VERSION,
    },

    checklist: createDefaultChecklist(),
    workflow: {
      phase: "interviewing",
      active_section_id: "company_understanding",
      pending_review_section_id: null,
      pending_confirmation_slot_id: null,
      pending_interaction_module: null,
      next_question_slot_id: null,
      required_open_slot_ids: [],
      transition_allowed: false,
      last_transition_reason: "initialized",
    },

    company_profile: {
      company_name: statusValue(""),
      company_one_liner: statusValue(""),
      company_description_long: statusValue(""),
      industry: statusValue<string[]>([]),
      business_model: statusValue<string[]>([]),
      company_stage: statusValue<string | null>(null),
      company_size_range: statusValue<string | null>(null),
      geographic_focus: statusValue<string[]>([]),
      official_website: null,
      linkedin_presence_links: [],
      company_keywords: [],
    },

    brand_story: {
      founding_story: statusValue(""),
      origin_context: statusValue(""),
      mission_statement: statusValue(""),
      core_belief: statusValue(""),
      brand_promise: statusValue(""),
      most_proud_moment: statusValue(""),
      what_should_people_remember: statusValue(""),
      brand_personality_traits: statusValue<string[]>([]),
      strategic_narratives: statusValue<string[]>([]),
      unresolved_story_gaps: [],
    },

    product_service: {
      core_offerings: statusValue([], "missing"),
      primary_offering: statusValue(null, "missing"),
      secondary_offerings: [],
      problem_solved: statusValue<string[]>([]),
      key_differentiators: statusValue<string[]>([]),
      competitive_alternatives: [],
      customer_value_outcomes: statusValue<string[]>([]),
      delivery_model: [],
      pricing_model_if_relevant: null,
      feature_clusters: [],
      proof_of_effectiveness_summary: statusValue(""),
    },

    market_audience: {
      primary_audience: statusValue(null, "missing"),
      secondary_audiences: [],
      audience_roles: statusValue<string[]>([]),
      audience_industries: statusValue<string[]>([]),
      audience_company_size: statusValue<string[]>([]),
      audience_regions: statusValue<string[]>([]),
      buyer_vs_user_notes: "",
      audience_pain_points: statusValue<string[]>([]),
      audience_desired_outcomes: statusValue<string[]>([]),
      audience_objections: statusValue<string[]>([]),
      audience_language_cues: [],
      attraction_goal: statusValue(""),
    },

    linkedin_content_strategy: {
      primary_content_goal: statusValue(""),
      secondary_content_goals: [],
      current_linkedin_activity_level: statusValue<string | null>(null),
      current_content_types: statusValue<string[]>([]),
      content_gaps_today: statusValue<string[]>([]),
      desired_content_formats: statusValue<string[]>([]),
      priority_format: statusValue(""),
      desired_brand_perception: statusValue<string[]>([]),
      successful_reference_accounts: [],
      topics_they_want_to_talk_about: statusValue<string[]>([]),
      topics_to_avoid_or_deprioritize: statusValue<string[]>([]),
      content_series_opportunities: [],
      call_to_action_preferences: [],
      content_distribution_notes: "",
    },

    content_preferences: {
      preferred_tone: statusValue<string[]>([]),
      preferred_voice: statusValue<string[]>([]),
      preferred_style_tags: statusValue<string[]>([]),
      preferred_visual_style: statusValue<string[]>([]),
      preferred_structure_patterns: [],
      preferred_content_depth: statusValue(""),
      preferred_emotional_effect: statusValue<string[]>([]),
      preferred_message_density: "",
      preferred_brand_positioning_style: [],
      preferred_examples_of_good_content: [],
    },

    content_dislikes: {
      disliked_tone: statusValue<string[]>([]),
      disliked_visual_style: statusValue<string[]>([]),
      disliked_messaging_patterns: statusValue<string[]>([]),
      disliked_content_examples: [],
      brand_risk_triggers: statusValue<string[]>([]),
      red_flag_phrases: [],
      things_that_feel_too_marketing: statusValue<string[]>([]),
    },

    evidence_library: {
      case_studies: statusValue([], "missing"),
      metrics_and_proof_points: statusValue([], "missing"),
      assets: statusValue([], "missing"),
      milestones_and_updates: statusValue([], "missing"),
      source_material_links: [],
      strongest_proof_points: statusValue<string[]>([]),
      missing_proof_areas: statusValue<string[]>([]),
      evidence_readiness_score: 0,
    },

    constraints_and_boundaries: {
      forbidden_topics: statusValue<string[]>([]),
      sensitive_topics: statusValue<string[]>([]),
      confidential_information_types: statusValue<string[]>([]),
      non_public_clients_or_brands: [],
      competitor_mention_policy: statusValue(""),
      pricing_mention_policy: statusValue(""),
      claims_policy: statusValue(""),
      visual_boundary_notes: statusValue<string[]>([]),
      tone_boundaries: statusValue<string[]>([]),
      compliance_or_legal_notes: [],
      internal_only_notes: [],
    },

    user_concerns: {
      main_concerns: statusValue<string[]>([]),
      past_content_problems: statusValue<string[]>([]),
      fear_of_misrepresentation: statusValue<string[]>([]),
      unclear_areas_for_user: statusValue<string[]>([]),
      most_desired_ai_help: statusValue<string[]>([]),
      confidence_gaps: [],
      handoff_sensitive_points: [],
    },

    content_readiness: {
      ai_suggested_first_content_topic: statusValue("", "missing", true),
      ai_suggested_first_content_format: statusValue("", "missing", true),
      ai_suggested_first_content_goal: statusValue("", "missing", true),
      ai_suggested_first_content_angle: statusValue("", "missing", true),
      ai_suggested_first_content_audience: statusValue("", "missing", true),
      ai_suggested_first_content_proof: statusValue<string[]>([], "missing", true),
      required_missing_inputs_for_first_content: statusValue<string[]>([]),
      first_content_readiness_score: 0,
      brief_can_be_generated_now: false,
      readiness_explanation: "",
      alternative_first_topic_options: [],
    },

    system_assessment: {
      field_completion_map: {},
      module_completion_map: {
        company_profile: "not_started",
        brand_story: "not_started",
        product_service: "not_started",
        market_audience: "not_started",
        linkedin_content_strategy: "not_started",
        content_preferences: "not_started",
        evidence_library: "not_started",
        content_dislikes: "not_started",
        constraints_and_boundaries: "not_started",
        user_concerns: "not_started",
        content_readiness: "not_started",
      },
      checklist_completion_map: {},
      global_completion_score: 0,
      highest_priority_missing_fields: [],
      highest_priority_partial_fields: [],
      clarification_queue: [],
      user_fatigue_risk: "low",
      recommended_next_question: "Could you briefly describe what your company does?",
      ready_for_checkpoint_summary: false,
      ready_for_final_review: false,
      follow_up_attempts: {},
      follow_up_candidates: [],
      checkpoint_approved: false,
      confidence_scores: {
        company_understanding: 0,
        audience_clarity: 0,
        strategy_coherence: 0,
        evidence_strength: 0,
        verification_confidence: 0,
        generation_confidence: 0,
      },
      weak_fields: [],
      missing_fields: [],
      unconfirmed_fields: [],
      red_line_blockers: [],
      open_checklist_items: [],
      resolved_checklist_items: [],
      next_action: "continue",
      loop_guard: {
        target_field: null,
        question_type: null,
        stale_turns: 0,
        triggered: false,
      },
      pending_conflicts: [],
      last_turn_diagnostics: {
        direct_user_facts: [],
        assistant_inferences: [],
        evidence_links: [],
        confidence: 0,
        captured_fields_this_turn: [],
        captured_checklist_items_this_turn: [],
        deferred_fields: [],
        conflicts_detected: [],
        question_reason: "initial",
        tool_actions_used: [],
      },
      last_follow_up_exit_status: null,
      last_planner_action: null,
      last_question_style: null,
      checkpoint_recommended: false,
      last_user_facing_progress_note: "Interview started.",
      model_route_used: null,
      tool_calls_this_turn: [],
      state_updates_this_turn: [],
      planner_confidence: 0,
      preview_slots: [],
      confirmed_slot_ids: [],
      last_turn_intent: null,
      last_extraction_output: null,
      last_contract_validation_result: null,
    },

    preview_projection: {
      company_understanding: {
        company_summary: "",
        short_brand_story: "",
        main_offering: "",
        problem_solved: "",
        differentiator: "",
        verification: [],
        meta: emptyPreviewMeta(),
      },
      audience_understanding: {
        primary_audience: "",
        core_problems: [],
        desired_outcomes: [],
        who_to_attract_on_linkedin: "",
        verification: [],
        meta: emptyPreviewMeta(),
      },
      linkedin_content_strategy: {
        main_content_goal: "",
        content_positioning: "",
        target_impact: [],
        topics_to_emphasize: [],
        topics_to_avoid: [],
        verification: [],
        meta: emptyPreviewMeta(),
      },
      evidence_and_proof: {
        narrative_proof: [],
        metrics_proof_points: [],
        supporting_assets: [],
        evidence_confidence_level: "low",
        missing_proof_areas: [],
        verification: [],
        meta: emptyPreviewMeta(),
      },
      ai_suggested_directions: [],
      generation_plan: {
        planned_first_topic: "",
        planned_format: "",
        intended_structure: [],
        audience_fit: "",
        proof_plan: "",
        verification: [],
        meta: emptyPreviewMeta(),
      },
      turn_delta: {
        what_changed: [],
        sections_updated: [],
        newly_captured: [],
        remains_open: [],
        items_confirmed: [],
      },
      open_items: [],
      confirmation_targets: [
        { id: "company_one_liner", label: "Company One-Liner", confirmed: false, section: "company_understanding" },
        { id: "primary_audience", label: "Primary Audience", confirmed: false, section: "audience_understanding" },
        { id: "main_content_goal", label: "Main Content Goal", confirmed: false, section: "linkedin_content_strategy" },
        { id: "first_topic", label: "First Topic", confirmed: false, section: "generation_plan" },
      ],
      last_preview_update_summary: "Initialized preview",
      preview_revision_log: [{ at: nowIso(), summary: "Preview created" }],
    },
  };
}

export const MODULE_WEIGHTS: Record<string, number> = {
  company_profile: 10,
  brand_story: 10,
  product_service: 10,
  market_audience: 14,
  linkedin_content_strategy: 16,
  content_preferences: 10,
  evidence_library: 16,
  content_dislikes: 4,
  constraints_and_boundaries: 5,
  user_concerns: 3,
  content_readiness: 2,
};

export const HARD_REQUIRED_MODULES = [
  "company_profile",
  "brand_story",
  "product_service",
  "market_audience",
  "linkedin_content_strategy",
  "content_preferences",
  "evidence_library",
] as const;

export const ALLOWED_PARTIAL_MODULES = [
  "content_dislikes",
  "constraints_and_boundaries",
  "user_concerns",
  "content_readiness",
] as const;

export const FATIGUE_PRIORITY_MODULES = [
  "linkedin_content_strategy",
  "market_audience",
  "company_profile",
  "product_service",
  "brand_story",
  "evidence_library",
  "content_preferences",
  "constraints_and_boundaries",
  "user_concerns",
  "content_dislikes",
  "content_readiness",
] as const;

export const DEFAULT_GENERATION_FORMAT: OutputFormat = "linkedin_carousel";

export function moduleScore(status: ModuleStatus): number {
  if (status === "verified") return 1;
  if (status === "strong") return 1;
  if (status === "partial") return 0.5;
  return 0;
}

export function completionByScore(score: number): CompletionLevel {
  if (score >= 75) return "generation_ready";
  if (score >= 55) return "minimally_ready";
  return "incomplete";
}
