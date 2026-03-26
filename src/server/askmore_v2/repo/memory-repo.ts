import {
  AskmoreV2EventChannel,
  AskmoreV2FlowVersion,
  AskmoreV2Message,
  AskmoreV2Session,
  AskmoreV2TurnCommitRecord,
  AskmoreV2TurnEvent,
} from "@/server/askmore_v2/types";
import { AskmoreV2Repository } from "@/server/askmore_v2/repo/contracts";

interface AskmoreV2Store {
  flows: Map<string, AskmoreV2FlowVersion>;
  sessions: Map<string, AskmoreV2Session>;
  messages: Map<string, AskmoreV2Message[]>;
  events: Map<string, Array<{ turn_id: string; channel: AskmoreV2EventChannel; event: AskmoreV2TurnEvent }>>;
  commits: Map<string, AskmoreV2TurnCommitRecord>;
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
    };
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
  };
}

export class MemoryAskmoreV2Repository implements AskmoreV2Repository {
  private readonly store = getStore();

  async createFlowVersion(flow: AskmoreV2FlowVersion): Promise<void> {
    this.store.flows.set(flow.id, flow);
  }

  async listFlowVersions(limit = 50): Promise<AskmoreV2FlowVersion[]> {
    return Array.from(this.store.flows.values())
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  async getFlowVersion(flowVersionId: string): Promise<AskmoreV2FlowVersion | null> {
    return this.store.flows.get(flowVersionId) ?? null;
  }

  async getActiveFlowVersion(): Promise<AskmoreV2FlowVersion | null> {
    const published = Array.from(this.store.flows.values())
      .filter((flow) => flow.status === "published")
      .sort((a, b) => b.version - a.version);
    return published[0] ?? null;
  }

  async clearPublishedFlowVersions(): Promise<void> {
    for (const [id, flow] of this.store.flows.entries()) {
      if (flow.status !== "published") continue;
      this.store.flows.set(id, {
        ...flow,
        status: "draft",
        published_at: null,
      });
    }
  }

  async createSession(session: AskmoreV2Session): Promise<void> {
    this.store.sessions.set(session.id, {
      ...session,
      state_version: session.state_version > 0 ? session.state_version : 1,
    });
  }

  async getSession(sessionId: string): Promise<AskmoreV2Session | null> {
    return this.store.sessions.get(sessionId) ?? null;
  }

  async listSessions(limit = 100): Promise<AskmoreV2Session[]> {
    return Array.from(this.store.sessions.values())
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const existed = this.store.sessions.delete(sessionId);
    this.store.messages.delete(sessionId);
    this.store.events.delete(sessionId);
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
    this.store.sessions.set(session.id, {
      ...session,
      state_version: session.state_version + 1,
    });
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
}
