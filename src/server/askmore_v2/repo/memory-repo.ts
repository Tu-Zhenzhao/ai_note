import {
  AskmoreV2EventChannel,
  AskmoreV2FlowVersion,
  AskmoreV2InsightRunRecord,
  AskmoreV2Message,
  AskmoreV2Session,
  AskmoreV2TurnCommitRecord,
  AskmoreV2TurnEvent,
} from "@/server/askmore_v2/types";
import { AskmoreV2Repository } from "@/server/askmore_v2/repo/contracts";
import { DEFAULT_WORKSPACE_ID } from "@/server/auth/constants";

interface AskmoreV2Store {
  flows: Map<string, AskmoreV2FlowVersion>;
  sessions: Map<string, AskmoreV2Session>;
  messages: Map<string, AskmoreV2Message[]>;
  events: Map<string, Array<{ turn_id: string; channel: AskmoreV2EventChannel; event: AskmoreV2TurnEvent }>>;
  commits: Map<string, AskmoreV2TurnCommitRecord>;
  insightRuns: Map<string, AskmoreV2InsightRunRecord[]>;
}

const globalStore = globalThis as unknown as { __askmoreV2Store?: AskmoreV2Store };

function getStore(): AskmoreV2Store {
  if (!globalStore.__askmoreV2Store) {
    globalStore.__askmoreV2Store = {
      flows: new Map(),
      sessions: new Map(),
      messages: new Map(),
      events: new Map(),
      commits: new Map(),
      insightRuns: new Map(),
    };
  }
  if (!globalStore.__askmoreV2Store.insightRuns) {
    globalStore.__askmoreV2Store.insightRuns = new Map();
  }
  return globalStore.__askmoreV2Store;
}

export function resetAskmoreV2MemoryStore(): void {
  globalStore.__askmoreV2Store = {
    flows: new Map(),
    sessions: new Map(),
    messages: new Map(),
    events: new Map(),
    commits: new Map(),
    insightRuns: new Map(),
  };
}

export class MemoryAskmoreV2Repository implements AskmoreV2Repository {
  private readonly store = getStore();
  private resolveWorkspaceId(workspaceId?: string): string {
    const normalized = workspaceId?.trim();
    return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_ID;
  }

  async createFlowVersion(flow: AskmoreV2FlowVersion): Promise<void> {
    const workspaceId = this.resolveWorkspaceId(flow.workspace_id);
    this.store.flows.set(flow.id, {
      ...flow,
      workspace_id: workspaceId,
    });
    flow.workspace_id = workspaceId;
  }

  async listFlowVersions(limit = 50, workspaceId?: string): Promise<AskmoreV2FlowVersion[]> {
    const scopeWorkspaceId = this.resolveWorkspaceId(workspaceId);
    return Array.from(this.store.flows.values())
      .filter((flow) => this.resolveWorkspaceId(flow.workspace_id) === scopeWorkspaceId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  async getFlowVersion(flowVersionId: string, workspaceId?: string): Promise<AskmoreV2FlowVersion | null> {
    const scopeWorkspaceId = this.resolveWorkspaceId(workspaceId);
    const flow = this.store.flows.get(flowVersionId) ?? null;
    if (!flow) return null;
    if (this.resolveWorkspaceId(flow.workspace_id) !== scopeWorkspaceId) return null;
    return flow;
  }

  async getActiveFlowVersion(workspaceId?: string): Promise<AskmoreV2FlowVersion | null> {
    const scopeWorkspaceId = this.resolveWorkspaceId(workspaceId);
    const published = Array.from(this.store.flows.values())
      .filter((flow) => (
        flow.status === "published"
        && this.resolveWorkspaceId(flow.workspace_id) === scopeWorkspaceId
      ))
      .sort((a, b) => b.version - a.version);
    return published[0] ?? null;
  }

  async clearPublishedFlowVersions(workspaceId?: string): Promise<void> {
    const scopeWorkspaceId = this.resolveWorkspaceId(workspaceId);
    for (const [id, flow] of this.store.flows.entries()) {
      if (flow.status !== "published") continue;
      if (this.resolveWorkspaceId(flow.workspace_id) !== scopeWorkspaceId) continue;
      this.store.flows.set(id, {
        ...flow,
        status: "draft",
        published_at: null,
      });
    }
  }

  async createSession(session: AskmoreV2Session): Promise<void> {
    const workspaceId = this.resolveWorkspaceId(session.workspace_id);
    this.store.sessions.set(session.id, {
      ...session,
      workspace_id: workspaceId,
      state_version: session.state_version > 0 ? session.state_version : 1,
    });
    session.workspace_id = workspaceId;
  }

  async getSession(sessionId: string, workspaceId?: string): Promise<AskmoreV2Session | null> {
    const scopeWorkspaceId = this.resolveWorkspaceId(workspaceId);
    const session = this.store.sessions.get(sessionId) ?? null;
    if (!session) return null;
    if (this.resolveWorkspaceId(session.workspace_id) !== scopeWorkspaceId) return null;
    return session;
  }

  async listSessions(limit = 100, workspaceId?: string): Promise<AskmoreV2Session[]> {
    const scopeWorkspaceId = this.resolveWorkspaceId(workspaceId);
    return Array.from(this.store.sessions.values())
      .filter((session) => this.resolveWorkspaceId(session.workspace_id) === scopeWorkspaceId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit);
  }

  async deleteSession(sessionId: string, workspaceId?: string): Promise<boolean> {
    const scopeWorkspaceId = this.resolveWorkspaceId(workspaceId);
    const session = this.store.sessions.get(sessionId);
    if (!session) return false;
    if (this.resolveWorkspaceId(session.workspace_id) !== scopeWorkspaceId) return false;
    const existed = this.store.sessions.delete(sessionId);
    this.store.messages.delete(sessionId);
    this.store.events.delete(sessionId);
    this.store.insightRuns.delete(sessionId);
    for (const key of this.store.commits.keys()) {
      if (key.startsWith(`${sessionId}::`)) this.store.commits.delete(key);
    }
    return existed;
  }

  async updateSession(session: AskmoreV2Session): Promise<void> {
    const current = this.store.sessions.get(session.id);
    if (!current) {
      throw new Error("Session not found");
    }
    if (current.state_version !== session.state_version) {
      throw new Error("ASKMORE_V2_STATE_VERSION_CONFLICT");
    }
    const workspaceId = this.resolveWorkspaceId(session.workspace_id ?? current.workspace_id);
    this.store.sessions.set(session.id, {
      ...session,
      workspace_id: workspaceId,
      state_version: session.state_version + 1,
    });
    session.workspace_id = workspaceId;
    session.state_version += 1;
  }

  async addMessage(message: AskmoreV2Message): Promise<void> {
    const list = this.store.messages.get(message.session_id) ?? [];
    list.push(message);
    this.store.messages.set(message.session_id, list);
  }

  async listMessages(sessionId: string, limit?: number): Promise<AskmoreV2Message[]> {
    const list = this.store.messages.get(sessionId) ?? [];
    if (!limit) return [...list];
    return list.slice(-limit);
  }

  async addTurnEvents(params: {
    session_id: string;
    turn_id: string;
    channel: AskmoreV2EventChannel;
    events: AskmoreV2TurnEvent[];
  }): Promise<void> {
    const existing = this.store.events.get(params.session_id) ?? [];
    const tagged = params.events.map((event) => ({ turn_id: params.turn_id, channel: params.channel, event }));
    this.store.events.set(params.session_id, [...existing, ...tagged]);
  }

  async listTurnEvents(
    sessionId: string,
    turnId?: string,
    channel: AskmoreV2EventChannel = "visible",
  ): Promise<AskmoreV2TurnEvent[]> {
    const list = this.store.events.get(sessionId) ?? [];
    const filtered = list.filter((item) => item.channel === channel);
    if (!turnId) return filtered.map((item) => item.event);
    return filtered.filter((item) => item.turn_id === turnId).map((item) => item.event);
  }

  async getTurnEventById(
    sessionId: string,
    eventId: string,
    channel: AskmoreV2EventChannel = "visible",
  ): Promise<AskmoreV2TurnEvent | null> {
    const list = this.store.events.get(sessionId) ?? [];
    const found = list.find((item) => item.channel === channel && item.event.event_id === eventId);
    return found?.event ?? null;
  }

  async getTurnCommit(sessionId: string, clientTurnId: string): Promise<AskmoreV2TurnCommitRecord | null> {
    return this.store.commits.get(`${sessionId}::${clientTurnId}`) ?? null;
  }

  async createTurnCommit(record: AskmoreV2TurnCommitRecord): Promise<void> {
    const key = `${record.session_id}::${record.client_turn_id}`;
    if (this.store.commits.has(key)) {
      throw new Error("ASKMORE_V2_TURN_COMMIT_CONFLICT");
    }
    this.store.commits.set(key, record);
  }

  async createInsightRun(record: AskmoreV2InsightRunRecord): Promise<void> {
    const list = this.store.insightRuns.get(record.session_id) ?? [];
    list.push(record);
    this.store.insightRuns.set(record.session_id, list);
  }

  async listInsightRuns(sessionId: string, limit = 20, workspaceId?: string): Promise<AskmoreV2InsightRunRecord[]> {
    const scopeWorkspaceId = this.resolveWorkspaceId(workspaceId);
    const session = this.store.sessions.get(sessionId);
    if (!session) return [];
    if (this.resolveWorkspaceId(session.workspace_id) !== scopeWorkspaceId) return [];
    const list = this.store.insightRuns.get(sessionId) ?? [];
    return [...list]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  async getLatestInsightRun(sessionId: string, workspaceId?: string): Promise<AskmoreV2InsightRunRecord | null> {
    const list = await this.listInsightRuns(sessionId, 1, workspaceId);
    return list[0] ?? null;
  }
}
