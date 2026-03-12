import { randomUUID } from "crypto";
import { SuperV1Repository } from "@/server/superv1/repo/contracts";
import { SuperV1ExtractionOutput, SuperV1PlannerResult, SuperV1ValidatedExtraction } from "@/server/superv1/types";

export async function logExtractionEvent(params: {
  repo: SuperV1Repository;
  conversationId: string;
  turnId: string;
  extraction: SuperV1ExtractionOutput;
  validated: SuperV1ValidatedExtraction;
}): Promise<void> {
  await params.repo.addExtractionEvent({
    id: randomUUID(),
    conversation_id: params.conversationId,
    turn_id: params.turnId,
    raw_extraction_json: params.extraction,
    accepted_updates_json: params.validated.accepted_updates,
    rejected_updates_json: params.validated.rejected_updates,
    created_at: new Date().toISOString(),
  });
}

export async function logPlannerEvent(params: {
  repo: SuperV1Repository;
  conversationId: string;
  turnId: string;
  plannerResult: SuperV1PlannerResult;
}): Promise<void> {
  await params.repo.addPlannerEvent({
    id: randomUUID(),
    conversation_id: params.conversationId,
    turn_id: params.turnId,
    planner_result_json: params.plannerResult,
    created_at: new Date().toISOString(),
  });
}

