import {
  AskmoreV2Language,
  AskmoreV2NodeRuntimeState,
  AskmoreV2QuestionNode,
  AskmoreV2TurnChoiceInput,
  AskmoreV2TurnExtractorOutput,
} from "@/server/askmore_v2/types";
import { extractTurnFacts } from "@/server/askmore_v2/services/turn-extractor";

export async function extractFactsFromTurn(params: {
  language: AskmoreV2Language;
  node: AskmoreV2QuestionNode;
  nodeRuntime: AskmoreV2NodeRuntimeState;
  userMessage: string;
  choice?: AskmoreV2TurnChoiceInput;
  hintDimensionId?: string | null;
}): Promise<AskmoreV2TurnExtractorOutput> {
  if (params.choice) {
    return {
      facts_extracted: {
        [params.choice.dimension_id]: {
          value: params.choice.option_label,
          evidence: params.userMessage.trim().slice(0, 120) || params.choice.option_label,
          confidence: 0.92,
        },
      },
      updated_dimensions: [params.choice.dimension_id],
      missing_dimensions: [],
      unanswered_dimensions: [],
      answer_quality: "usable",
      user_effort_signal: "normal",
      contradiction_detected: false,
      candidate_hypothesis: "choice_confirmation",
      confidence_overall: 0.78,
      normalized_dimension_map: {
        [params.choice.dimension_id]: params.choice.dimension_id,
      },
      normalization_hits: [],
    };
  }

  return extractTurnFacts({
    language: params.language,
    currentNode: params.node,
    nodeState: params.nodeRuntime,
    userMessage: params.userMessage,
    hintDimensionId: params.hintDimensionId ?? null,
  });
}
