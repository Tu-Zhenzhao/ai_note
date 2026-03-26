import { AskmoreV2FlowQuestion, AskmoreV2QuestionNode } from "@/server/askmore_v2/types";

export function findNextQuestionId(questions: AskmoreV2FlowQuestion[], currentQuestionId: string | null): string | null {
  if (!currentQuestionId) return questions[0]?.question_id ?? null;
  const index = questions.findIndex((item) => item.question_id === currentQuestionId);
  if (index < 0) return questions[0]?.question_id ?? null;
  return questions[index + 1]?.question_id ?? null;
}

export function buildQuestionPrompt(params: {
  question: AskmoreV2FlowQuestion | null;
  node: AskmoreV2QuestionNode | null;
}): string | null {
  return params.node?.user_facing_entry ?? params.question?.entry_question ?? null;
}
