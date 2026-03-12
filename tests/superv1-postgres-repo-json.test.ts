import { beforeEach, describe, expect, test, vi } from "vitest";

const { queryMock, getPoolMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getPoolMock: vi.fn(),
}));

vi.mock("@/server/repo/db", () => ({
  getPool: getPoolMock,
}));

describe("superv1 postgres repo json serialization", () => {
  beforeEach(() => {
    queryMock.mockReset();
    getPoolMock.mockReset();
    getPoolMock.mockReturnValue({ query: queryMock });
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    vi.resetModules();
  });

  test("serializes extraction event JSONB payloads as JSON strings", async () => {
    const { PostgresSuperV1Repository } = await import("@/server/superv1/repo/postgres-repo");
    const repo = new PostgresSuperV1Repository();

    await repo.addExtractionEvent({
      id: "event-1",
      conversation_id: "conv-1",
      turn_id: "turn-1",
      raw_extraction_json: {
        filled_items: [
          {
            question_id: "q1",
            value: "abc",
            confidence: 0.9,
            evidence: "abc",
          },
        ],
        ambiguous_items: [],
        possible_items: [],
      },
      accepted_updates_json: [
        {
          question_id: "q1",
          value: "abc",
          confidence: 0.9,
          evidence: "abc",
        },
      ],
      rejected_updates_json: [{ question_id: "q2", reason: "low_confidence", confidence: 0.2 }],
      created_at: new Date().toISOString(),
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, params] = queryMock.mock.calls[0];
    expect(typeof params[2]).toBe("string");
    expect(typeof params[3]).toBe("string");
    expect(typeof params[4]).toBe("string");
    expect(JSON.parse(params[3])).toEqual([
      {
        question_id: "q1",
        value: "abc",
        confidence: 0.9,
        evidence: "abc",
      },
    ]);
  });

  test("serializes answer value_json for jsonb upsert", async () => {
    const { PostgresSuperV1Repository } = await import("@/server/superv1/repo/postgres-repo");
    const repo = new PostgresSuperV1Repository();

    await repo.upsertAnswer({
      id: "a1",
      conversation_id: "conv-1",
      question_id: "q1",
      value_json: ["one", "two"],
      status: "filled",
      confidence: 0.8,
      evidence_text: "from user",
      source_turn_id: "turn-1",
      updated_at: new Date().toISOString(),
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, params] = queryMock.mock.calls[0];
    expect(params[3]).toBe('["one","two"]');
  });

  test("serializes planner_result_json for jsonb insert", async () => {
    const { PostgresSuperV1Repository } = await import("@/server/superv1/repo/postgres-repo");
    const repo = new PostgresSuperV1Repository();

    await repo.addPlannerEvent({
      id: "planner-1",
      conversation_id: "conv-1",
      turn_id: "turn-1",
      planner_result_json: {
        active_section_id: "company_understanding",
        next_question_id: "q2",
        next_question_text: "What category?",
        ask_count: 1,
        clarification_required: false,
        unresolved_required_question_ids: ["q2"],
      },
      created_at: new Date().toISOString(),
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, params] = queryMock.mock.calls[0];
    expect(typeof params[2]).toBe("string");
    expect(JSON.parse(params[2]).next_question_id).toBe("q2");
  });
});
