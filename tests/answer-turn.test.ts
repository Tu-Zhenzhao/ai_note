import { beforeEach, describe, expect, test, vi } from "vitest";
import { createInitialState } from "@/lib/state";
import { getInterviewRepository } from "@/server/repo";
import { runAnswerTurnController } from "@/server/services/answer-turn";

const { generateModelObjectMock, generateModelTextMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
  generateModelTextMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
  generateModelText: generateModelTextMock,
}));

describe("answer turn controller", () => {
  beforeEach(() => {
    generateModelObjectMock.mockReset();
    generateModelTextMock.mockReset();
    generateModelObjectMock.mockRejectedValue(new Error("model unavailable"));
    generateModelTextMock.mockRejectedValue(new Error("model unavailable"));
  });

  test("mutates state through answer extraction and logs controller trace", async () => {
    const sessionId = "answer-turn-1";
    const state = createInitialState(sessionId);
    const repo = getInterviewRepository();

    const result = await runAnswerTurnController({
      repo,
      sessionId,
      turnId: "turn-1",
      userMessage: "We provide software APIs for enterprise search teams.",
      state,
    });

    expect(state.company_profile.company_one_liner.value.length).toBeGreaterThan(0);
    expect(state.system_assessment.last_turn_diagnostics.captured_fields_this_turn).toContain(
      "company_profile.company_one_liner",
    );
    expect(result.toolLogs.some((log) => log.tool_name === "answer_turn_controller")).toBe(true);
    expect(result.interactionModule.type).toBe("none");
  });

  test("produces deterministic field updates for the same input", async () => {
    const repo = getInterviewRepository();

    const stateA = createInitialState("answer-turn-deterministic-a");
    await runAnswerTurnController({
      repo,
      sessionId: "answer-turn-deterministic-a",
      turnId: "turn-1",
      userMessage: "B) service",
      state: stateA,
    });

    const stateB = createInitialState("answer-turn-deterministic-b");
    await runAnswerTurnController({
      repo,
      sessionId: "answer-turn-deterministic-b",
      turnId: "turn-1",
      userMessage: "B) service",
      state: stateB,
    });

    expect(stateA.company_profile.business_model.value).toEqual(stateB.company_profile.business_model.value);
    expect(stateA.system_assessment.last_turn_diagnostics.captured_fields_this_turn).toEqual(
      stateB.system_assessment.last_turn_diagnostics.captured_fields_this_turn,
    );
  });
});
