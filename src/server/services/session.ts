import { randomUUID } from "crypto";
import { createInitialState } from "@/lib/state";
import { InterviewSession } from "@/lib/types";
import { getInterviewRepository } from "@/server/repo";

export async function getOrCreateSession(sessionId: string) {
  const repo = getInterviewRepository();
  const existingSession = await repo.getSession(sessionId);
  const existingState = await repo.getState(sessionId);

  if (existingSession && existingState) {
    return {
      session: existingSession,
      stateRecord: existingState,
    };
  }

  const now = new Date().toISOString();
  const state = createInitialState(sessionId);

  const session: InterviewSession = {
    id: sessionId,
    user_id: "demo_user",
    status: "opening",
    current_module: state.conversation_meta.current_focus_modules[0] ?? "company_profile",
    current_question_id: state.conversation_meta.current_focus_checklist_ids[0] ?? "cp_what_does_company_do",
    completion_level: "incomplete",
    completion_score: 0,
    model_primary: process.env.MODEL_PRIMARY ?? "gemini-3.1-flash-lite-preview",
    model_fallback: process.env.MODEL_FALLBACK ?? "deepseek-chat",
    state_schema_version: state.conversation_meta.state_schema_version,
    created_at: now,
    updated_at: now,
  };

  await repo.createSession(session);
  await repo.upsertState({
    session_id: sessionId,
    state_jsonb: state,
    preview_jsonb: {},
    assessment_jsonb: state.system_assessment,
    last_checkpoint_at: null,
  });

  return {
    session,
    stateRecord: {
      session_id: sessionId,
      state_jsonb: state,
      preview_jsonb: {},
      assessment_jsonb: state.system_assessment,
      last_checkpoint_at: null,
    },
  };
}

export function newMessageId() {
  return randomUUID();
}
