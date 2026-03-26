export type AskmoreV2Language = "en" | "zh";
export type AskmoreV2FlowStatus = "draft" | "published";
export type AskmoreV2SessionStatus = "in_progress" | "completed";
export type AskmoreV2QuestionDifficulty = "low" | "medium" | "high";
export type AskmoreV2AnswerStatus = "empty" | "partial" | "completed" | "skipped";
export type AskmoreV2TurnAnswerStatus = "complete" | "partial" | "off_topic";
export type AskmoreV2NextAction = "advance_to_next_question" | "ask_clarification" | "show_summary" | "end_interview";
export type AskmoreV2Intent = "answer_question" | "ask_for_help" | "clarify_meaning" | "other_discussion";
export type AskmoreV2SelectionMode = "use_original" | "use_ai_refined" | "custom_manual";
export type AskmoreV2NodeStatus = "not_started" | "partial" | "complete";
export type AskmoreV2DimensionPriority = "must" | "optional";
export type AskmoreV2DimensionAnswerState =
  | "unanswered"
  | "answered_unstructured"
  | "micro_confirm_pending"
  | "structured_confirmed";
export type AskmoreV2UnresolvedReason =
  | "semantic_unmapped"
  | "ambiguous_temporal"
  | "contradictory"
  | "too_short";
export type AskmoreV2PlannerAction =
  | "micro_confirm_then_clarify"
  | "micro_confirm_then_advance"
  | "node_wrap_up"
  | "offer_early_summary"
  | "end_interview";
export type AskmoreV2AnswerQuality = "clear" | "usable" | "vague" | "off_topic";
export type AskmoreV2HelpObstacleLayer = "concept" | "observation" | "judgement" | "expression" | "scope";
export type AskmoreV2HelpResolutionGoal =
  | "identify_behavior_signal"
  | "estimate_frequency"
  | "describe_duration"
  | "describe_timeline";

export interface AskmoreV2QuestionEvaluation {
  is_too_broad: boolean;
  is_too_abstract: boolean;
  difficulty: AskmoreV2QuestionDifficulty;
}

export interface AskmoreV2QuestionCandidate {
  entry_question: string;
  sub_questions: string[];
  example_answer_styles: string[];
  recommended_strategy: string;
}

export interface AskmoreV2QuestionFinalPayload extends AskmoreV2QuestionCandidate {
  source_mode: AskmoreV2SelectionMode;
}

export interface AskmoreV2QuestionAnalysis {
  evaluation: AskmoreV2QuestionEvaluation;
  reason: string;
}

export interface AskmoreV2ReviewGenerationMeta {
  used_fallback: boolean;
  fallback_count: number;
}

export interface AskmoreV2QuestionCard {
  question_id: string;
  original_question: string;
  analysis: AskmoreV2QuestionAnalysis;
  ai_candidate: AskmoreV2QuestionCandidate;
  selection: {
    mode: AskmoreV2SelectionMode;
  };
  final_payload: AskmoreV2QuestionFinalPayload;
  review_generation_meta?: {
    used_fallback: boolean;
  };
}

export interface AskmoreV2FlowQuestion extends AskmoreV2QuestionCandidate {
  question_id: string;
  original_question: string;
  source_mode: AskmoreV2SelectionMode;
}

export interface AskmoreV2QuestionNodeDimension {
  id: string;
  label: string;
}

export interface AskmoreV2QuestionNode {
  question_id: string;
  goal: string;
  user_facing_entry: string;
  target_dimensions: AskmoreV2QuestionNodeDimension[];
  completion_criteria: string[];
  hypothesis_templates: string[];
  node_summary_template: string;
}

export interface AskmoreV2NodeRuntimeState {
  question_id: string;
  captured_dimensions: Record<string, string>;
  dimension_confidence: Record<string, number>;
  dimension_soft_confidence: Record<string, number>;
  dimension_state?: Record<string, AskmoreV2DimensionAnswerState>;
  dimension_unresolved_reason?: Record<string, AskmoreV2UnresolvedReason | null>;
  dimension_answered: Record<string, boolean>;
  dimension_answered_evidence: Record<string, string>;
  dimension_micro_confirmed: Record<string, boolean>;
  dimension_priority_current?: Record<string, AskmoreV2DimensionPriority>;
  dimension_priority_candidate?: Record<string, AskmoreV2DimensionPriority>;
  dimension_priority_streak?: Record<string, number>;
  dimension_priority_reason?: Record<string, string>;
  dimension_priority_downgraded_by_limit?: Record<string, boolean>;
  clarify_count: number;
  node_status: AskmoreV2NodeStatus;
  candidate_hypothesis: string | null;
  last_node_summary: string | null;
  contradiction_detected: boolean;
  last_micro_confirm_offer: {
    dimension_id: string;
    options: AskmoreV2MicroConfirmOption[];
    offered_at_turn: number;
  } | null;
}

export interface AskmoreV2FlowDefinitionV2 {
  schema_version: 2;
  raw_questions: string[];
  scenario: string;
  target_output_type: string;
  language: AskmoreV2Language;
  cards_snapshot: AskmoreV2QuestionCard[];
  final_flow_questions: AskmoreV2FlowQuestion[];
  review_generation_meta?: AskmoreV2ReviewGenerationMeta;
}

// Legacy v2 shape used by previous release (pre-card model).
export interface AskmoreV2LegacyReviewItem {
  question_id: string;
  original_question: string;
  evaluation: AskmoreV2QuestionEvaluation;
  reason: string;
  recommended_strategy: string;
  entry_question: string;
  sub_questions: string[];
  example_answer_styles: string[];
  adopted: boolean;
}

export interface AskmoreV2LegacyFlowDefinition {
  raw_questions: string[];
  scenario: string;
  target_output_type: string;
  language: AskmoreV2Language;
  review_items: AskmoreV2LegacyReviewItem[];
}

export type AskmoreV2FlowDefinition = AskmoreV2FlowDefinitionV2 | AskmoreV2LegacyFlowDefinition;

export interface AskmoreV2FlowVersion {
  id: string;
  version: number;
  status: AskmoreV2FlowStatus;
  flow_jsonb: AskmoreV2FlowDefinition;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AskmoreV2QuestionProgress {
  question_id: string;
  status: AskmoreV2AnswerStatus;
  times_asked: number;
  follow_up_count: number;
  sub_questions_completed: string[];
  sub_questions_remaining: string[];
  coverage_score: number;
}

export interface AskmoreV2StructuredKnowledgeField {
  value: unknown;
  confidence: number;
  confirmed: boolean;
  updated_at: string;
}

export interface AskmoreV2PendingCommitment {
  id: string;
  type: "micro_confirm" | "pending_correction" | "follow_up";
  status?: "pending" | "resolved" | "expired";
  question_id: string | null;
  dimension_id?: string | null;
  note?: string | null;
  created_at: string;
  expires_at?: string | null;
  resolved_at?: string | null;
  expired_at?: string | null;
  resolution_note?: string | null;
  resolved_turn_index?: number | null;
}

export interface AskmoreV2SessionState {
  session: {
    current_question_id: string | null;
    current_sub_question_index: number;
    active_turn_index?: number;
    pending_intent?: AskmoreV2Intent | null;
    pending_commitments?: AskmoreV2PendingCommitment[];
    summary_generated: boolean;
    finalized: boolean;
    pending_end_confirmation: boolean;
    last_missing_points: string[];
    last_understanding_feedback: string | null;
  };
  recent_user_turns: string[];
  recent_dimension_prompts: string[];
  nodes: Record<string, AskmoreV2QuestionNode>;
  node_runtime: Record<string, AskmoreV2NodeRuntimeState>;
  question_progress: Record<string, AskmoreV2QuestionProgress>;
  structured_knowledge: Record<string, AskmoreV2StructuredKnowledgeField>;
  latest_summary_text: string | null;
  latest_structured_report: Record<string, unknown> | null;
  runtime_meta?: {
    last_task_module?: string;
    last_transition_reason?: string;
    latest_visible_summary?: string;
    last_help_obstacle_layer?: AskmoreV2HelpObstacleLayer;
    last_help_resolution_goal?: AskmoreV2HelpResolutionGoal;
    last_help_reconnect_target?: string;
  };
}

export interface AskmoreV2HelpCoachingOutput {
  obstacle_layer: AskmoreV2HelpObstacleLayer;
  resolution_goal: AskmoreV2HelpResolutionGoal;
  direct_help_answer: string;
  downgraded_question: string;
  explanatory_examples: string[];
  answer_examples: string[];
  reconnect_prompt: string;
}

export interface AskmoreV2Session {
  id: string;
  flow_version_id: string;
  status: AskmoreV2SessionStatus;
  turn_count: number;
  state_version: number;
  state_jsonb: AskmoreV2SessionState;
  created_at: string;
  updated_at: string;
}

export interface AskmoreV2SessionListItem {
  id: string;
  status: AskmoreV2SessionStatus;
  turn_count: number;
  state_version?: number;
  flow_version_id: string;
  created_at: string;
  updated_at: string;
  current_question_id: string | null;
}

export interface AskmoreV2Message {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  message_text: string;
  created_at: string;
}

export interface AskmoreV2Readiness {
  readiness_score: number;
  can_generate_summary: boolean;
  should_end_early: boolean;
  reason: string;
}

export interface AskmoreV2TurnAgentOutput {
  understanding_feedback: string;
  confidence: "low" | "medium" | "high";
  answer_status: AskmoreV2TurnAnswerStatus;
  missing_points: string[];
  suggested_next_action: AskmoreV2NextAction;
  next_question: string;
  example_answers: string[];
  summary_patch: Record<string, unknown>;
  readiness: AskmoreV2Readiness;
}

export interface AskmoreV2SummaryOutput {
  summary_text: string;
  structured_report_json: {
    overview: string;
    confirmed_points: string[];
    open_points: string[];
    next_steps: string[];
  };
}

export interface AskmoreV2TurnExtractorFact {
  value: string;
  evidence: string;
  confidence: number;
}

export interface AskmoreV2TurnExtractorOutput {
  facts_extracted: Record<string, AskmoreV2TurnExtractorFact>;
  updated_dimensions: string[];
  missing_dimensions: string[];
  unanswered_dimensions?: string[];
  answer_quality: AskmoreV2AnswerQuality;
  user_effort_signal: "low" | "normal" | "high";
  contradiction_detected: boolean;
  candidate_hypothesis: string;
  confidence_overall: number;
  normalized_dimension_map?: Record<string, string>;
  normalization_hits?: string[];
}

export interface AskmoreV2MicroConfirmOption {
  option_id: string;
  label: string;
  normalized_value: string;
  value?: string;
  rationale?: string;
}

export type AskmoreV2ChoiceKind = "micro_confirm" | "follow_up_select";
export type AskmoreV2InteractionMode = AskmoreV2ChoiceKind;

export interface AskmoreV2TurnChoiceInput {
  dimension_id: string;
  option_id: string;
  option_label: string;
  choice_kind?: AskmoreV2ChoiceKind;
  source_event_id?: string;
}

export interface AskmoreV2DialoguePlannerOutput {
  node_status: AskmoreV2NodeStatus;
  planner_action: AskmoreV2PlannerAction;
  chosen_dimension_to_ask: string | null;
  should_show_micro_confirmation: boolean;
  should_use_hypothesis_style: boolean;
  should_show_node_summary: boolean;
  should_offer_early_summary: boolean;
  progress_signal: {
    covered_count: number;
    required_count: number;
    remaining_count: number;
  };
  readiness: {
    node_readiness: number;
    interview_readiness: number;
  };
  planner_notes: {
    reason_short: string;
    missing_priority: string[];
  };
  dimension_priority_map: Record<string, AskmoreV2DimensionPriority>;
  must_dimensions: string[];
  optional_dimensions: string[];
}

export interface AskmoreV2ResponseBlock {
  type:
    | "understanding"
    | "micro_confirmation"
    | "micro_confirm_options"
    | "progress"
    | "next_question"
    | "example_answers"
    | "node_summary";
  content?: string;
  items?: string[];
  options?: AskmoreV2MicroConfirmOption[];
  dimension_id?: string;
  allow_free_text?: boolean;
  mode?: AskmoreV2InteractionMode;
  badge_label?: string;
  source_event_id?: string;
}

export interface AskmoreV2ResponseComposerOutput {
  response_blocks: AskmoreV2ResponseBlock[];
}

export type AskmoreV2InternalEventType =
  | "understanding_summary"
  | "state_update"
  | "coverage_summary"
  | "gap_notice"
  | "help_explanation"
  | "help_examples"
  | "micro_confirm"
  | "transition_summary"
  | "next_question";

export interface AskmoreV2InternalEvent {
  event_id: string;
  event_type: AskmoreV2InternalEventType;
  created_at: string;
  visible: boolean;
  payload: {
    content?: string;
    items?: string[];
    options?: AskmoreV2MicroConfirmOption[];
    dimension_id?: string;
    allow_free_text?: boolean;
    mode?: AskmoreV2InteractionMode;
    badge_label?: string;
  };
}

export type AskmoreV2PresentationEventType =
  | "understanding"
  | "acknowledgement"
  | "why_this_matters"
  | "gentle_gap_prompt"
  | "help_explanation"
  | "help_examples"
  | "micro_confirm"
  | "transition"
  | "next_step";

export interface AskmoreV2VisibleEvent {
  event_id: string;
  event_type: AskmoreV2PresentationEventType;
  created_at: string;
  visible: boolean;
  payload: {
    content?: string;
    items?: string[];
    options?: AskmoreV2MicroConfirmOption[];
    dimension_id?: string;
    allow_free_text?: boolean;
    mode?: AskmoreV2InteractionMode;
    badge_label?: string;
  };
}

export type AskmoreV2EventChannel = "internal" | "visible";
export type AskmoreV2DebugEvent = AskmoreV2InternalEvent;
export type AskmoreV2TurnEvent = AskmoreV2InternalEvent | AskmoreV2VisibleEvent;

export interface AskmoreV2RoutedIntent {
  intent: AskmoreV2Intent;
  confidence: number;
  rationale?: string;
}

export interface AskmoreV2NextQuestionPayload {
  question_id: string | null;
  question_text: string;
}

export interface AskmoreV2TurnResult {
  session_id: string;
  turn_id: string;
  state: AskmoreV2SessionState;
  routed_intent: AskmoreV2RoutedIntent;
  events: AskmoreV2VisibleEvent[];
  debug_events: AskmoreV2DebugEvent[];
  // Compatibility projection only. Must be derived from `events` and must not carry business-only data.
  response_blocks: AskmoreV2ResponseBlock[];
  next_question?: AskmoreV2NextQuestionPayload | null;
}

export type AskmoreV2RuntimePhase =
  | "assemble_context"
  | "route_intent"
  | "execute_task"
  | "build_response"
  | "persist_and_finalize";

export interface AskmoreV2RuntimePhaseProgressEvent {
  phase: AskmoreV2RuntimePhase;
  status: "start" | "done";
  label?: string;
}

export type AskmoreV2PhaseProgressCallback = (event: AskmoreV2RuntimePhaseProgressEvent) => void;

export type AskmoreV2TurnStreamEvent =
  | {
      type: "phase";
      phase: AskmoreV2RuntimePhase;
      status: "start" | "done";
      label?: string;
    }
  | {
      type: "final";
      payload: AskmoreV2TurnResult;
    }
  | {
      type: "error";
      error: string;
      code?: string;
    };

export interface AskmoreV2TurnCommitRecord {
  session_id: string;
  client_turn_id: string;
  turn_id: string;
  response_jsonb: AskmoreV2TurnResult;
  created_at: string;
}
