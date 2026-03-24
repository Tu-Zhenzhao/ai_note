import {
  AskmoreV2FlowVersion,
  AskmoreV2Message,
  AskmoreV2Session,
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
}
