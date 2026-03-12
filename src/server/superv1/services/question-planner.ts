import { SuperV1ChecklistAnswer, SuperV1PlannerResult, SuperV1TemplateQuestion } from "@/server/superv1/types";
import { buildPlannerResult } from "@/server/superv1/services/checklist-state-service";

export function planNextQuestion(params: {
  questions: SuperV1TemplateQuestion[];
  answers: SuperV1ChecklistAnswer[];
}): SuperV1PlannerResult {
  return buildPlannerResult(params.questions, params.answers);
}

