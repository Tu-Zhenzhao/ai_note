import { describe, expect, test } from "vitest";
import { validateExtraction } from "@/server/superv1/services/extraction-validator";
import { buildPlannerResult, deriveStateView } from "@/server/superv1/services/checklist-state-service";
import { SuperV1Conversation, SuperV1TemplateQuestion } from "@/server/superv1/types";

const questions: SuperV1TemplateQuestion[] = [
  {
    id: "q1",
    template_id: "t1",
    section_id: "company_understanding",
    question_id: "cp_what_does_company_do",
    question_text: "What does the company do?",
    question_description: null,
    field_type: "text",
    is_required: true,
    display_order: 1,
  },
  {
    id: "q2",
    template_id: "t1",
    section_id: "audience_understanding",
    question_id: "ma_primary_audience",
    question_text: "Who is the primary audience?",
    question_description: null,
    field_type: "text",
    is_required: true,
    display_order: 2,
  },
];

describe("superv1 validator", () => {
  test("accepts only allowed open question updates with confidence >= 0.75", () => {
    const validated = validateExtraction({
      extraction: {
        filled_items: [
          {
            question_id: "cp_what_does_company_do",
            value: "We provide search API tooling.",
            confidence: 0.8,
            evidence: "We provide search API tooling.",
          },
          {
            question_id: "ma_primary_audience",
            value: "Operations leaders",
            confidence: 0.6,
            evidence: "Ops leaders",
          },
        ],
        ambiguous_items: [],
        possible_items: [],
      },
      openQuestions: [questions[0]],
      answers: [],
    });

    expect(validated.accepted_updates).toHaveLength(1);
    expect(validated.accepted_updates[0].question_id).toBe("cp_what_does_company_do");
    expect(validated.rejected_updates.some((entry) => entry.question_id === "ma_primary_audience")).toBe(true);
  });
});

describe("superv1 planner", () => {
  test("keeps active section on first unresolved required question and asks max one", () => {
    const planner = buildPlannerResult(questions, [
      {
        id: "a1",
        conversation_id: "c1",
        question_id: "cp_what_does_company_do",
        value_json: null,
        status: "empty",
        confidence: null,
        evidence_text: null,
        source_turn_id: null,
        updated_at: new Date().toISOString(),
      },
      {
        id: "a2",
        conversation_id: "c1",
        question_id: "ma_primary_audience",
        value_json: null,
        status: "empty",
        confidence: null,
        evidence_text: null,
        source_turn_id: null,
        updated_at: new Date().toISOString(),
      },
    ]);

    expect(planner.active_section_id).toBe("company_understanding");
    expect(planner.next_question_id).toBe("cp_what_does_company_do");
    expect(planner.ask_count).toBe(1);
  });
});

describe("superv1 state view completion", () => {
  test("required completion reaches 100% when all required questions are resolved", () => {
    const now = new Date().toISOString();
    const withOptional: SuperV1TemplateQuestion[] = [
      ...questions,
      {
        id: "q3",
        template_id: "t1",
        section_id: "audience_understanding",
        question_id: "ma_outcomes",
        question_text: "What outcomes do they want?",
        question_description: null,
        field_type: "text",
        is_required: false,
        display_order: 3,
      },
    ];
    const conversation: SuperV1Conversation = {
      id: "c1",
      template_id: "t1",
      status: "active",
      active_section_id: "audience_understanding",
      current_question_id: "ma_primary_audience",
      interaction_mode: "interviewing",
      help_context_json: null,
      created_at: now,
      updated_at: now,
    };

    const state = deriveStateView({
      conversation,
      questions: withOptional,
      answers: [
        {
          id: "a1",
          conversation_id: "c1",
          question_id: "cp_what_does_company_do",
          value_json: { text: "We provide search API tooling." },
          status: "confirmed",
          confidence: 0.92,
          evidence_text: "We provide search API tooling.",
          source_turn_id: "turn1",
          updated_at: now,
        },
        {
          id: "a2",
          conversation_id: "c1",
          question_id: "ma_primary_audience",
          value_json: { text: "Operations leaders" },
          status: "filled",
          confidence: 0.81,
          evidence_text: "Operations leaders",
          source_turn_id: "turn2",
          updated_at: now,
        },
      ],
      aiSuggestedDirections: null,
    });

    expect(state.completion.required_total).toBe(2);
    expect(state.completion.required_resolved).toBe(2);
    expect(state.completion.required_ratio).toBe(1);
    expect(state.completion.total).toBe(3);
    expect(state.completion.ratio).toBeLessThan(1);
  });
});
