import { CompletionLevel, InterviewState } from "@/lib/types";
import { getInterviewRepository } from "@/server/repo";

export async function persistStateAndSession(params: {
  sessionId: string;
  state: InterviewState;
  completionLevel: CompletionLevel;
  completionScore: number;
  preview: Record<string, unknown>;
}) {
  const repo = getInterviewRepository();
  const session = await repo.getSession(params.sessionId);
  if (!session) throw new Error("Session not found while persisting state");

  const updatedSession = {
    ...session,
    status: params.state.conversation_meta.interview_stage,
    current_module: params.state.conversation_meta.current_focus_modules[0] ?? "company_profile",
    current_question_id: params.state.conversation_meta.current_focus_checklist_ids[0] ?? "cp_what_does_company_do",
    completion_level: params.completionLevel,
    completion_score: params.completionScore,
    state_schema_version: params.state.conversation_meta.state_schema_version,
    updated_at: new Date().toISOString(),
  };

  await repo.upsertSession(updatedSession);

  await repo.upsertState({
    session_id: params.sessionId,
    state_jsonb: params.state,
    preview_jsonb: params.preview,
    assessment_jsonb: {},
    last_checkpoint_at: params.state.system_assessment.checkpoint_approved ? new Date().toISOString() : null,
  });
}
