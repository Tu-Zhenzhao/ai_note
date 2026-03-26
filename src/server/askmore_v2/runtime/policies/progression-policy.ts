import { CoverageDecision } from "@/server/askmore_v2/runtime/policies/coverage-policy";
import { RepetitionDecision } from "@/server/askmore_v2/runtime/policies/repetition-policy";

export type ProgressionMove =
  | "ask_follow_up"
  | "handoff_clarification"
  | "stay_on_question"
  | "stay_on_question_blocked"
  | "advance_next_question"
  | "end_interview";

export interface ProgressionDecision {
  move: ProgressionMove;
  reason: string;
}

export function evaluateProgressionPolicy(params: {
  coverage: CoverageDecision;
  repetition: RepetitionDecision;
  hasPendingClarificationCommitment: boolean;
  followUpCount: number;
  followUpBudget: number;
  hasNextQuestion: boolean;
  canEndInterview: boolean;
}): ProgressionDecision {
  if (params.hasPendingClarificationCommitment) {
    return {
      move: "handoff_clarification",
      reason: "pending_commitment_requires_clarification",
    };
  }

  if (params.coverage.must_remaining_count > 0) {
    if (params.followUpCount >= params.followUpBudget) {
      return {
        move: "stay_on_question_blocked",
        reason: "follow_up_budget_reached",
      };
    }
    return {
      move: "ask_follow_up",
      reason: params.repetition.should_avoid
        ? `follow_up_required_but_avoid_repeat_${params.repetition.reason}`
        : "follow_up_required_for_must_coverage",
    };
  }

  if (!params.hasNextQuestion) {
    return {
      move: params.canEndInterview ? "end_interview" : "stay_on_question_blocked",
      reason: params.canEndInterview ? "all_questions_completed" : "cannot_end_interview_yet",
    };
  }

  return {
    move: "advance_next_question",
    reason: "must_coverage_met_and_next_question_available",
  };
}
