import {
  AskmoreV2FlowVersion,
  AskmoreV2EventChannel,
  AskmoreV2InsightRunRecord,
  AskmoreV2Message,
  AskmoreV2Session,
  AskmoreV2TurnCommitRecord,
  AskmoreV2TurnEvent,
} from "@/server/askmore_v2/types";

export interface AskmoreV2Repository {
  createFlowVersion(flow: AskmoreV2FlowVersion): Promise<void>;
  listFlowVersions(limit?: number): Promise<AskmoreV2FlowVersion[]>;
  getFlowVersion(flowVersionId: string): Promise<AskmoreV2FlowVersion | null>;
  getActiveFlowVersion(): Promise<AskmoreV2FlowVersion | null>;
  clearPublishedFlowVersions(): Promise<void>;

  createSession(session: AskmoreV2Session): Promise<void>;
  listSessions(limit?: number): Promise<AskmoreV2Session[]>;
  getSession(sessionId: string): Promise<AskmoreV2Session | null>;
  deleteSession(sessionId: string): Promise<boolean>;
  updateSession(session: AskmoreV2Session): Promise<void>;

  addMessage(message: AskmoreV2Message): Promise<void>;
  listMessages(sessionId: string, limit?: number): Promise<AskmoreV2Message[]>;

  addTurnEvents(params: {
    session_id: string;
    turn_id: string;
    channel: AskmoreV2EventChannel;
    events: AskmoreV2TurnEvent[];
  }): Promise<void>;
  listTurnEvents(
    sessionId: string,
    turnId?: string,
    channel?: AskmoreV2EventChannel,
  ): Promise<AskmoreV2TurnEvent[]>;
  getTurnEventById(
    sessionId: string,
    eventId: string,
    channel?: AskmoreV2EventChannel,
  ): Promise<AskmoreV2TurnEvent | null>;

  getTurnCommit(sessionId: string, clientTurnId: string): Promise<AskmoreV2TurnCommitRecord | null>;
  createTurnCommit(record: AskmoreV2TurnCommitRecord): Promise<void>;

  createInsightRun(record: AskmoreV2InsightRunRecord): Promise<void>;
  listInsightRuns(sessionId: string, limit?: number): Promise<AskmoreV2InsightRunRecord[]>;
  getLatestInsightRun(sessionId: string): Promise<AskmoreV2InsightRunRecord | null>;
}
