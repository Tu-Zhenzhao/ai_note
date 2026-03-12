import { describe, expect, test } from "vitest";
import { createInitialState } from "@/lib/state";
import { buildTurnIntent } from "@/server/agent/turn-intent";
import { syncWorkflowState } from "@/server/services/workflow";

describe("turn intent contract", () => {
  test("is deterministic for same workflow/task inputs", () => {
    const state = createInitialState("intent-1");
    syncWorkflowState(state);

    const first = buildTurnIntent({
      state,
      taskType: "answer_question",
      responseMode: "ask_active_slot",
    });
    const second = buildTurnIntent({
      state,
      taskType: "answer_question",
      responseMode: "ask_active_slot",
    });

    expect(first).toEqual(second);
  });

  test("forbids next-section targets when transition is not allowed", () => {
    const state = createInitialState("intent-2");
    state.workflow.transition_allowed = false;
    syncWorkflowState(state);

    const intent = buildTurnIntent({
      state,
      taskType: "answer_question",
      responseMode: "ask_active_slot",
    });

    expect(intent.can_transition).toBe(false);
    expect(intent.forbidden_question_targets.some((id) => id.startsWith("audience_understanding."))).toBe(true);
  });

  test("exposes active slot target and same-section supporting targets separately", () => {
    const state = createInitialState("intent-3");
    state.workflow.active_section_id = "company_understanding";
    state.workflow.next_question_slot_id = "company_understanding.brand_story";

    const intent = buildTurnIntent({
      state,
      taskType: "answer_question",
      responseMode: "ask_active_slot",
    });

    expect(intent.active_slot_target_field).toBe("brand_story.core_belief");
    expect(intent.allowed_question_targets).toEqual(["company_understanding.brand_story"]);
    expect(intent.allowed_supporting_targets).toContain("company_understanding.main_offering");
    expect(intent.forbidden_question_targets).toContain("company_understanding.main_offering");
    expect(intent.forbidden_question_targets).toContain("audience_understanding.primary_audience");
  });
});
