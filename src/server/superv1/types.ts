export type SuperV1Intent = "answer_question" | "ask_for_help" | "other_discussion";
export type SuperV1AnswerStatus = "empty" | "filled" | "needs_clarification" | "confirmed";
export type SuperV1FieldType = "text" | "number" | "boolean" | "select" | "multi_select";

export interface SuperV1Conversation {
  id: string;
  template_id: string;
  status: "active" | "completed";
  active_section_id: string;
  current_question_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuperV1TemplateQuestion {
  id: string;
  template_id: string;
  section_id: string;
  question_id: string;
  question_text: string;
  question_description: string | null;
  field_type: SuperV1FieldType;
  is_required: boolean;
  display_order: number;
}

export interface SuperV1ChecklistAnswer {
  id: string;
  conversation_id: string;
  question_id: string;
  value_json: unknown;
  status: SuperV1AnswerStatus;
  confidence: number | null;
  evidence_text: string | null;
  source_turn_id: string | null;
  updated_at: string;
}

export interface SuperV1Turn {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  message_text: string;
  created_at: string;
}

export interface SuperV1ExtractionItem {
  question_id: string;
  value: unknown;
  confidence: number;
  evidence: string;
}

export interface SuperV1AmbiguousItem {
  question_id: string;
  reason: string;
}

export interface SuperV1PossibleItem {
  question_id: string;
  value: unknown;
  reason: string;
}

export interface SuperV1ExtractionOutput {
  filled_items: SuperV1ExtractionItem[];
  ambiguous_items: SuperV1AmbiguousItem[];
  possible_items: SuperV1PossibleItem[];
}

export interface SuperV1ValidatedExtraction {
  accepted_updates: SuperV1ExtractionItem[];
  rejected_updates: Array<{
    question_id: string;
    reason: string;
    confidence?: number;
  }>;
  ambiguous_items: SuperV1AmbiguousItem[];
}

export interface SuperV1ExtractionEvent {
  id: string;
  conversation_id: string;
  turn_id: string;
  raw_extraction_json: SuperV1ExtractionOutput;
  accepted_updates_json: SuperV1ExtractionItem[];
  rejected_updates_json: Array<{ question_id: string; reason: string; confidence?: number }>;
  created_at: string;
}

export interface SuperV1PlannerResult {
  active_section_id: string;
  next_question_id: string | null;
  next_question_text: string | null;
  ask_count: number;
  clarification_required: boolean;
  unresolved_required_question_ids: string[];
}

export interface SuperV1PlannerEvent {
  id: string;
  conversation_id: string;
  turn_id: string;
  planner_result_json: SuperV1PlannerResult;
  created_at: string;
}

export interface SuperV1IntentResult {
  intent: SuperV1Intent;
  confidence: number;
  reason: string;
}

export interface SuperV1StateView {
  conversationId: string;
  templateId: string;
  status: "active" | "completed";
  activeSectionId: string;
  currentQuestionId: string | null;
  completion: {
    total: number;
    filled: number;
    needs_clarification: number;
    confirmed: number;
    ratio: number;
  };
  sections: Array<{
    section_id: string;
    total: number;
    filled: number;
    needs_clarification: number;
    confirmed: number;
    open_required_question_ids: string[];
  }>;
  answers: Array<{
    question_id: string;
    status: SuperV1AnswerStatus;
    value: unknown;
    confidence: number | null;
    evidence_text: string | null;
  }>;
}

export interface SuperV1TurnResult {
  conversationId: string;
  reply: string;
  state: SuperV1StateView;
  next_question: {
    question_id: string | null;
    question_text: string | null;
  };
  intent: SuperV1IntentResult;
  planner_result: SuperV1PlannerResult;
}

