import { describe, expect, test } from "vitest";
import { evaluateRepetitionPolicy } from "@/server/askmore_v2/runtime/policies/repetition-policy";
import { evaluateCoveragePolicy } from "@/server/askmore_v2/runtime/policies/coverage-policy";
import { evaluateProgressionPolicy } from "@/server/askmore_v2/runtime/policies/progression-policy";

describe("askmore v2 policy gates phase3", () => {
  test("repetition policy catches explicit repeat complaint", () => {
    const result = evaluateRepetitionPolicy({
      userMessage: "这个我说过了，不要重复问",
      recentPrompts: ["q1::d1", "q1::d2"],
      candidateDimensionId: "d2",
    });

    expect(result.should_avoid).toBe(true);
    expect(result.reason).toBe("user_repeat_complaint");
  });

  test("coverage policy blocks wrap-up when pending commitments remain", () => {
    const result = evaluateCoveragePolicy({
      covered: 2,
      required: 2,
      mustCovered: 2,
      mustRequired: 2,
      unresolvedGaps: [],
      pendingCommitments: [
        {
          id: "c1",
          type: "micro_confirm",
          status: "pending",
          question_id: "q1",
          created_at: new Date().toISOString(),
        },
      ],
    });

    expect(result.can_wrap_up).toBe(false);
    expect(result.blocking_pending_commitments.length).toBe(1);
  });

  test("progression policy follows hard-gate order", () => {
    const micro = evaluateProgressionPolicy({
      coverage: {
        covered_count: 1,
        required_count: 2,
        remaining_count: 1,
        must_covered_count: 1,
        must_required_count: 2,
        must_remaining_count: 1,
        can_wrap_up: false,
        blocking_pending_commitments: [],
        prioritized_gap: null,
      },
      repetition: { should_avoid: false, reason: "none" },
      hasPendingClarificationCommitment: true,
      followUpCount: 0,
      followUpBudget: 4,
      hasNextQuestion: true,
      canEndInterview: false,
    });
    expect(micro.move).toBe("handoff_clarification");

    const followUp = evaluateProgressionPolicy({
      coverage: {
        covered_count: 1,
        required_count: 2,
        remaining_count: 1,
        must_covered_count: 1,
        must_required_count: 2,
        must_remaining_count: 1,
        can_wrap_up: false,
        blocking_pending_commitments: [],
        prioritized_gap: null,
      },
      repetition: { should_avoid: false, reason: "none" },
      hasPendingClarificationCommitment: false,
      followUpCount: 0,
      followUpBudget: 4,
      hasNextQuestion: true,
      canEndInterview: false,
    });
    expect(followUp.move).toBe("ask_follow_up");

    const advance = evaluateProgressionPolicy({
      coverage: {
        covered_count: 2,
        required_count: 2,
        remaining_count: 0,
        must_covered_count: 2,
        must_required_count: 2,
        must_remaining_count: 0,
        can_wrap_up: true,
        blocking_pending_commitments: [],
        prioritized_gap: null,
      },
      repetition: { should_avoid: false, reason: "none" },
      hasPendingClarificationCommitment: false,
      followUpCount: 1,
      followUpBudget: 4,
      hasNextQuestion: true,
      canEndInterview: false,
    });
    expect(advance.move).toBe("advance_next_question");
  });

  test("progression policy uses blocked stay when follow-up budget is reached", () => {
    const decision = evaluateProgressionPolicy({
      coverage: {
        covered_count: 0,
        required_count: 1,
        remaining_count: 1,
        must_covered_count: 0,
        must_required_count: 1,
        must_remaining_count: 1,
        can_wrap_up: false,
        blocking_pending_commitments: [],
        prioritized_gap: null,
      },
      repetition: { should_avoid: false, reason: "none" },
      hasPendingClarificationCommitment: false,
      followUpCount: 4,
      followUpBudget: 4,
      hasNextQuestion: true,
      canEndInterview: false,
    });

    expect(decision.move).toBe("stay_on_question_blocked");
    expect(decision.reason).toBe("follow_up_budget_reached");
  });
});
