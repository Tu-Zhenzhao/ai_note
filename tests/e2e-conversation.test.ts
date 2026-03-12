import { describe, expect, test } from "vitest";
import { createInitialState } from "@/lib/state";
import { runInterviewTurn } from "@/server/orchestration/engine";

describe("end-to-end scripted interview", () => {
  test("scripted transcript progresses without repetitive loops", async () => {
    const transcript = [
      "We sell search APIs for enterprise teams.",
      "We provide indexing and searchable retrieval for docs, images, and text.",
      "B) service",
      "Actually A) software",
      "Our main audience is ops and IT teams at mid-market companies.",
      "Their pain is wasted time finding internal knowledge.",
      "Goal is attract inbound leads and build authority.",
      "Preferred format is carousel and long image.",
      "Tone should be practical and analytical.",
      "We have one case study and dashboard screenshots.",
    ];

    let state = createInitialState("e2e-1");
    const responses: string[] = [];
    let capturedTurns = 0;

    for (let i = 0; i < transcript.length; i += 1) {
      const result = await runInterviewTurn({
        sessionId: "e2e-1",
        userMessage: transcript[i],
        userTurnId: `turn-${i + 1}`,
        state,
      });
      responses.push(result.assistantMessage ?? "");
      if (result.state.system_assessment.last_turn_diagnostics.captured_fields_this_turn.length > 0) {
        capturedTurns += 1;
      }
      state = result.state;
    }

    let identicalAdjacency = 0;
    for (let i = 1; i < responses.length; i += 1) {
      if (responses[i] === responses[i - 1]) identicalAdjacency += 1;
    }

    expect(identicalAdjacency).toBeLessThanOrEqual(2);
    expect(capturedTurns).toBeGreaterThanOrEqual(6);
  });
});
