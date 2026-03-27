import {
  AskmoreV2FlowQuestion,
  AskmoreV2InsightDomain,
  AskmoreV2Language,
  AskmoreV2Message,
  AskmoreV2Session,
} from "@/server/askmore_v2/types";
import { inferInsightDomain, inferInsightSubdomain } from "@/server/askmore_v2/insight/resolver";

export interface InsightContextPayload {
  session_id: string;
  domain: AskmoreV2InsightDomain;
  subdomain: string;
  conversation_history: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
  }>;
  question_sheet: Array<{
    question_id: string;
    original_question: string;
    entry_question: string;
    sub_questions: string[];
  }>;
  structured_answers: Record<string, unknown>;
  intake_summary: {
    completion_ratio: number;
    completed_questions: number;
    total_questions: number;
    last_missing_points: string[];
    latest_summary_text: string | null;
  };
  user_goal: string;
  metadata: {
    language: AskmoreV2Language;
    scenario: string;
    target_output_type: string;
    turn_count: number;
    session_status: string;
  };
}

export function buildInsightContext(params: {
  session: AskmoreV2Session;
  questions: AskmoreV2FlowQuestion[];
  messages: AskmoreV2Message[];
  scenario: string;
  targetOutputType: string;
  language: AskmoreV2Language;
}): InsightContextPayload {
  const state = params.session.state_jsonb;
  const structuredKnowledge = Object.fromEntries(
    Object.entries(state.structured_knowledge ?? {}).map(([key, value]) => [key, value.value]),
  );

  const completedQuestions = Object.values(state.question_progress ?? {}).filter((item) => item.status === "completed").length;
  const totalQuestions = params.questions.length;
  const completionRatio = totalQuestions > 0 ? completedQuestions / totalQuestions : 0;

  const conversationHistory = params.messages
    .slice(-80)
    .map((item) => ({
      role: item.role,
      content: item.message_text,
      created_at: item.created_at,
    }));

  const questionSheet = params.questions.map((question) => ({
    question_id: question.question_id,
    original_question: question.original_question,
    entry_question: question.entry_question,
    sub_questions: question.sub_questions,
  }));

  const structuredKnowledgeText = Object.values(structuredKnowledge)
    .map((value) => String(value ?? ""))
    .join("\n");

  const domain = inferInsightDomain({
    scenario: params.scenario,
    targetOutputType: params.targetOutputType,
    structuredKnowledgeText,
  });

  const subdomain = inferInsightSubdomain({
    domain,
    scenario: params.scenario,
    targetOutputType: params.targetOutputType,
  });

  const firstUserGoal = conversationHistory.find((item) => item.role === "user")?.content?.trim();

  return {
    session_id: params.session.id,
    domain,
    subdomain,
    conversation_history: conversationHistory,
    question_sheet: questionSheet,
    structured_answers: structuredKnowledge,
    intake_summary: {
      completion_ratio: Number(completionRatio.toFixed(4)),
      completed_questions: completedQuestions,
      total_questions: totalQuestions,
      last_missing_points: [...(state.session.last_missing_points ?? [])],
      latest_summary_text: state.latest_summary_text ?? null,
    },
    user_goal: firstUserGoal || (params.language === "zh" ? "完成当前访谈目标" : "Complete the current interview goal"),
    metadata: {
      language: params.language,
      scenario: params.scenario,
      target_output_type: params.targetOutputType,
      turn_count: params.session.turn_count,
      session_status: params.session.status,
    },
  };
}
