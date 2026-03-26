import {
  AskmoreV2FlowQuestion,
  AskmoreV2Language,
  AskmoreV2NextQuestionPayload,
  AskmoreV2Session,
  AskmoreV2SessionState,
  AskmoreV2SessionStatus,
  AskmoreV2TurnChoiceInput,
  AskmoreV2InternalEvent,
} from "@/server/askmore_v2/types";
import { RuntimeContextSnapshot } from "@/server/askmore_v2/runtime/context-engine";

export interface AgentFlowSnapshot {
  scenario: string;
  target_output_type: string;
  questions: AskmoreV2FlowQuestion[];
}

export interface AgentRunInput {
  session: AskmoreV2Session;
  flow: AgentFlowSnapshot;
  sessionId: string;
  userMessage: string;
  language: AskmoreV2Language;
  intent: "answer_question" | "ask_for_help" | "clarify_meaning" | "other_discussion";
  choice?: AskmoreV2TurnChoiceInput;
  context: RuntimeContextSnapshot;
}

export interface AgentRunOutput {
  state: AskmoreV2SessionState;
  status: AskmoreV2SessionStatus;
  turn_count: number;
  events: AskmoreV2InternalEvent[];
  next_question?: AskmoreV2NextQuestionPayload | null;
  messages_already_persisted?: boolean;
  task_module: "AnswerQuestionAgent" | "HelpAgent" | "ClarificationAgent" | "DiscussionAgent";
  transition_reason?: string;
  handoff_intent?: "answer_question" | "ask_for_help" | "clarify_meaning" | "other_discussion";
}
