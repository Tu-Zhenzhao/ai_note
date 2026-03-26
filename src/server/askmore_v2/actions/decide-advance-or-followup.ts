import { CoverageDecision } from "@/server/askmore_v2/runtime/policies/coverage-policy";
import { RepetitionDecision } from "@/server/askmore_v2/runtime/policies/repetition-policy";
import { evaluateProgressionPolicy, ProgressionDecision } from "@/server/askmore_v2/runtime/policies/progression-policy";

export function decideAdvanceOrFollowUp(params: {
  coverage: CoverageDecision;
  repetition: RepetitionDecision;
  hasPendingClarificationCommitment: boolean;
  followUpCount: number;
  followUpBudget: number;
  hasNextQuestion: boolean;
  canEndInterview: boolean;
}): ProgressionDecision {
  return evaluateProgressionPolicy({
    coverage: params.coverage,
    repetition: params.repetition,
    hasPendingClarificationCommitment: params.hasPendingClarificationCommitment,
    followUpCount: params.followUpCount,
    followUpBudget: params.followUpBudget,
    hasNextQuestion: params.hasNextQuestion,
    canEndInterview: params.canEndInterview,
  });
}
