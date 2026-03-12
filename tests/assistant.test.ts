import { beforeEach, describe, expect, test, vi } from "vitest";
import { createInitialState } from "@/lib/state";
import { TurnIntent } from "@/lib/types";
import { generateAssistantResponse } from "@/server/services/assistant";

const { generateModelTextMock } = vi.hoisted(() => ({
  generateModelTextMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelText: generateModelTextMock,
}));

describe("assistant turn contract", () => {
  beforeEach(() => {
    generateModelTextMock.mockReset();
    generateModelTextMock.mockResolvedValue(
      "Thanks for sharing that context. Could you share one specific example?",
    );
  });

  test("response contains acknowledge, synthesis, progress, and one focused question", async () => {
    const state = createInitialState("asst-1");
    state.system_assessment.last_turn_diagnostics.captured_fields_this_turn = ["company_profile.company_one_liner"];
    const response = await generateAssistantResponse({
      state,
      userMessage: "We provide indexing APIs.",
      nextQuestion: "What is your main LinkedIn goal? Also what format do you prefer?",
      questionType: "clarify",
      questionStyle: "reflect_and_advance",
      userFacingProgressNote: "Good progress. I captured a new detail.",
    });

    expect(response.length).toBeGreaterThan(20);
    expect(response.split("?").length - 1).toBeLessThanOrEqual(1);
  });

  test("assistant text does not expose schema keys", async () => {
    const state = createInitialState("asst-2");
    const response = await generateAssistantResponse({
      state,
      userMessage: "B) service",
      nextQuestion: "Confirm company_profile.business_model?",
      questionType: "confirm",
      questionStyle: "synthesize_and_confirm",
      userFacingProgressNote: "Captured company_profile.business_model.",
    });

    expect(response).not.toContain("company_profile.business_model");
  });

  test("blocks unauthorized section-transition phrasing when transition is not allowed", async () => {
    const state = createInitialState("asst-3");
    state.workflow.transition_allowed = false;
    state.workflow.phase = "confirming_section";
    state.workflow.pending_review_section_id = "company_understanding";
    generateModelTextMock.mockResolvedValueOnce(
      "我们现在正处于受众洞察的阶段。你们的主要受众是谁？",
    );

    const response = await generateAssistantResponse({
      state,
      userMessage: "准确",
      nextQuestion: "Please review this section and confirm or edit anything before we continue.",
      questionType: "confirm",
      taskType: "answer_question",
      workflowState: state.workflow,
    });

    expect(response).not.toContain("受众洞察");
    expect(state.system_assessment.last_turn_diagnostics.tool_actions_used).toContain(
      "assistant_response_guardrail_transition_strip",
    );
  });

  test("uses chinese deterministic fallback when turn intent validator rejects drift", async () => {
    const state = createInitialState("asst-4");
    state.workflow.transition_allowed = false;
    state.workflow.phase = "interviewing";
    state.workflow.active_section_id = "company_understanding";
    state.workflow.next_question_slot_id = "company_understanding.brand_story";
    generateModelTextMock.mockResolvedValueOnce(
      "我们现在进入受众洞察阶段。你们主要想吸引哪类受众？",
    );
    const turnIntent: TurnIntent = {
      active_section_id: "company_understanding",
      active_slot_id: "company_understanding.brand_story",
      active_slot_target_field: "brand_story.core_belief",
      workflow_phase: "interviewing",
      task_type: "answer_question",
      interaction_required: false,
      can_transition: false,
      allowed_question_targets: ["company_understanding.brand_story"],
      allowed_supporting_targets: [
        "company_understanding.company_summary",
        "company_understanding.main_offering",
      ],
      forbidden_question_targets: [
        "company_understanding.main_offering",
        "audience_understanding.primary_audience",
      ],
      response_mode: "ask_active_slot",
    };

    const response = await generateAssistantResponse({
      state,
      userMessage: "B) 预约一次咨询",
      nextQuestion: "What core belief drives the company, and what do you want people to remember most?",
      questionType: "clarify",
      taskType: "answer_question",
      workflowState: state.workflow,
      language: "zh",
      turnIntent,
    });

    expect(response).toContain("品牌信念");
    expect(state.system_assessment.last_contract_validation_result?.valid).toBe(false);
    expect(state.system_assessment.last_contract_validation_result?.fallback_used).toBe(true);
  });

  test("accepts a single question aimed at the exact active slot", async () => {
    const state = createInitialState("asst-5");
    state.workflow.active_section_id = "company_understanding";
    state.workflow.next_question_slot_id = "company_understanding.brand_story";
    generateModelTextMock.mockResolvedValueOnce(
      "That helps. What core belief drives the company, and what do you want people to remember most?",
    );
    const turnIntent: TurnIntent = {
      active_section_id: "company_understanding",
      active_slot_id: "company_understanding.brand_story",
      active_slot_target_field: "brand_story.core_belief",
      workflow_phase: "interviewing",
      task_type: "answer_question",
      interaction_required: false,
      can_transition: false,
      allowed_question_targets: ["company_understanding.brand_story"],
      allowed_supporting_targets: ["company_understanding.main_offering"],
      forbidden_question_targets: [
        "company_understanding.main_offering",
        "audience_understanding.primary_audience",
      ],
      response_mode: "ask_active_slot",
    };

    const response = await generateAssistantResponse({
      state,
      userMessage: "We help teams search internal knowledge.",
      nextQuestion: "What core belief drives the company, and what do you want people to remember most?",
      questionType: "clarify",
      taskType: "answer_question",
      workflowState: state.workflow,
      turnIntent,
    });

    expect(response).toContain("What core belief drives the company");
    expect(state.system_assessment.last_contract_validation_result?.valid).toBe(true);
    expect(state.system_assessment.last_contract_validation_result?.inferred_target_slot_id).toBe(
      "company_understanding.brand_story",
    );
  });

  test("rejects same-section wrong-slot questions in ask mode", async () => {
    const state = createInitialState("asst-6");
    state.workflow.active_section_id = "company_understanding";
    state.workflow.next_question_slot_id = "company_understanding.brand_story";
    generateModelTextMock.mockResolvedValueOnce(
      "Understood. What is the main product or service you offer?",
    );
    const turnIntent: TurnIntent = {
      active_section_id: "company_understanding",
      active_slot_id: "company_understanding.brand_story",
      active_slot_target_field: "brand_story.core_belief",
      workflow_phase: "interviewing",
      task_type: "answer_question",
      interaction_required: false,
      can_transition: false,
      allowed_question_targets: ["company_understanding.brand_story"],
      allowed_supporting_targets: ["company_understanding.main_offering"],
      forbidden_question_targets: [
        "company_understanding.main_offering",
        "audience_understanding.primary_audience",
      ],
      response_mode: "ask_active_slot",
    };

    const response = await generateAssistantResponse({
      state,
      userMessage: "We provide search APIs.",
      nextQuestion: "What core belief drives the company, and what do you want people to remember most?",
      questionType: "clarify",
      taskType: "answer_question",
      workflowState: state.workflow,
      turnIntent,
    });

    expect(response).toContain("What core belief drives the company");
    expect(state.system_assessment.last_contract_validation_result?.violations).toContain(
      "wrong_slot_target",
    );
    expect(state.system_assessment.last_contract_validation_result?.fallback_used).toBe(true);
  });

  test("rejects multiple questions in ask mode", async () => {
    const state = createInitialState("asst-7");
    state.workflow.active_section_id = "company_understanding";
    state.workflow.next_question_slot_id = "company_understanding.brand_story";
    generateModelTextMock.mockResolvedValueOnce(
      "That helps. What core belief drives the company? What is the main product or service you offer?",
    );
    const turnIntent: TurnIntent = {
      active_section_id: "company_understanding",
      active_slot_id: "company_understanding.brand_story",
      active_slot_target_field: "brand_story.core_belief",
      workflow_phase: "interviewing",
      task_type: "answer_question",
      interaction_required: false,
      can_transition: false,
      allowed_question_targets: ["company_understanding.brand_story"],
      allowed_supporting_targets: ["company_understanding.main_offering"],
      forbidden_question_targets: [
        "company_understanding.main_offering",
        "audience_understanding.primary_audience",
      ],
      response_mode: "ask_active_slot",
    };

    await generateAssistantResponse({
      state,
      userMessage: "We provide search APIs.",
      nextQuestion: "What core belief drives the company, and what do you want people to remember most?",
      questionType: "clarify",
      taskType: "answer_question",
      workflowState: state.workflow,
      turnIntent,
    });

    expect(state.system_assessment.last_contract_validation_result?.violations).toContain(
      "multiple_questions",
    );
  });

  test("rejects missing question in ask mode", async () => {
    const state = createInitialState("asst-8");
    state.workflow.active_section_id = "company_understanding";
    state.workflow.next_question_slot_id = "company_understanding.brand_story";
    generateModelTextMock.mockResolvedValueOnce(
      "That helps. I captured the brand context and will keep refining it.",
    );
    const turnIntent: TurnIntent = {
      active_section_id: "company_understanding",
      active_slot_id: "company_understanding.brand_story",
      active_slot_target_field: "brand_story.core_belief",
      workflow_phase: "interviewing",
      task_type: "answer_question",
      interaction_required: false,
      can_transition: false,
      allowed_question_targets: ["company_understanding.brand_story"],
      allowed_supporting_targets: ["company_understanding.main_offering"],
      forbidden_question_targets: [
        "company_understanding.main_offering",
        "audience_understanding.primary_audience",
      ],
      response_mode: "ask_active_slot",
    };

    await generateAssistantResponse({
      state,
      userMessage: "We provide search APIs.",
      nextQuestion: "What core belief drives the company, and what do you want people to remember most?",
      questionType: "clarify",
      taskType: "answer_question",
      workflowState: state.workflow,
      turnIntent,
    });

    expect(state.system_assessment.last_contract_validation_result?.violations).toContain(
      "no_question_in_ask_mode",
    );
  });

  test("confirm mode rejects discovery questions", async () => {
    const state = createInitialState("asst-9");
    state.workflow.transition_allowed = false;
    state.workflow.phase = "confirming_section";
    state.workflow.active_section_id = "company_understanding";
    generateModelTextMock.mockResolvedValueOnce(
      "What is the main product or service you offer?",
    );
    const turnIntent: TurnIntent = {
      active_section_id: "company_understanding",
      active_slot_id: "company_understanding.brand_story",
      active_slot_target_field: "brand_story.core_belief",
      workflow_phase: "confirming_section",
      task_type: "answer_question",
      interaction_required: true,
      can_transition: false,
      allowed_question_targets: ["company_understanding.brand_story"],
      allowed_supporting_targets: ["company_understanding.main_offering"],
      forbidden_question_targets: ["audience_understanding.primary_audience"],
      response_mode: "confirm_section",
    };

    const response = await generateAssistantResponse({
      state,
      userMessage: "Looks right.",
      nextQuestion: "Please review this section and confirm or edit anything before we continue.",
      questionType: "confirm",
      taskType: "answer_question",
      workflowState: state.workflow,
      turnIntent,
    });

    expect(response).toContain("Please confirm the current section");
    expect(state.system_assessment.last_contract_validation_result?.violations).toContain(
      "confirm_mode_violation",
    );
  });
});
