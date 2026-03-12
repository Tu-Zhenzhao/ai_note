import { beforeEach, describe, expect, test, vi } from "vitest";

const { generateModelObjectMock } = vi.hoisted(() => ({
  generateModelObjectMock: vi.fn(),
}));

vi.mock("@/server/model/adapters", () => ({
  generateModelObject: generateModelObjectMock,
}));

import { createInitialState } from "@/lib/state";
import { classifyTurn } from "@/server/agent/planner";
import { getInterviewRepository } from "@/server/repo";

async function addMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
  index: number,
) {
  const repo = getInterviewRepository();
  await repo.addMessage({
    id: `${sessionId}-${role}-${index}`,
    session_id: sessionId,
    role,
    content,
    created_at: new Date(Date.UTC(2026, 2, 13, 0, 0, index)).toISOString(),
  });
}

async function seedQuestionContext(sessionId: string, assistantQuestion: string) {
  await addMessage(sessionId, "assistant", "Let's continue the strategy interview.", 1);
  await addMessage(sessionId, "user", "Sounds good.", 2);
  await addMessage(sessionId, "assistant", assistantQuestion, 3);
}

describe("planner answer-vs-discussion routing", () => {
  beforeEach(() => {
    generateModelObjectMock.mockReset();
  });

  test("passes latest assistant question into the classifier prompt for direct answers", async () => {
    const sessionId = "planner-routing-direct";
    const state = createInitialState(sessionId);
    const repo = getInterviewRepository();
    await seedQuestionContext(
      sessionId,
      "Who is the main audience for your LinkedIn content right now?",
    );

    generateModelObjectMock.mockResolvedValueOnce({
      task_type: "answer_question",
      rationale: "User directly answers the latest audience question.",
    });

    const result = await classifyTurn({
      repo,
      sessionId,
      turnId: "turn-1",
      userMessage: "Operations leaders at mid-market SaaS companies.",
      state,
    });

    expect(result.classification.task_type).toBe("answer_question");
    expect(generateModelObjectMock).toHaveBeenCalledTimes(1);
    const plannerPrompt = generateModelObjectMock.mock.calls[0][0];
    expect(plannerPrompt.system).toContain("latest assistant question");
    expect(plannerPrompt.system).toContain("If uncertain between answer_question and other_discussion, choose answer_question.");
    expect(plannerPrompt.prompt).toContain(
      "Latest assistant question: Who is the main audience for your LinkedIn content right now?",
    );
    expect(plannerPrompt.prompt).toContain(
      "ai: Who is the main audience for your LinkedIn content right now?",
    );
  });

  test("keeps long meandering but relevant replies in answer_question", async () => {
    const sessionId = "planner-routing-meandering";
    const state = createInitialState(sessionId);
    const repo = getInterviewRepository();
    await seedQuestionContext(
      sessionId,
      "What problem does your product solve for that audience?",
    );

    generateModelObjectMock.mockResolvedValueOnce({
      task_type: "answer_question",
      rationale: "The reply is detailed but still answers the active problem question.",
    });

    const result = await classifyTurn({
      repo,
      sessionId,
      turnId: "turn-1",
      userMessage:
        "It really comes down to wasted time and messy internal processes. Teams tell us they spend hours hunting through docs, Slack, and old tickets, and that delay makes onboarding and customer support slower than it should be.",
      state,
    });

    expect(result.classification.task_type).toBe("answer_question");
  });

  test("treats partial answers with caveats as answer_question", async () => {
    const sessionId = "planner-routing-partial";
    const state = createInitialState(sessionId);
    const repo = getInterviewRepository();
    await seedQuestionContext(
      sessionId,
      "What tone should your posts have?",
    );

    generateModelObjectMock.mockResolvedValueOnce({
      task_type: "answer_question",
      rationale: "User provides a partial tone preference with caveats.",
    });

    const result = await classifyTurn({
      repo,
      sessionId,
      turnId: "turn-1",
      userMessage:
        "Probably practical and credible first. I do not want to sound overly polished, though I am still figuring out how opinionated I want to be.",
      state,
    });

    expect(result.classification.task_type).toBe("answer_question");
  });

  test("keeps explicit help requests on ask_for_help without model classification", async () => {
    const sessionId = "planner-routing-help";
    const state = createInitialState(sessionId);
    const repo = getInterviewRepository();
    await seedQuestionContext(
      sessionId,
      "What should your main content goal be?",
    );

    const result = await classifyTurn({
      repo,
      sessionId,
      turnId: "turn-1",
      userMessage: "I am not sure yet. Can you help me with a few suggestions?",
      state,
    });

    expect(result.classification.task_type).toBe("ask_for_help");
    expect(generateModelObjectMock).not.toHaveBeenCalled();
  });

  test("routes explicit free-talk shifts to other_discussion", async () => {
    const sessionId = "planner-routing-discussion";
    const state = createInitialState(sessionId);
    const repo = getInterviewRepository();
    await seedQuestionContext(
      sessionId,
      "What proof or assets can support your posts?",
    );

    generateModelObjectMock.mockResolvedValueOnce({
      task_type: "other_discussion",
      rationale: "User is intentionally shifting into a broader idea discussion.",
    });

    const result = await classifyTurn({
      repo,
      sessionId,
      turnId: "turn-1",
      userMessage: "Before I answer that, I want to discuss a few broader content ideas with you.",
      state,
    });

    expect(result.classification.task_type).toBe("other_discussion");
  });

  test("routes clarification-only turns to other_discussion", async () => {
    const sessionId = "planner-routing-clarification";
    const state = createInitialState(sessionId);
    const repo = getInterviewRepository();
    await seedQuestionContext(
      sessionId,
      "What outcomes does your audience care about most?",
    );

    generateModelObjectMock.mockResolvedValueOnce({
      task_type: "other_discussion",
      rationale: "User asks what the question means rather than answering it.",
    });

    const result = await classifyTurn({
      repo,
      sessionId,
      turnId: "turn-1",
      userMessage: "What do you mean by outcomes here?",
      state,
    });

    expect(result.classification.task_type).toBe("other_discussion");
  });

  test("biases ambiguous but relevant replies toward answer_question", async () => {
    const sessionId = "planner-routing-ambiguous";
    const state = createInitialState(sessionId);
    const repo = getInterviewRepository();
    await seedQuestionContext(
      sessionId,
      "What makes your perspective different from others in the market?",
    );

    generateModelObjectMock.mockImplementationOnce(async (opts) => {
      expect(opts.prompt).toContain(
        "Latest assistant question: What makes your perspective different from others in the market?",
      );
      expect(opts.prompt).toContain(
        "User message: We are still figuring it out, but I think our angle is that we have actually operated these workflows ourselves.",
      );
      return {
        task_type: "answer_question",
        rationale: "The reply is tentative but still plausibly answers the active differentiation question.",
      };
    });

    const result = await classifyTurn({
      repo,
      sessionId,
      turnId: "turn-1",
      userMessage:
        "We are still figuring it out, but I think our angle is that we have actually operated these workflows ourselves.",
      state,
    });

    expect(result.classification.task_type).toBe("answer_question");
  });
});
