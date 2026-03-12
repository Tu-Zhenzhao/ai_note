import { describe, expect, test } from "vitest";
import { createInitialState } from "@/lib/state";
import { classifyTurn } from "@/server/agent/planner";
import { runDiscussionTask } from "@/server/agent/tasks/discussion";
import { runHelpAboutQuestionTask } from "@/server/agent/tasks/help-about-question";
import { getInterviewRepository } from "@/server/repo";

describe("Utra1 agent architecture", () => {
  test("planner respects confirming_section guardrail", async () => {
    const repo = getInterviewRepository();
    const state = createInitialState("utra1-guardrail");
    state.workflow.phase = "confirming_section";
    state.workflow.pending_review_section_id = "company_understanding";
    state.workflow.pending_interaction_module = "confirm_section";

    const result = await classifyTurn({
      repo,
      sessionId: "utra1-guardrail",
      turnId: "turn-1",
      userMessage: "We are a B2B SaaS for operations.",
      state,
    });

    expect(result.classification.task_type).toBe("other_discussion");
    expect(result.toolLogs.length).toBeGreaterThan(0);
  });

  test("planner classifies explicit help requests as ask_for_help", async () => {
    const repo = getInterviewRepository();
    const state = createInitialState("utra1-help-classifier");

    const result = await classifyTurn({
      repo,
      sessionId: "utra1-help-classifier",
      turnId: "turn-1",
      userMessage: "I am not sure, can you help me with suggestions?",
      state,
    });

    expect(result.classification.task_type).toBe("ask_for_help");
  });

  test("help task opens select_help_option interaction", async () => {
    const repo = getInterviewRepository();
    const state = createInitialState("utra1-help-task");
    state.workflow.next_question_slot_id = "linkedin_content_strategy.main_content_goal";

    const result = await runHelpAboutQuestionTask({
      repo,
      sessionId: "utra1-help-task",
      turnId: "turn-1",
      userMessage: "What should I write here?",
      state,
    });

    expect(result.interactionModule.type).toBe("select_help_option");
    expect(state.workflow.pending_interaction_module).toBe("select_help_option");
    expect(state.workflow.phase).toBe("structured_help_selection");
  });

  test("discussion task does not mutate checklist statuses", async () => {
    const repo = getInterviewRepository();
    const state = createInitialState("utra1-discussion");
    const beforeStatuses = state.checklist.map((item) => item.status);

    const result = await runDiscussionTask({
      repo,
      sessionId: "utra1-discussion",
      turnId: "turn-1",
      userMessage: "Can you explain what you mean by audience outcomes?",
      state,
    });

    expect(result.interactionModule.type).toBe("none");
    expect(state.checklist.map((item) => item.status)).toEqual(beforeStatuses);
  });
});
