import { randomUUID } from "crypto";
import { getAskmoreV2Repository } from "@/server/askmore_v2/repo";
import {
  normalizeQuestionCard,
  toCanonicalFlowDefinition,
  toFlowQuestion,
} from "@/server/askmore_v2/flow-definition";
import { refineQuestionList } from "@/server/askmore_v2/services/question-refiner";
import {
  AskmoreV2FlowDefinitionV2,
  AskmoreV2FlowVersion,
  AskmoreV2Language,
  AskmoreV2QuestionCard,
} from "@/server/askmore_v2/types";

function nonEmptyList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function validateCustomManualPayload(rawCard: AskmoreV2QuestionCard, index: number) {
  if (rawCard.selection?.mode !== "custom_manual") return;
  const finalPayload = rawCard.final_payload;
  const entry = finalPayload?.entry_question?.trim() ?? "";
  const strategy = finalPayload?.recommended_strategy?.trim() ?? "";
  const subQuestions = nonEmptyList(finalPayload?.sub_questions);
  const styles = nonEmptyList(finalPayload?.example_answer_styles);

  if (!entry || !strategy || subQuestions.length === 0 || styles.length === 0) {
    throw new Error(
      `Card ${index + 1} in custom_manual mode requires complete final_payload: entry_question, recommended_strategy, sub_questions, example_answer_styles.`,
    );
  }
}

function normalizeCards(cards: AskmoreV2QuestionCard[]): AskmoreV2QuestionCard[] {
  return cards.map((card, index) => {
    const mode = card.selection?.mode;
    if (mode !== "use_original" && mode !== "use_ai_refined" && mode !== "custom_manual") {
      throw new Error(`Card ${index + 1} has invalid selection_mode.`);
    }
    validateCustomManualPayload(card, index);
    return normalizeQuestionCard(card, index);
  });
}

export async function reviewRawQuestions(params: {
  raw_questions: string[];
  scenario: string;
  target_output_type: string;
  language: AskmoreV2Language;
}): Promise<{ cards: AskmoreV2QuestionCard[]; review_generation_meta: { used_fallback: boolean; fallback_count: number } }> {
  const refined = await refineQuestionList({
    rawQuestions: params.raw_questions,
    scenario: params.scenario,
    targetOutputType: params.target_output_type,
    language: params.language,
  });

  return {
    cards: refined.cards,
    review_generation_meta: refined.review_generation_meta,
  };
}

export async function publishFlowVersion(params: {
  cards: AskmoreV2QuestionCard[];
  raw_questions?: string[];
  scenario?: string;
  target_output_type?: string;
  language?: AskmoreV2Language;
  workspace_id?: string;
}): Promise<{ flow_version_id: string; version: number; status: "published" }> {
  const repo = getAskmoreV2Repository();
  if (!Array.isArray(params.cards) || params.cards.length === 0) {
    throw new Error("At least one question card is required before publishing.");
  }

  const cards = normalizeCards(params.cards).filter((card) => card.original_question.trim().length > 0);
  if (cards.length === 0) {
    throw new Error("At least one valid question card is required before publishing.");
  }

  const workspaceId = params.workspace_id;
  const existing = await repo.listFlowVersions(1, workspaceId);
  const nextVersion = existing[0] ? existing[0].version + 1 : 1;
  const now = new Date().toISOString();
  const flowVersionId = randomUUID();

  const fallbackCount = cards.filter((card) => card.review_generation_meta?.used_fallback).length;
  const flowDefinition: AskmoreV2FlowDefinitionV2 = {
    schema_version: 2,
    raw_questions: params.raw_questions ?? cards.map((card) => card.original_question),
    scenario: params.scenario ?? "general interview",
    target_output_type: params.target_output_type ?? "summary report",
    language: params.language ?? "zh",
    cards_snapshot: cards,
    final_flow_questions: cards.map(toFlowQuestion),
    review_generation_meta: {
      used_fallback: fallbackCount > 0,
      fallback_count: fallbackCount,
    },
  };

  const version: AskmoreV2FlowVersion = {
    id: flowVersionId,
    version: nextVersion,
    workspace_id: workspaceId,
    status: "published",
    flow_jsonb: flowDefinition,
    published_at: now,
    created_at: now,
    updated_at: now,
  };

  await repo.clearPublishedFlowVersions(workspaceId);
  await repo.createFlowVersion(version);

  return {
    flow_version_id: flowVersionId,
    version: nextVersion,
    status: "published",
  };
}

export async function getActiveFlowVersion(workspaceId?: string) {
  const repo = getAskmoreV2Repository();
  const flow = await repo.getActiveFlowVersion(workspaceId);
  if (!flow) return null;
  return {
    ...flow,
    flow_jsonb: toCanonicalFlowDefinition(flow.flow_jsonb),
  };
}
