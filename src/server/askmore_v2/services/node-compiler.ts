import {
  AskmoreV2FlowQuestion,
  AskmoreV2Language,
  AskmoreV2QuestionNode,
} from "@/server/askmore_v2/types";
import {
  buildSemanticDimensionsFromQuestion,
  deriveCompletionCriteriaFromDimensions,
} from "@/server/askmore_v2/services/dimension-intelligence";

export function buildQuestionNode(params: {
  question: AskmoreV2FlowQuestion;
  language: AskmoreV2Language;
}): AskmoreV2QuestionNode {
  const dimensions = buildSemanticDimensionsFromQuestion({
    question: params.question,
    language: params.language,
  });
  const completionCriteria = deriveCompletionCriteriaFromDimensions(dimensions);

  return {
    question_id: params.question.question_id,
    goal:
      params.language === "zh"
        ? `澄清「${params.question.original_question}」相关的关键事实。`
        : `Clarify key facts related to "${params.question.original_question}".`,
    user_facing_entry: params.question.entry_question,
    target_dimensions: dimensions,
    completion_criteria: completionCriteria,
    hypothesis_templates:
      params.language === "zh"
        ? ["倾向 A", "倾向 B", "信息暂不足"]
        : ["leaning to A", "leaning to B", "insufficient information"],
    node_summary_template:
      params.language === "zh"
        ? `关于「${params.question.original_question}」这部分，我目前理解是：...`
        : `For "${params.question.original_question}", my current understanding is: ...`,
  };
}

export async function compileQuestionNodes(params: {
  questions: AskmoreV2FlowQuestion[];
  scenario: string;
  targetOutputType: string;
  language: AskmoreV2Language;
}): Promise<Record<string, AskmoreV2QuestionNode>> {
  const nodes: Record<string, AskmoreV2QuestionNode> = {};

  for (const question of params.questions) {
    nodes[question.question_id] = buildQuestionNode({
      question,
      language: params.language,
    });
  }

  return nodes;
}
