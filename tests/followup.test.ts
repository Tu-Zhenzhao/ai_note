import { describe, expect, test } from "vitest";
import { createInitialState, statusValue } from "@/lib/state";
import { detectFatigueFromMessage, planFollowUp } from "@/server/rules/followup";

describe("follow-up planner", () => {
  test("escalates attempts and falls back after attempt 3", () => {
    const state = createInitialState("fup-1");
    state.conversation_meta.current_focus_modules = ["company_profile"];

    const first = planFollowUp(state);
    const second = planFollowUp(state);
    const third = planFollowUp(state);
    const fourth = planFollowUp(state);

    expect(first.questionType).toBe("open");
    expect(second.questionType).toBe("clarify");
    expect(third.questionType).toBe("example");
    expect(fourth.questionType).toBe("contrast");
  });

  test("fatigue does not skip the current section's required slot", () => {
    const state = createInitialState("fup-2");
    state.system_assessment.module_completion_map.linkedin_content_strategy = "partial";
    state.system_assessment.module_completion_map.company_profile = "partial";

    detectFatigueFromMessage(state, "idk, skip");
    const plan = planFollowUp(state);

    expect(state.system_assessment.user_fatigue_risk).toBe("high");
    expect(plan.targetField).toContain("company_profile");
  });

  test("keeps one-to-two question prompt style via single next question output", () => {
    const state = createInitialState("fup-3");
    state.conversation_meta.current_focus_modules = ["user_concerns"];

    const plan = planFollowUp(state);

    expect(plan.nextQuestion.split("?").length - 1).toBeLessThanOrEqual(2);
  });

  test("marks weak modules revisitable after attempts by remaining partial", () => {
    const state = createInitialState("fup-4");
    state.conversation_meta.current_focus_modules = ["content_preferences"];

    planFollowUp(state);
    planFollowUp(state);
    planFollowUp(state);
    planFollowUp(state);

    state.content_preferences.preferred_tone = statusValue([], "partial");

    expect(state.content_preferences.preferred_tone.status).toBe("partial");
  });

  test("loop guard shifts to checkpoint-style confirm after repeated no-progress turns", () => {
    const state = createInitialState("fup-5");
    state.conversation_meta.current_focus_modules = ["company_profile"];
    state.system_assessment.last_turn_diagnostics.captured_fields_this_turn = [];
    state.system_assessment.loop_guard.target_field = "company_profile.company_one_liner";
    state.system_assessment.loop_guard.question_type = "contrast";
    state.system_assessment.loop_guard.stale_turns = 2;
    state.system_assessment.follow_up_attempts["company_profile.company_one_liner"] = {
      attempts: 3,
      last_question_type: "contrast",
    };

    const plan = planFollowUp(state);
    expect(plan.questionReason).toBe("loop_guard_checkpoint");
    expect(plan.questionType).toBe("confirm");
  });

  test("pending conflict triggers reconciliation prompt once", () => {
    const state = createInitialState("fup-6");
    state.conversation_meta.current_focus_modules = ["company_profile"];
    state.system_assessment.pending_conflicts.push({
      field: "company_profile.company_one_liner",
      conflicting_values: ["software", "service"],
      status: "pending",
      asks: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const plan = planFollowUp(state);
    expect(plan.questionReason).toBe("resolve_conflict");
    expect(plan.questionType).toBe("confirm");
  });
});
