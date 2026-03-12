// ── Status & Enum Types ─────────────────────────────────────────────

export type FieldStatus = "missing" | "partial" | "strong" | "verified";
export type VerificationState = "unverified" | "user_confirmed" | "ai_inferred" | "contradicted";
export type ModuleStatus = "not_started" | "partial" | "strong" | "verified";
export type CompletionLevel = "incomplete" | "minimally_ready" | "generation_ready" | "handoff_ready";
export type ChecklistItemStatus = "unanswered" | "partial" | "answered" | "verified" | "not_applicable";

export type InterviewStage =
  | "opening"
  | "discovery"
  | "clarification"
  | "checkpoint"
  | "generation_planning"
  | "generation"
  | "handoff"
  | "completed";

export type UserEngagementLevel = "low" | "medium" | "high";

export type QuestionType =
  | "open"
  | "clarify"
  | "contrast"
  | "example"
  | "confirm"
  | "ai_suggest"
  | "proof_request"
  | "narrow";

export type FollowUpExitStatus = "resolved" | "good_enough_for_now" | "defer_and_continue";
export type PlannerAction = "ask" | "confirm" | "summarize" | "checkpoint" | "handoff" | "generate_brief";
export type TaskType = "answer_question" | "ask_for_help" | "other_discussion";

export type QuestionStyle =
  | "reflect_and_advance"
  | "synthesize_and_confirm"
  | "resolve_conflict_once"
  | "checkpoint_summary"
  | "guided_choice"
  | "handoff_explain";

export type ChatBookEntryType = "direct_user_fact" | "assistant_inference" | "conflict" | "checkpoint" | "strategy_note";
export type ChatBookEntryStatus = "active" | "resolved" | "superseded";

export type OutputFormat = "linkedin_carousel" | "linkedin_long_image" | "linkedin_short_video_script" | "linkedin_post_copy";

// ── Core Value Wrappers ─────────────────────────────────────────────

export interface StatusValue<T> {
  value: T;
  status: FieldStatus;
  confidence?: number;
  verification_state?: VerificationState;
  source_turn_ids?: string[];
  last_updated_at?: string;
  ai_suggested?: boolean;
}

// ── Checklist Model (v3) ────────────────────────────────────────────

export interface ChecklistItem {
  id: string;
  module: string;
  question_label: string;
  question_intent: string;
  status: ChecklistItemStatus;
  answer_summary: string;
  evidence_for_answer: string[];
  evidence_confidence: number;
  supporting_turn_ids: string[];
  filled_from_fields: string[];
  priority: "critical" | "high" | "medium" | "low";
  last_touched_turn_id: string | null;
  verification_needed: boolean;
}

// ── Tracking & Diagnostics ──────────────────────────────────────────

export interface FollowUpTracker {
  attempts: number;
  last_question_type?: QuestionType;
  last_asked_at?: string;
}

export interface ConflictRecord {
  field: string;
  conflicting_values: string[];
  status: "pending" | "resolved" | "downgraded";
  asks: number;
  created_at: string;
  updated_at: string;
}

export interface TurnDiagnostics {
  direct_user_facts: string[];
  assistant_inferences: string[];
  evidence_links: string[];
  confidence: number;
  captured_fields_this_turn: string[];
  captured_checklist_items_this_turn: string[];
  deferred_fields: string[];
  conflicts_detected: string[];
  question_reason: string;
  tool_actions_used: string[];
}

// ── Conversation Meta (v3) ──────────────────────────────────────────

export interface ConversationMeta {
  interview_id: string;
  language: string;
  interview_stage: InterviewStage;
  user_engagement_level: UserEngagementLevel;
  needs_human_review: boolean;
  handoff_reason: string | null;
  current_section_index: number;
  current_focus_modules: string[];
  current_focus_checklist_ids: string[];
  last_planner_move: PlannerAction | null;
  last_planner_reason: string | null;
  model_provider: string | null;
  model_name: string | null;
  tool_call_trace_ids: string[];
  current_section_turn_count: number;
  runtime_version: string;
  state_schema_version: string;
}

export type WorkflowPhase =
  | "interviewing"
  | "confirming_section"
  | "structured_help_selection"
  | "checkpoint"
  | "generation_ready"
  | "handoff";

export type InteractionModuleType = "confirm_section" | "select_help_option" | "none";

export interface InteractionModule {
  type: InteractionModuleType;
  payload: Record<string, unknown>;
}

export interface InterviewWorkflowState {
  phase: WorkflowPhase;
  active_section_id: PreviewSectionId;
  pending_review_section_id: PreviewSectionId | null;
  pending_interaction_module: InteractionModuleType | null;
  next_question_slot_id: string | null;
  required_open_slot_ids: string[];
  transition_allowed: boolean;
  last_transition_reason: string | null;
}

export interface PlannerClassification {
  task_type: TaskType;
  rationale: string;
}

export interface StructuredChoiceOption {
  id: string;
  label: string;
  value: string;
}

export interface StructuredChoicePrompt {
  slot_id: string;
  prompt: string;
  options: StructuredChoiceOption[];
  allow_other: boolean;
  other_placeholder?: string;
}

// ── Domain Sub-Types ────────────────────────────────────────────────

export interface CoreOffering {
  name: string;
  type: string;
  description: string;
  target_user: string;
  main_use_case: string;
  status: FieldStatus;
}

export interface AudienceProfile {
  label: string;
  roles: string[];
  industries: string[];
  company_size: string[];
  regions: string[];
  pain_points: string[];
  desired_outcomes: string[];
  content_resonance_angle: string;
  status: FieldStatus;
}

export interface ReferenceAccount {
  name_or_link: string;
  what_they_like: string;
  format_type: string;
  style_tags: string[];
}

export interface CaseStudy {
  title: string;
  client_type: string;
  problem: string;
  solution: string;
  result: string;
  metrics: string[];
  permission_level: string;
  status: FieldStatus;
}

export interface MetricProof {
  metric_name: string;
  metric_value: string;
  metric_context: string;
  timeframe: string;
  confidence_level: string;
  can_publish_publicly: boolean;
  status: FieldStatus;
}

export interface ContentAsset {
  asset_type: string;
  asset_name: string;
  description: string;
  link_or_storage_ref: string | null;
  usable_for_formats: string[];
  usage_limitations: string[];
  status: FieldStatus;
}

export interface Milestone {
  title: string;
  description: string;
  date_or_period: string;
  importance_level: string;
  can_publish_publicly: boolean;
  status: FieldStatus;
}

export interface SourceMaterialLink {
  label: string;
  url: string;
  material_type: string;
  relevance_note: string;
  status: FieldStatus;
}

export interface ClarificationItem {
  target_field: string;
  reason: string;
  priority: "high" | "medium" | "low";
  suggested_question_style: string;
  status: "pending" | "in_progress" | "resolved";
}

// ── Preview Projection (v3 – 6 sections) ───────────────────────────

export interface VerificationIndicator {
  label: string;
  state: "confirmed_by_user" | "inferred_from_conversation" | "needs_confirmation";
}

export interface PreviewBlockMeta {
  user_confirmed: boolean;
  user_edited: boolean;
  sensitivity_flag: boolean;
  public_usage_allowed: boolean;
  last_user_action: "confirm" | "edit" | "add_detail" | "mark_sensitive" | "hide_from_output" | "none";
}

export interface PreviewProjection {
  company_understanding: {
    company_summary: string;
    short_brand_story: string;
    main_offering: string;
    problem_solved: string;
    differentiator: string;
    verification: VerificationIndicator[];
    meta: PreviewBlockMeta;
  };
  audience_understanding: {
    primary_audience: string;
    core_problems: string[];
    desired_outcomes: string[];
    who_to_attract_on_linkedin: string;
    verification: VerificationIndicator[];
    meta: PreviewBlockMeta;
  };
  linkedin_content_strategy: {
    main_content_goal: string;
    content_positioning: string;
    target_impact: string[];
    topics_to_emphasize: string[];
    topics_to_avoid: string[];
    verification: VerificationIndicator[];
    meta: PreviewBlockMeta;
  };
  evidence_and_proof: {
    narrative_proof: string[];
    metrics_proof_points: string[];
    supporting_assets: string[];
    evidence_confidence_level: string;
    missing_proof_areas: string[];
    verification: VerificationIndicator[];
    meta: PreviewBlockMeta;
  };
  ai_suggested_directions: Array<{
    topic: string;
    format: string;
    angle: string;
    why_it_fits: string;
  }>;
  generation_plan: {
    planned_first_topic: string;
    planned_format: string;
    intended_structure: string[];
    audience_fit: string;
    proof_plan: string;
    verification: VerificationIndicator[];
    meta: PreviewBlockMeta;
  };
  turn_delta: {
    what_changed: string[];
    sections_updated: string[];
    newly_captured: string[];
    remains_open: string[];
    items_confirmed: string[];
  };
  open_items: Array<{
    human_label: string;
    priority: "critical_before_generation" | "helpful_but_optional";
  }>;
  confirmation_targets: Array<{
    id: string;
    label: string;
    confirmed: boolean;
    section: string;
  }>;
  last_preview_update_summary: string;
  preview_revision_log: Array<{ at: string; summary: string }>;
}

export type PreviewSectionId =
  | "company_understanding"
  | "audience_understanding"
  | "linkedin_content_strategy"
  | "evidence_and_proof_assets"
  | "content_preferences_and_boundaries"
  | "generation_plan";

export type PreviewSlotStatus = "missing" | "weak" | "strong" | "verified";

export interface PreviewSlot {
  id: string;
  section: PreviewSectionId;
  label: string;
  question_label: string;
  question_intent: string;
  question_target_field: string;
  value: string | string[];
  display_value: string | string[];
  status: PreviewSlotStatus;
  verification_state: VerificationState | "mixed";
  source_fields: string[];
  checklist_item_ids: string[];
  required_for_section_completion: boolean;
  blocking_priority: "critical" | "high" | "medium" | "low";
  last_updated_at: string | null;
}

// ── System Assessment (v3) ──────────────────────────────────────────

export interface SystemAssessment {
  field_completion_map: Record<string, FieldStatus>;
  module_completion_map: Record<string, ModuleStatus>;
  checklist_completion_map: Record<string, { total: number; answered: number; verified: number }>;
  global_completion_score: number;
  highest_priority_missing_fields: string[];
  highest_priority_partial_fields: string[];
  clarification_queue: ClarificationItem[];
  user_fatigue_risk: "low" | "medium" | "high";
  recommended_next_question: string;
  ready_for_checkpoint_summary: boolean;
  ready_for_final_review: boolean;
  follow_up_attempts: Record<string, FollowUpTracker>;
  follow_up_candidates: string[];
  checkpoint_approved: boolean;
  confidence_scores: {
    company_understanding: number;
    audience_clarity: number;
    strategy_coherence: number;
    evidence_strength: number;
    verification_confidence: number;
    generation_confidence: number;
  };
  weak_fields: string[];
  missing_fields: string[];
  unconfirmed_fields: string[];
  red_line_blockers: string[];
  open_checklist_items: string[];
  resolved_checklist_items: string[];
  next_action: "continue" | "checkpoint" | "generate_brief" | "handoff";
  loop_guard: {
    target_field: string | null;
    question_type: QuestionType | null;
    stale_turns: number;
    triggered: boolean;
  };
  pending_conflicts: ConflictRecord[];
  last_turn_diagnostics: TurnDiagnostics;
  last_follow_up_exit_status: FollowUpExitStatus | null;
  last_planner_action: PlannerAction | null;
  last_question_style: QuestionStyle | null;
  checkpoint_recommended: boolean;
  last_user_facing_progress_note: string;
  model_route_used: string | null;
  tool_calls_this_turn: string[];
  state_updates_this_turn: string[];
  planner_confidence: number;
  preview_slots: PreviewSlot[];
  confirmed_slot_ids: string[];
}

// ── Main Interview State (v3) ───────────────────────────────────────

export interface InterviewState {
  conversation_meta: ConversationMeta;
  checklist: ChecklistItem[];
  workflow: InterviewWorkflowState;

  company_profile: {
    company_name: StatusValue<string>;
    company_one_liner: StatusValue<string>;
    company_description_long: StatusValue<string>;
    industry: StatusValue<string[]>;
    business_model: StatusValue<string[]>;
    company_stage: StatusValue<string | null>;
    company_size_range: StatusValue<string | null>;
    geographic_focus: StatusValue<string[]>;
    official_website: string | null;
    linkedin_presence_links: string[];
    company_keywords: string[];
  };

  brand_story: {
    founding_story: StatusValue<string>;
    origin_context: StatusValue<string>;
    mission_statement: StatusValue<string>;
    core_belief: StatusValue<string>;
    brand_promise: StatusValue<string>;
    most_proud_moment: StatusValue<string>;
    what_should_people_remember: StatusValue<string>;
    brand_personality_traits: StatusValue<string[]>;
    strategic_narratives: StatusValue<string[]>;
    unresolved_story_gaps: string[];
  };

  product_service: {
    core_offerings: StatusValue<CoreOffering[]>;
    primary_offering: StatusValue<CoreOffering | null>;
    secondary_offerings: CoreOffering[];
    problem_solved: StatusValue<string[]>;
    key_differentiators: StatusValue<string[]>;
    competitive_alternatives: string[];
    customer_value_outcomes: StatusValue<string[]>;
    delivery_model: string[];
    pricing_model_if_relevant: string | null;
    feature_clusters: string[];
    proof_of_effectiveness_summary: StatusValue<string>;
  };

  market_audience: {
    primary_audience: StatusValue<AudienceProfile | null>;
    secondary_audiences: AudienceProfile[];
    audience_roles: StatusValue<string[]>;
    audience_industries: StatusValue<string[]>;
    audience_company_size: StatusValue<string[]>;
    audience_regions: StatusValue<string[]>;
    buyer_vs_user_notes: string;
    audience_pain_points: StatusValue<string[]>;
    audience_desired_outcomes: StatusValue<string[]>;
    audience_objections: StatusValue<string[]>;
    audience_language_cues: string[];
    attraction_goal: StatusValue<string>;
  };

  linkedin_content_strategy: {
    primary_content_goal: StatusValue<string>;
    secondary_content_goals: string[];
    current_linkedin_activity_level: StatusValue<string | null>;
    current_content_types: StatusValue<string[]>;
    content_gaps_today: StatusValue<string[]>;
    desired_content_formats: StatusValue<string[]>;
    priority_format: StatusValue<string>;
    desired_brand_perception: StatusValue<string[]>;
    successful_reference_accounts: ReferenceAccount[];
    topics_they_want_to_talk_about: StatusValue<string[]>;
    topics_to_avoid_or_deprioritize: StatusValue<string[]>;
    content_series_opportunities: string[];
    call_to_action_preferences: string[];
    content_distribution_notes: string;
  };

  content_preferences: {
    preferred_tone: StatusValue<string[]>;
    preferred_voice: StatusValue<string[]>;
    preferred_style_tags: StatusValue<string[]>;
    preferred_visual_style: StatusValue<string[]>;
    preferred_structure_patterns: string[];
    preferred_content_depth: StatusValue<string>;
    preferred_emotional_effect: StatusValue<string[]>;
    preferred_message_density: string;
    preferred_brand_positioning_style: string[];
    preferred_examples_of_good_content: ReferenceAccount[];
  };

  content_dislikes: {
    disliked_tone: StatusValue<string[]>;
    disliked_visual_style: StatusValue<string[]>;
    disliked_messaging_patterns: StatusValue<string[]>;
    disliked_content_examples: ReferenceAccount[];
    brand_risk_triggers: StatusValue<string[]>;
    red_flag_phrases: string[];
    things_that_feel_too_marketing: StatusValue<string[]>;
  };

  evidence_library: {
    case_studies: StatusValue<CaseStudy[]>;
    metrics_and_proof_points: StatusValue<MetricProof[]>;
    assets: StatusValue<ContentAsset[]>;
    milestones_and_updates: StatusValue<Milestone[]>;
    source_material_links: SourceMaterialLink[];
    strongest_proof_points: StatusValue<string[]>;
    missing_proof_areas: StatusValue<string[]>;
    evidence_readiness_score: number;
  };

  constraints_and_boundaries: {
    forbidden_topics: StatusValue<string[]>;
    sensitive_topics: StatusValue<string[]>;
    confidential_information_types: StatusValue<string[]>;
    non_public_clients_or_brands: string[];
    competitor_mention_policy: StatusValue<string>;
    pricing_mention_policy: StatusValue<string>;
    claims_policy: StatusValue<string>;
    visual_boundary_notes: StatusValue<string[]>;
    tone_boundaries: StatusValue<string[]>;
    compliance_or_legal_notes: string[];
    internal_only_notes: string[];
  };

  user_concerns: {
    main_concerns: StatusValue<string[]>;
    past_content_problems: StatusValue<string[]>;
    fear_of_misrepresentation: StatusValue<string[]>;
    unclear_areas_for_user: StatusValue<string[]>;
    most_desired_ai_help: StatusValue<string[]>;
    confidence_gaps: string[];
    handoff_sensitive_points: string[];
  };

  content_readiness: {
    ai_suggested_first_content_topic: StatusValue<string>;
    ai_suggested_first_content_format: StatusValue<string>;
    ai_suggested_first_content_goal: StatusValue<string>;
    ai_suggested_first_content_angle: StatusValue<string>;
    ai_suggested_first_content_audience: StatusValue<string>;
    ai_suggested_first_content_proof: StatusValue<string[]>;
    required_missing_inputs_for_first_content: StatusValue<string[]>;
    first_content_readiness_score: number;
    brief_can_be_generated_now: boolean;
    readiness_explanation: string;
    alternative_first_topic_options: string[];
  };

  system_assessment: SystemAssessment;
  preview_projection: PreviewProjection;
}

// ── Completion State (v3 output) ────────────────────────────────────

export interface CompletionState {
  completion_level: CompletionLevel;
  completion_score: number;
  generation_permission_flag: boolean;
  missing_fields: string[];
  weak_fields: string[];
  unconfirmed_fields: string[];
  red_line_blockers: string[];
  open_checklist_items: string[];
  checkpoint_recommended: boolean;
  next_best_move: PlannerAction;
  verification_coverage: number;
  evidence_confidence_score: number;
  planner_confidence: number;
  model_route_used: string | null;
}

// ── Session & Message Types ─────────────────────────────────────────

export interface InterviewMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface InterviewSession {
  id: string;
  user_id: string;
  status: InterviewStage;
  current_module: string;
  current_question_id: string;
  completion_level: CompletionLevel;
  completion_score: number;
  model_primary: string;
  model_fallback: string;
  state_schema_version: string;
  created_at: string;
  updated_at: string;
}

export interface GeneratedBrief {
  id: string;
  session_id: string;
  format: OutputFormat;
  brief_jsonb: Record<string, unknown>;
  approved: boolean;
  created_at: string;
}

export interface GeneratedContent {
  id: string;
  session_id: string;
  brief_id: string;
  format: OutputFormat;
  content_jsonb: Record<string, unknown>;
  created_at: string;
}

export interface HandoffSummary {
  id: string;
  session_id: string;
  summary_jsonb: Record<string, unknown>;
  created_at: string;
}

export interface ChatBookEntry {
  id: string;
  session_id: string;
  entry_type: ChatBookEntryType;
  text: string;
  module: string | null;
  confidence: number;
  status: ChatBookEntryStatus;
  source_turn_ids: string[];
  metadata_json: Record<string, unknown>;
  created_at: string;
}

export interface PlannerDecision {
  id: string;
  session_id: string;
  turn_id: string;
  chosen_action: PlannerAction;
  question_style: QuestionStyle;
  rationale: string;
  target_fields: string[];
  created_at: string;
}

export interface PayloadPatchLog {
  id: string;
  session_id: string;
  turn_id: string;
  patch_json: Record<string, unknown>;
  applied_by_tool: string;
  created_at: string;
}

export interface ToolActionLog {
  id: string;
  session_id: string;
  turn_id: string;
  tool_name: string;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  success: boolean;
  created_at: string;
}

export interface CheckpointSnapshot {
  id: string;
  session_id: string;
  snapshot_json: Record<string, unknown>;
  user_confirmed: boolean;
  created_at: string;
}

export interface SessionTrace {
  session_id: string;
  planner_decisions: PlannerDecision[];
  tool_action_log: ToolActionLog[];
  payload_patch_log: PayloadPatchLog[];
  checkpoint_snapshots: CheckpointSnapshot[];
}

// ── Runtime Metadata (v3 – observability) ───────────────────────────

export interface RuntimeMetadata {
  planner_trace: Array<{ turn_id: string; action: PlannerAction; reason: string; at: string }>;
  tool_execution_log: Array<{ turn_id: string; tool: string; success: boolean; at: string }>;
  model_routing_history: Array<{ turn_id: string; model: string; provider: string; at: string }>;
  state_change_log: Array<{ turn_id: string; changed_fields: string[]; at: string }>;
  checkpoint_history: Array<{ turn_id: string; approved: boolean; at: string }>;
}

export interface AgentTurnResult {
  assistant_message: string;
  interaction_module: InteractionModule;
  updated_preview: Record<string, unknown>;
  workflow_state: InterviewWorkflowState;
  planner_task_type: TaskType;
  model_route_used: Record<string, unknown> | null;
  tool_trace: ToolActionLog[];
  planner_trace: Record<string, unknown>;
}
