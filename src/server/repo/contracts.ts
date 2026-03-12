import {
  ChatBookEntry,
  CheckpointSnapshot,
  GeneratedBrief,
  GeneratedContent,
  HandoffSummary,
  InterviewMessage,
  InterviewSession,
  InterviewState,
  PayloadPatchLog,
  PlannerDecision,
  SessionTrace,
  SystemAssessment,
  ToolActionLog,
} from "@/lib/types";

export interface InterviewStateRecord {
  session_id: string;
  state_jsonb: InterviewState;
  preview_jsonb: Record<string, unknown>;
  assessment_jsonb: SystemAssessment | Record<string, unknown>;
  last_checkpoint_at: string | null;
}

export interface SessionSummary {
  id: string;
  status: string;
  completion_level: string;
  completion_score: number;
  created_at: string;
  updated_at: string;
}

export interface InterviewRepository {
  listSessions(): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<InterviewSession | null>;
  createSession(session: InterviewSession): Promise<void>;
  upsertSession(session: InterviewSession): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;

  getState(sessionId: string): Promise<InterviewStateRecord | null>;
  upsertState(record: InterviewStateRecord): Promise<void>;

  listMessages(sessionId: string): Promise<InterviewMessage[]>;
  addMessage(message: InterviewMessage): Promise<void>;

  addBrief(brief: GeneratedBrief): Promise<void>;
  getBrief(briefId: string): Promise<GeneratedBrief | null>;

  addGeneratedContent(content: GeneratedContent): Promise<void>;

  addHandoffSummary(summary: HandoffSummary): Promise<void>;

  addChatBookEntry(entry: ChatBookEntry): Promise<void>;
  listChatBookEntries(sessionId: string, limit?: number): Promise<ChatBookEntry[]>;

  addPlannerDecision(decision: PlannerDecision): Promise<void>;
  listPlannerDecisions(sessionId: string, limit?: number): Promise<PlannerDecision[]>;

  addPayloadPatchLog(log: PayloadPatchLog): Promise<void>;
  listPayloadPatchLogs(sessionId: string, limit?: number): Promise<PayloadPatchLog[]>;

  addToolActionLog(log: ToolActionLog): Promise<void>;
  listToolActionLogs(sessionId: string, limit?: number): Promise<ToolActionLog[]>;

  addCheckpointSnapshot(snapshot: CheckpointSnapshot): Promise<void>;
  listCheckpointSnapshots(sessionId: string, limit?: number): Promise<CheckpointSnapshot[]>;

  getSessionTrace(sessionId: string, limit?: number): Promise<SessionTrace>;
}
