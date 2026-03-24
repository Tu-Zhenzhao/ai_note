import { getAskmoreV2Repository } from "@/server/askmore_v2/repo";
import { toCanonicalFlowDefinition } from "@/server/askmore_v2/flow-definition";
import {
  AskmoreV2FlowQuestion,
  AskmoreV2Message,
  AskmoreV2Session,
  AskmoreV2SessionListItem,
} from "@/server/askmore_v2/types";

export async function listAskmoreV2Sessions(limit = 100): Promise<AskmoreV2SessionListItem[]> {
  const repo = getAskmoreV2Repository();
  const sessions = await repo.listSessions(limit);
  return sessions.map((session) => ({
    id: session.id,
    status: session.status,
    turn_count: session.turn_count,
    flow_version_id: session.flow_version_id,
    created_at: session.created_at,
    updated_at: session.updated_at,
    current_question_id: session.state_jsonb?.session?.current_question_id ?? null,
  }));
}

export async function getAskmoreV2SessionDetail(sessionId: string): Promise<{
  session: AskmoreV2Session | null;
  messages: AskmoreV2Message[];
  flow_questions: AskmoreV2FlowQuestion[] | null;
}> {
  const repo = getAskmoreV2Repository();
  const session = await repo.getSession(sessionId);
  if (!session) {
    return {
      session: null,
      messages: [],
      flow_questions: null,
    };
  }

  const [messages, flowVersion] = await Promise.all([
    repo.listMessages(sessionId),
    repo.getFlowVersion(session.flow_version_id),
  ]);
  const flow_questions = flowVersion
    ? toCanonicalFlowDefinition(flowVersion.flow_jsonb).final_flow_questions
    : null;

  return {
    session,
    messages,
    flow_questions,
  };
}

export async function deleteAskmoreV2Session(sessionId: string): Promise<boolean> {
  const repo = getAskmoreV2Repository();
  return repo.deleteSession(sessionId);
}
