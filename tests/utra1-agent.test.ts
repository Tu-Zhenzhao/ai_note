import { describe, expect, test } from "vitest";
import { createInitialState } from "@/lib/state";
import { classifyTurn } from "@/server/agent/planner";
import { runAnswerQuestionTask } from "@/server/agent/tasks/answer-question";
import { runDiscussionTask } from "@/server/agent/tasks/discussion";
import { runHelpAboutQuestionTask } from "@/server/agent/tasks/help-about-question";
import { getInterviewRepository } from "@/server/repo";

describe("Utra1 agent architecture", () => {
  test("planner keeps section-review edits in the answer path", async () => {
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

    expect(result.classification.task_type).toBe("answer_question");
    expect(result.toolLogs.length).toBeGreaterThan(0);
  });

  test("planner treats short affirmative replies as answer during confirmation", async () => {
    const repo = getInterviewRepository();
    const state = createInitialState("utra1-confirm-affirmative");
    state.workflow.phase = "confirming_section";
    state.workflow.pending_review_section_id = "company_understanding";
    state.workflow.pending_interaction_module = "confirm_section";

    await repo.addMessage({
      id: "utra1-confirm-affirmative-assistant-1",
      session_id: "utra1-confirm-affirmative",
      role: "assistant",
      content: "如果将你们解决的问题总结为这个表述，你觉得这个表述是否准确？",
      created_at: new Date().toISOString(),
    });

    const result = await classifyTurn({
      repo,
      sessionId: "utra1-confirm-affirmative",
      turnId: "turn-1",
      userMessage: "准确",
      state,
    });

    expect(result.classification.task_type).toBe("answer_question");
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

  test("answer task advances after section confirmation instead of looping", async () => {
    const repo = getInterviewRepository();
    const state = createInitialState("utra1-confirm-module");
    state.workflow.phase = "confirming_section";
    state.workflow.pending_review_section_id = "company_understanding";
    state.workflow.pending_interaction_module = "confirm_section";

    const result = await runAnswerQuestionTask({
      repo,
      sessionId: "utra1-confirm-module",
      turnId: "turn-1",
      userMessage: "准确",
      state,
    });

    expect(result.interactionModule.type).toBe("none");
    expect(state.workflow.phase).toBe("interviewing");
    expect(state.workflow.active_section_id).toBe("audience_understanding");
  });

  test("short affirmation confirms a pending slot summary and moves forward", async () => {
    const repo = getInterviewRepository();
    const state = createInitialState("utra1-slot-confirm");
    state.brand_story.core_belief.value = "Search should be simple.";
    state.brand_story.core_belief.status = "strong";
    state.brand_story.what_should_people_remember.value = "Any file should be searchable.";
    state.brand_story.what_should_people_remember.status = "strong";
    state.workflow.pending_confirmation_slot_id = "company_understanding.brand_story";

    const result = await runAnswerQuestionTask({
      repo,
      sessionId: "utra1-slot-confirm",
      turnId: "turn-1",
      userMessage: "可以",
      state,
      language: "zh",
    });

    expect(state.system_assessment.confirmed_slot_ids).toContain("company_understanding.brand_story");
    expect(state.workflow.pending_confirmation_slot_id).toBe(null);
    expect(result.assistantMessage.length).toBeGreaterThan(10);
  });
});
