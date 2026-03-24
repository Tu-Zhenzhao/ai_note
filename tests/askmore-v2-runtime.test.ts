import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  extractTurnFactsMock,
  planDialogueStepMock,
  composeTurnResponseMock,
  generateExampleAnswersMock,
  generateMicroConfirmationMock,
  generateInterviewSummaryMock,
  judgeCompletionMock,
} = vi.hoisted(() => ({
  extractTurnFactsMock: vi.fn(),
  planDialogueStepMock: vi.fn(),
  composeTurnResponseMock: vi.fn(),
  generateExampleAnswersMock: vi.fn(),
  generateMicroConfirmationMock: vi.fn(),
  generateInterviewSummaryMock: vi.fn(),
  judgeCompletionMock: vi.fn(),
}));

vi.mock("@/server/askmore_v2/services/turn-extractor", () => ({
  extractTurnFacts: extractTurnFactsMock,
}));

vi.mock("@/server/askmore_v2/services/dialogue-planner", () => ({
  planDialogueStep: planDialogueStepMock,
}));

vi.mock("@/server/askmore_v2/services/response-composer", () => ({
  composeTurnResponse: composeTurnResponseMock,
}));

vi.mock("@/server/askmore_v2/services/example-answer-generator", () => ({
  generateExampleAnswers: generateExampleAnswersMock,
}));

vi.mock("@/server/askmore_v2/services/micro-confirm-generator", () => ({
  generateMicroConfirmation: generateMicroConfirmationMock,
}));

vi.mock("@/server/askmore_v2/services/summary-generator", () => ({
  generateInterviewSummary: generateInterviewSummaryMock,
}));

vi.mock("@/server/askmore_v2/services/completion-judge", () => ({
  judgeCompletion: judgeCompletionMock,
}));

import { publishFlowVersion } from "@/server/askmore_v2/services/builder-service";
import {
  handleAskmoreV2Turn,
  startAskmoreV2Interview,
} from "@/server/askmore_v2/services/interview-runtime";
import {
  getAskmoreV2Repository,
  resetAskmoreV2RepositoryForTests,
} from "@/server/askmore_v2/repo";
import { resetAskmoreV2MemoryStore } from "@/server/askmore_v2/repo/memory-repo";

function makeCards(count: number) {
  return Array.from({ length: count }).map((_, index) => ({
    question_id: `q${index + 1}`,
    original_question: `原问题 ${index + 1}`,
    analysis: {
      evaluation: {
        is_too_broad: false,
        is_too_abstract: false,
        difficulty: "medium" as const,
      },
      reason: "ok",
    },
    ai_candidate: {
      recommended_strategy: "direct_then_clarify",
      entry_question: `入口问题 ${index + 1}`,
      sub_questions: [`子问题 ${index + 1}-1`, `子问题 ${index + 1}-2`],
      example_answer_styles: ["一句话版", "举例版"],
    },
    selection: {
      mode: "use_ai_refined" as const,
    },
    final_payload: {
      source_mode: "use_ai_refined" as const,
      recommended_strategy: "direct_then_clarify",
      entry_question: `入口问题 ${index + 1}`,
      sub_questions: [`子问题 ${index + 1}-1`, `子问题 ${index + 1}-2`],
      example_answer_styles: ["一句话版", "举例版"],
    },
    review_generation_meta: {
      used_fallback: false,
    },
  }));
}

function makeExtractorResult(overrides: Record<string, unknown> = {}) {
  return {
    facts_extracted: {
      posture: {
        value: "中小企业老板",
        evidence: "我们主要服务中小企业老板",
        confidence: 0.82,
      },
    },
    updated_dimensions: ["posture"],
    missing_dimensions: ["pain_signs"],
    answer_quality: "usable" as const,
    user_effort_signal: "normal" as const,
    contradiction_detected: false,
    candidate_hypothesis: "信息正在收敛",
    confidence_overall: 0.62,
    ...overrides,
  };
}

function makePlannerResult(overrides: Record<string, unknown> = {}) {
  return {
    node_status: "partial" as const,
    planner_action: "micro_confirm_then_clarify" as const,
    chosen_dimension_to_ask: "pain_signs",
    should_show_micro_confirmation: true,
    should_use_hypothesis_style: false,
    should_show_node_summary: false,
    should_offer_early_summary: false,
    progress_signal: {
      covered_count: 1,
      required_count: 2,
      remaining_count: 1,
    },
    readiness: {
      node_readiness: 0.55,
      interview_readiness: 0.42,
    },
    planner_notes: {
      reason_short: "still missing one key dimension",
      missing_priority: ["pain_signs"],
    },
    dimension_priority_map: {
      posture: "must",
      pain_signs: "optional",
    },
    must_dimensions: ["posture"],
    optional_dimensions: ["pain_signs"],
    ...overrides,
  };
}

function makeReplayCards() {
  return [
    {
      question_id: "q1",
      original_question: "乱尿",
      analysis: {
        evaluation: {
          is_too_broad: false,
          is_too_abstract: false,
          difficulty: "medium" as const,
        },
        reason: "ok",
      },
      ai_candidate: {
        recommended_strategy: "progressive_expand",
        entry_question: "我们先看乱尿频率和位置",
        sub_questions: ["乱尿频率（每周几次）", "乱尿位置（猫砂盆外、床或衣物）"],
        example_answer_styles: ["一句话版"],
      },
      selection: {
        mode: "use_ai_refined" as const,
      },
      final_payload: {
        source_mode: "use_ai_refined" as const,
        recommended_strategy: "progressive_expand",
        entry_question: "我们先看乱尿频率和位置",
        sub_questions: ["乱尿频率（每周几次）", "乱尿位置（猫砂盆外、床或衣物）"],
        example_answer_styles: ["一句话版"],
      },
      review_generation_meta: {
        used_fallback: false,
      },
    },
  ];
}

function makeTemporalReplayCards() {
  return [
    {
      question_id: "q1",
      original_question: "乱尿是否最近才开始",
      analysis: {
        evaluation: {
          is_too_broad: false,
          is_too_abstract: false,
          difficulty: "medium" as const,
        },
        reason: "ok",
      },
      ai_candidate: {
        recommended_strategy: "progressive_expand",
        entry_question: "这个问题先看出现时机",
        sub_questions: ["这是最近才开始的吗，还是一直以来都有？", "大概从什么时候开始明显？"],
        example_answer_styles: ["一句话版"],
      },
      selection: {
        mode: "use_ai_refined" as const,
      },
      final_payload: {
        source_mode: "use_ai_refined" as const,
        recommended_strategy: "progressive_expand",
        entry_question: "这个问题先看出现时机",
        sub_questions: ["这是最近才开始的吗，还是一直以来都有？", "大概从什么时候开始明显？"],
        example_answer_styles: ["一句话版"],
      },
      review_generation_meta: {
        used_fallback: false,
      },
    },
  ];
}

function makeLocationThenTimingCards() {
  return [
    {
      question_id: "q1",
      original_question: "乱尿情况",
      analysis: {
        evaluation: {
          is_too_broad: false,
          is_too_abstract: false,
          difficulty: "medium" as const,
        },
        reason: "ok",
      },
      ai_candidate: {
        recommended_strategy: "progressive_expand",
        entry_question: "我们先看位置和出现时机",
        sub_questions: ["乱尿一般发生在什么位置？", "这是最近才开始的吗，还是一直以来都有？"],
        example_answer_styles: ["一句话版"],
      },
      selection: {
        mode: "use_ai_refined" as const,
      },
      final_payload: {
        source_mode: "use_ai_refined" as const,
        recommended_strategy: "progressive_expand",
        entry_question: "我们先看位置和出现时机",
        sub_questions: ["乱尿一般发生在什么位置？", "这是最近才开始的吗，还是一直以来都有？"],
        example_answer_styles: ["一句话版"],
      },
      review_generation_meta: {
        used_fallback: false,
      },
    },
  ];
}

function makeOptionalDimensionCards() {
  return [
    {
      question_id: "q1",
      original_question: "综合观察",
      analysis: {
        evaluation: {
          is_too_broad: false,
          is_too_abstract: false,
          difficulty: "medium" as const,
        },
        reason: "ok",
      },
      ai_candidate: {
        recommended_strategy: "progressive_expand",
        entry_question: "先看关键三点，再补一个可选细节",
        sub_questions: ["主维度一", "主维度二", "主维度三", "可选补充点"],
        example_answer_styles: ["一句话版"],
      },
      selection: {
        mode: "use_ai_refined" as const,
      },
      final_payload: {
        source_mode: "use_ai_refined" as const,
        recommended_strategy: "progressive_expand",
        entry_question: "先看关键三点，再补一个可选细节",
        sub_questions: ["主维度一", "主维度二", "主维度三", "可选补充点"],
        example_answer_styles: ["一句话版"],
      },
      review_generation_meta: {
        used_fallback: false,
      },
    },
  ];
}

function makeComposerResult(overrides: Record<string, unknown> = {}) {
  return {
    response_blocks: [
      {
        type: "understanding",
        content: "我理解你现在的重点是中小企业老板这个客群。",
      },
      {
        type: "micro_confirmation",
        content: "我这样理解对吗？",
      },
      {
        type: "progress",
        content: "这一题还差一个点就完整了。",
      },
      {
        type: "next_question",
        content: "关于这个点，你能再补一个具体场景吗？",
      },
      {
        type: "example_answers",
        items: ["主要是管理层", "偏运营团队", "还在确认中"],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.VITEST = "true";
  delete process.env.DATABASE_URL;
  delete process.env.ASKMORE_V2_USE_LEGACY_TURN_UNDERSTANDING;

  resetAskmoreV2RepositoryForTests();
  resetAskmoreV2MemoryStore();

  extractTurnFactsMock.mockReset();
  planDialogueStepMock.mockReset();
  composeTurnResponseMock.mockReset();
  generateExampleAnswersMock.mockReset();
  generateMicroConfirmationMock.mockReset();
  generateInterviewSummaryMock.mockReset();
  judgeCompletionMock.mockReset();

  extractTurnFactsMock.mockResolvedValue(makeExtractorResult());
  planDialogueStepMock.mockResolvedValue(makePlannerResult());
  composeTurnResponseMock.mockResolvedValue(makeComposerResult());
  generateExampleAnswersMock.mockResolvedValue(["示例1", "示例2", "示例3"]);
  generateMicroConfirmationMock.mockResolvedValue({
    ack_text: "你这个回答很有帮助，我已经理解到你的意思。为了记录更精确，我只补一个很小的确认，点一下最接近的选项就行。",
    options: [
      { option_id: "A", label: "局部小块", normalized_value: "localized_small_patches" },
      { option_id: "B", label: "两侧对称", normalized_value: "bilateral_symmetric" },
      { option_id: "C", label: "全身散在", normalized_value: "diffuse_scattered" },
      { option_id: "D", label: "不太确定", normalized_value: "uncertain" },
    ],
    allow_free_text: true,
  });
  generateInterviewSummaryMock.mockImplementation(async ({ mode }: { mode: "progressive" | "final" }) => ({
    summary_text: mode === "final" ? "FINAL SUMMARY" : "PROGRESSIVE SUMMARY",
    structured_report_json: {
      overview: mode === "final" ? "final" : "progressive",
      confirmed_points: [],
      open_points: [],
      next_steps: [],
    },
  }));
  judgeCompletionMock.mockResolvedValue({
    readiness_score: 0.3,
    can_generate_summary: false,
    should_end_early: false,
    reason: "not ready",
  });
});

describe("askmore v2 interview runtime constraints", () => {
  test("forces advance after at most 4 follow-ups on a single question", async () => {
    await publishFlowVersion({
      cards: makeCards(3),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: ["pain_signs"],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(makePlannerResult({ planner_action: "micro_confirm_then_clarify" }));

    const started = await startAskmoreV2Interview({ language: "zh" });

    const r1 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "还不太确定",
      language: "zh",
    });
    const r2 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "可能是中小企业",
      language: "zh",
    });
    const r3 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "大概是老板和运营",
      language: "zh",
    });
    const r4 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "更偏中小企业老板",
      language: "zh",
    });
    const r5 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "补充：决策者为主",
      language: "zh",
    });

    expect(r1.suggested_next_action).toBe("ask_clarification");
    expect(r2.suggested_next_action).toBe("ask_clarification");
    expect(r3.suggested_next_action).toBe("ask_clarification");
    expect(r4.suggested_next_action).toBe("ask_clarification");
    expect(r5.suggested_next_action).toBe("advance_to_next_question");
    expect(r5.state.question_progress.q1.follow_up_count).toBe(4);
    expect(r5.state.session.current_question_id).toBe("q2");
  });

  test("forces wrap-up at turn 50", async () => {
    await publishFlowVersion({
      cards: makeCards(60),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        answer_quality: "off_topic",
        missing_dimensions: ["posture", "pain_signs"],
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        planner_action: "micro_confirm_then_advance",
        node_status: "partial",
        chosen_dimension_to_ask: null,
      }),
    );

    const started = await startAskmoreV2Interview({ language: "zh" });

    let latest: Awaited<ReturnType<typeof handleAskmoreV2Turn>> | null = null;
    for (let i = 0; i < 50; i += 1) {
      latest = await handleAskmoreV2Turn({
        sessionId: started.session_id,
        userMessage: `回合 ${i + 1}`,
        language: "zh",
      });
    }

    expect(latest).not.toBeNull();
    expect(latest?.turn_count).toBe(50);
    expect(latest?.status).toBe("completed");
    expect(latest?.suggested_next_action).toBe("end_interview");
    expect(latest?.summary_text).toBe("FINAL SUMMARY");
    expect(latest?.state.session.finalized).toBe(true);
  });

  test("does not auto-generate progressive summary before turn 3", async () => {
    await publishFlowVersion({
      cards: makeCards(6),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        answer_quality: "clear",
        missing_dimensions: [],
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        node_status: "complete",
        planner_action: "micro_confirm_then_advance",
        chosen_dimension_to_ask: null,
      }),
    );

    const started = await startAskmoreV2Interview({ language: "zh" });

    const r1 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "第一条完整信息",
      language: "zh",
    });
    const r2 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "第二条完整信息",
      language: "zh",
    });
    const r3 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "第三条完整信息",
      language: "zh",
    });

    expect(r1.summary_text).toBeNull();
    expect(r2.summary_text).toBeNull();
    expect(r3.summary_text).toBe("PROGRESSIVE SUMMARY");
  });

  test("merges extracted patch without overwriting confirmed high-confidence field", async () => {
    await publishFlowVersion({
      cards: makeCards(2),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {
          posture: {
            value: "新值",
            evidence: "用户说了新值",
            confidence: 0.9,
          },
          pain_signs: {
            value: "新增维度信息",
            evidence: "用户补充了pain_signs",
            confidence: 0.82,
          },
        },
        updated_dimensions: ["posture", "pain_signs"],
        missing_dimensions: [],
        answer_quality: "clear",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        node_status: "complete",
        planner_action: "micro_confirm_then_advance",
        chosen_dimension_to_ask: null,
      }),
    );

    const started = await startAskmoreV2Interview({ language: "zh" });
    const repo = getAskmoreV2Repository();
    const session = await repo.getSession(started.session_id);
    if (!session) throw new Error("missing session");
    session.state_jsonb.structured_knowledge["q1__posture"] = {
      value: "旧值",
      confidence: 0.96,
      confirmed: true,
      updated_at: new Date().toISOString(),
    };
    await repo.updateSession(session);

    const turned = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "补充信息",
      language: "zh",
    });

    expect(turned.state.structured_knowledge["q1__posture"].value).toBe("旧值");
    expect(turned.state.structured_knowledge["q1__pain_signs"].value).toBe("新增维度信息");
  });

  test("when planner suggests early summary, runtime must not finalize before all main questions completed", async () => {
    await publishFlowVersion({
      cards: makeCards(6),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        answer_quality: "clear",
        missing_dimensions: [],
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        node_status: "complete",
        planner_action: "offer_early_summary",
        should_offer_early_summary: true,
        chosen_dimension_to_ask: null,
      }),
    );
    composeTurnResponseMock.mockResolvedValue(
      makeComposerResult({
        response_blocks: [
          {
            type: "understanding",
            content: "我先确认一下目前理解。",
          },
        ],
      }),
    );
    judgeCompletionMock.mockResolvedValue({
      readiness_score: 0.86,
      can_generate_summary: true,
      should_end_early: true,
      reason: "coverage enough",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });

    await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "第一条",
      language: "zh",
    });
    await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "第二条",
      language: "zh",
    });
    const r3 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "第三条",
      language: "zh",
    });

    expect(r3.status).toBe("in_progress");
    expect(r3.state.session.finalized).toBe(false);
    expect(r3.state.session.current_question_id).toBeTruthy();
    expect(r3.summary_text).toBe("PROGRESSIVE SUMMARY");
    expect(r3.suggested_next_action).not.toBe("end_interview");
  });

  test("anti-repeat guard avoids asking same dimension again when user already answered", async () => {
    await publishFlowVersion({
      cards: makeReplayCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const frequencyDimensionId = started.state.nodes.q1.target_dimensions[0].id;

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [frequencyDimensionId],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        chosen_dimension_to_ask: frequencyDimensionId,
        planner_action: "micro_confirm_then_clarify",
        planner_notes: {
          reason_short: "missing frequency",
          missing_priority: [frequencyDimensionId],
        },
      }),
    );

    const r1 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "不太确定",
      language: "zh",
    });
    const r2 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "一周两三次",
      language: "zh",
    });

    expect(r1.suggested_next_action).toBe("ask_clarification");
    expect(r2.suggested_next_action).not.toBe("ask_clarification");
    expect(r2.planner_action).not.toBe("micro_confirm_then_clarify");
  });

  test("anti-repeat guard avoids first-repeat on chinese quantifier evidence", async () => {
    await publishFlowVersion({
      cards: makeReplayCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const frequencyDimensionId = started.state.nodes.q1.target_dimensions[0].id;

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [frequencyDimensionId],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        chosen_dimension_to_ask: frequencyDimensionId,
        planner_action: "micro_confirm_then_clarify",
        planner_notes: {
          reason_short: "missing frequency",
          missing_priority: [frequencyDimensionId],
        },
      }),
    );

    const r1 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "一周两三次",
      language: "zh",
    });

    expect(r1.suggested_next_action).not.toBe("ask_clarification");
    expect(r1.planner_action).not.toBe("micro_confirm_then_clarify");
  });

  test("answered dimension with low confidence triggers micro confirm options instead of hard repeat", async () => {
    await publishFlowVersion({
      cards: makeReplayCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const frequencyDimensionId = started.state.nodes.q1.target_dimensions[0].id;

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [frequencyDimensionId],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        chosen_dimension_to_ask: frequencyDimensionId,
        planner_action: "micro_confirm_then_clarify",
        planner_notes: {
          reason_short: "still missing",
          missing_priority: [frequencyDimensionId],
        },
      }),
    );

    const turned = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "一周两三次",
      language: "zh",
    });

    const microBlock = turned.response_blocks.find((block) => block.type === "micro_confirm_options");
    expect(microBlock).toBeDefined();
    expect(typeof microBlock?.content).toBe("string");
    expect((microBlock?.content ?? "").length > 0).toBe(true);
    expect(turned.suggested_next_action).not.toBe("ask_clarification");
  });

  test("choice payload applies normalized value and confirms dimension", async () => {
    await publishFlowVersion({
      cards: makeReplayCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const frequencyDimensionId = started.state.nodes.q1.target_dimensions[0].id;

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [frequencyDimensionId],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        chosen_dimension_to_ask: frequencyDimensionId,
        planner_action: "micro_confirm_then_clarify",
        planner_notes: {
          reason_short: "still missing",
          missing_priority: [frequencyDimensionId],
        },
      }),
    );

    const turn1 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "一周两三次",
      language: "zh",
    });
    const block = turn1.response_blocks.find((item) => item.type === "micro_confirm_options");
    expect(block?.dimension_id).toBeTruthy();
    const confirmedDimensionId = block?.dimension_id ?? frequencyDimensionId;
    const option = block?.options?.[0];
    expect(option).toBeDefined();

    const turn2 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: `已选择：${option?.label}`,
      language: "zh",
      choice: {
        dimension_id: confirmedDimensionId,
        option_id: option?.option_id ?? "A",
        option_label: option?.label ?? "局部小块",
      },
    });

    const nodeRuntime = turn2.state.node_runtime.q1;
    expect(nodeRuntime.dimension_micro_confirmed[confirmedDimensionId]).toBe(true);
    expect((nodeRuntime.dimension_confidence[confirmedDimensionId] ?? 0) >= 0.72).toBe(true);
  });

  test("node wrap-up backfill patches obvious recent facts into summary_patch", async () => {
    await publishFlowVersion({
      cards: makeReplayCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const frequencyDimensionId = started.state.nodes.q1.target_dimensions[0].id;

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [frequencyDimensionId],
        answer_quality: "clear",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        planner_action: "node_wrap_up",
        node_status: "complete",
        chosen_dimension_to_ask: null,
        should_show_node_summary: true,
      }),
    );

    const turned = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "一周两三次，主要在猫砂盆外",
      language: "zh",
    });

    expect(Object.keys(turned.summary_patch).some((key) => key.includes(`q1__${frequencyDimensionId}`))).toBe(true);
  });

  test("clear temporal answer can be directly structured-confirmed without micro-confirm", async () => {
    await publishFlowVersion({
      cards: makeTemporalReplayCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const timingDimensionId = started.state.nodes.q1.target_dimensions.find((item) => /onset|timing|start|开始|时机/.test(`${item.id} ${item.label}`))?.id
      ?? started.state.nodes.q1.target_dimensions[0].id;

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [timingDimensionId],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        chosen_dimension_to_ask: timingDimensionId,
        planner_action: "micro_confirm_then_clarify",
        planner_notes: {
          reason_short: "missing onset timing",
          missing_priority: [timingDimensionId],
        },
      }),
    );

    const turn = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "好像是最近才突然出现的",
      language: "zh",
    });

    expect(turn.suggested_next_action).not.toBe("ask_clarification");
    expect(turn.planner_action).not.toBe("micro_confirm_then_clarify");
    const microBlock = turn.response_blocks.find((item) => item.type === "micro_confirm_options");
    expect(microBlock).toBeUndefined();
    const runtime = turn.state.node_runtime.q1;
    expect(runtime.dimension_state[timingDimensionId]).toBe("structured_confirmed");
    expect(runtime.dimension_unresolved_reason[timingDimensionId] ?? null).toBeNull();
    expect((runtime.dimension_confidence[timingDimensionId] ?? 0) >= 0.6).toBe(true);
  });

  test("ambiguous temporal answer on must dimension triggers explanatory micro-confirm", async () => {
    await publishFlowVersion({
      cards: makeTemporalReplayCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const timingDimensionId = started.state.nodes.q1.target_dimensions.find((item) => /onset|timing|start|开始|时机/.test(`${item.id} ${item.label}`))?.id
      ?? started.state.nodes.q1.target_dimensions[0].id;

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [timingDimensionId],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        chosen_dimension_to_ask: timingDimensionId,
        planner_action: "micro_confirm_then_clarify",
        planner_notes: {
          reason_short: "missing onset timing",
          missing_priority: [timingDimensionId],
        },
      }),
    );

    const turn = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "最近开始的",
      language: "zh",
    });

    const microBlock = turn.response_blocks.find((item) => item.type === "micro_confirm_options");
    expect(microBlock).toBeDefined();
    expect(turn.assistant_message).toContain("回答很有帮助");
    expect(turn.assistant_message).toContain("为了记录更精确");
    expect(turn.assistant_message).toContain("点一下最接近的选项");
  });

  test("optional dimension with low confidence should not force micro-confirm card", async () => {
    await publishFlowVersion({
      cards: makeOptionalDimensionCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const node = started.state.nodes.q1;
    const optionalDimensionId =
      node.target_dimensions
        .map((item) => item.id)
        .find((id) => !node.completion_criteria.includes(id))
      ?? node.target_dimensions.at(-1)?.id
      ?? node.target_dimensions[0].id;
    const mustDimensions = node.completion_criteria;
    const allDimensionIds = node.target_dimensions.map((item) => item.id);

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: Object.fromEntries([
          ...mustDimensions.map((id) => [
            id,
            { value: `must-${id}`, evidence: `must-${id}`, confidence: 0.88 },
          ]),
          [
            optionalDimensionId,
            { value: "optional-raw", evidence: "optional-raw", confidence: 0.45 },
          ],
        ]),
        updated_dimensions: [...mustDimensions, optionalDimensionId],
        missing_dimensions: [],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        chosen_dimension_to_ask: optionalDimensionId,
        planner_action: "micro_confirm_then_clarify",
        dimension_priority_map: Object.fromEntries(allDimensionIds.map((id) => [id, mustDimensions.includes(id) ? "must" : "optional"])),
        must_dimensions: [...mustDimensions],
        optional_dimensions: allDimensionIds.filter((id) => !mustDimensions.includes(id)),
        planner_notes: {
          reason_short: "optional dimension remains low confidence",
          missing_priority: [optionalDimensionId],
        },
      }),
    );

    const turn = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "补充了一些不太确定的可选信息",
      language: "zh",
    });

    const microBlock = turn.response_blocks.find((item) => item.type === "micro_confirm_options");
    expect(microBlock).toBeUndefined();
    expect(turn.suggested_next_action).not.toBe("ask_clarification");
  });

  test("planner-selected timing dimension can be accepted directly without micro-confirm when user answer is clear", async () => {
    await publishFlowVersion({
      cards: makeLocationThenTimingCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const locationDimensionId =
      started.state.nodes.q1.target_dimensions.find((item) => /位置|地点|猫砂盆|床|衣物/.test(item.label))?.id
      ?? started.state.nodes.q1.target_dimensions[0].id;
    const timingDimensionId =
      started.state.nodes.q1.target_dimensions.find((item) => /最近|开始|一直以来|时机/.test(item.label))?.id
      ?? started.state.nodes.q1.target_dimensions.find((item) => /onset|timing|start/.test(item.id))?.id
      ?? started.state.nodes.q1.target_dimensions.at(-1)?.id
      ?? started.state.nodes.q1.target_dimensions[0].id;

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [timingDimensionId],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        chosen_dimension_to_ask: timingDimensionId,
        planner_action: "micro_confirm_then_clarify",
        planner_notes: {
          reason_short: "missing onset timing",
          missing_priority: [timingDimensionId, locationDimensionId],
        },
      }),
    );

    const turn = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "在猫砂盆里，最近才开始的",
      language: "zh",
    });

    const microBlock = turn.response_blocks.find((item) => item.type === "micro_confirm_options");
    expect(microBlock).toBeUndefined();
    expect(generateMicroConfirmationMock).not.toHaveBeenCalled();
    expect(turn.planner_action).not.toBe("micro_confirm_then_clarify");
  });

  test("when planner clarifies timing but user only answers location, keep clarify without forcing micro-confirm", async () => {
    await publishFlowVersion({
      cards: makeLocationThenTimingCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const timingDimensionId =
      started.state.nodes.q1.target_dimensions.find((item) => /最近|开始|一直以来|时机/.test(item.label))?.id
      ?? started.state.nodes.q1.target_dimensions.find((item) => /onset|timing|start/.test(item.id))?.id
      ?? started.state.nodes.q1.target_dimensions.at(-1)?.id
      ?? started.state.nodes.q1.target_dimensions[0].id;

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [timingDimensionId],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        chosen_dimension_to_ask: timingDimensionId,
        planner_action: "micro_confirm_then_clarify",
        planner_notes: {
          reason_short: "missing onset timing",
          missing_priority: [timingDimensionId],
        },
      }),
    );

    const turn = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "在猫砂盆里，一天三四次，尿里有血丝",
      language: "zh",
    });

    const microBlock = turn.response_blocks.find((item) => item.type === "micro_confirm_options");
    expect(microBlock).toBeUndefined();
    expect(generateMicroConfirmationMock).not.toHaveBeenCalled();
    expect(turn.suggested_next_action).toBe("ask_clarification");
    expect((turn.next_question ?? "").length > 0).toBe(true);
  });

  test("dimension priority switches only after two consecutive planner turns", async () => {
    await publishFlowVersion({
      cards: makeReplayCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const initialDimensionId = started.state.nodes.q1.target_dimensions[0].id;
    const allDimensionIds = started.state.nodes.q1.target_dimensions.map((item) => item.id);
    const initialMustMap = Object.fromEntries(allDimensionIds.map((id) => [id, id === initialDimensionId ? "must" : "optional"]));

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [initialDimensionId],
        answer_quality: "off_topic",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        chosen_dimension_to_ask: initialDimensionId,
        planner_action: "micro_confirm_then_clarify",
        dimension_priority_map: initialMustMap,
        must_dimensions: [initialDimensionId],
        optional_dimensions: allDimensionIds.filter((id) => id !== initialDimensionId),
      }),
    );

    const warmup = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "先初始化一下",
      language: "zh",
    });
    const firstDimensionId = Object.keys(warmup.state.node_runtime.q1.dimension_priority_current ?? {})[0] ?? initialDimensionId;
    const refreshedDimensionIds = warmup.state.nodes.q1.target_dimensions.map((item) => item.id);
    const optionalMap = Object.fromEntries(refreshedDimensionIds.map((id) => [id, "optional"]));
    const repo = getAskmoreV2Repository();
    const seeded = await repo.getSession(started.session_id);
    if (!seeded) throw new Error("missing session");
    seeded.state_jsonb.node_runtime.q1.dimension_priority_current[firstDimensionId] = "must";
    seeded.state_jsonb.node_runtime.q1.dimension_priority_candidate[firstDimensionId] = "must";
    seeded.state_jsonb.node_runtime.q1.dimension_priority_streak[firstDimensionId] = 0;
    seeded.state_jsonb.node_runtime.q1.dimension_priority_reason[firstDimensionId] = "seed";
    seeded.state_jsonb.node_runtime.q1.dimension_priority_downgraded_by_limit[firstDimensionId] = false;
    seeded.state_jsonb.node_runtime.q1.dimension_state[firstDimensionId] = "unanswered";
    seeded.state_jsonb.node_runtime.q1.dimension_answered[firstDimensionId] = false;
    seeded.state_jsonb.node_runtime.q1.dimension_confidence[firstDimensionId] = 0;
    seeded.state_jsonb.question_progress.q1.follow_up_count = 0;
    await repo.updateSession(seeded);

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [firstDimensionId],
        answer_quality: "off_topic",
      }),
    );
    planDialogueStepMock.mockImplementation(async () =>
      makePlannerResult({
        chosen_dimension_to_ask: firstDimensionId,
        planner_action: "micro_confirm_then_clarify",
        dimension_priority_map: optionalMap,
        must_dimensions: [],
        optional_dimensions: refreshedDimensionIds,
      }),
    );

    const r1 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "不太清楚",
      language: "zh",
    });
    const r2 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "还是不太清楚",
      language: "zh",
    });

    const streakAfterFirst = r1.state.node_runtime.q1.dimension_priority_streak[firstDimensionId] ?? 0;
    const streakAfterSecond = r2.state.node_runtime.q1.dimension_priority_streak[firstDimensionId] ?? 0;
    expect(r1.state.node_runtime.q1.dimension_priority_candidate[firstDimensionId]).toBe("optional");
    expect(streakAfterFirst >= 1).toBe(true);
    expect(r2.state.node_runtime.q1.dimension_priority_current[firstDimensionId]).toBe("optional");
    expect(streakAfterSecond >= streakAfterFirst).toBe(true);
  });

  test("strict must gate blocks node wrap-up when required dimension is unanswered", async () => {
    await publishFlowVersion({
      cards: makeReplayCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const firstDimensionId = started.state.nodes.q1.target_dimensions[0].id;
    const allDimensionIds = started.state.nodes.q1.target_dimensions.map((item) => item.id);

    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [firstDimensionId],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        planner_action: "node_wrap_up",
        node_status: "complete",
        chosen_dimension_to_ask: null,
        should_show_node_summary: true,
        dimension_priority_map: Object.fromEntries(allDimensionIds.map((id) => [id, id === firstDimensionId ? "must" : "optional"])),
        must_dimensions: [firstDimensionId],
        optional_dimensions: allDimensionIds.filter((id) => id !== firstDimensionId),
      }),
    );

    const turn = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "不太确定",
      language: "zh",
    });

    expect(turn.suggested_next_action).toBe("ask_clarification");
    expect(turn.planner_action).toBe("micro_confirm_then_clarify");
    expect(turn.state.session.current_question_id).toBe("q1");
  });

  test("required dimensions auto-downgrade to optional after follow-up limit", async () => {
    await publishFlowVersion({
      cards: makeReplayCards(),
      scenario: "咨询",
      target_output_type: "总结",
      language: "zh",
    });

    const started = await startAskmoreV2Interview({ language: "zh" });
    const firstDimensionId = started.state.nodes.q1.target_dimensions[0].id;
    const allDimensionIds = started.state.nodes.q1.target_dimensions.map((item) => item.id);
    const mustMap = Object.fromEntries(allDimensionIds.map((id) => [id, id === firstDimensionId ? "must" : "optional"]));
    extractTurnFactsMock.mockResolvedValue(
      makeExtractorResult({
        facts_extracted: {},
        updated_dimensions: [],
        missing_dimensions: [firstDimensionId],
        answer_quality: "usable",
      }),
    );
    planDialogueStepMock.mockResolvedValue(
      makePlannerResult({
        chosen_dimension_to_ask: firstDimensionId,
        planner_action: "micro_confirm_then_clarify",
        dimension_priority_map: mustMap,
        must_dimensions: [firstDimensionId],
        optional_dimensions: allDimensionIds.filter((id) => id !== firstDimensionId),
      }),
    );

    await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "还是说不太清楚",
      language: "zh",
    });
    const pre2 = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "依旧不确定",
      language: "zh",
    });
    expect(pre2.state.node_runtime.q1.dimension_priority_current[firstDimensionId]).toBe("must");

    const repo = getAskmoreV2Repository();
    const currentSession = await repo.getSession(started.session_id);
    if (!currentSession) throw new Error("missing session");
    currentSession.state_jsonb.question_progress.q1.follow_up_count = 4;
    currentSession.state_jsonb.node_runtime.q1.dimension_state[firstDimensionId] = "unanswered";
    currentSession.state_jsonb.node_runtime.q1.dimension_answered[firstDimensionId] = false;
    currentSession.state_jsonb.node_runtime.q1.dimension_confidence[firstDimensionId] = 0;
    await repo.updateSession(currentSession);

    const turn = await handleAskmoreV2Turn({
      sessionId: started.session_id,
      userMessage: "这个点还是不确定",
      language: "zh",
    });

    expect(turn.state.node_runtime.q1.dimension_priority_current[firstDimensionId]).toBe("optional");
    expect(turn.state.node_runtime.q1.dimension_priority_downgraded_by_limit[firstDimensionId]).toBe(true);
  });
});
