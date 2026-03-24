import {
  AskmoreV2FlowVersion,
  AskmoreV2Message,
  AskmoreV2Session,
} from "@/server/askmore_v2/types";
import { AskmoreV2Repository } from "@/server/askmore_v2/repo/contracts";

interface AskmoreV2Store {
  flows: Map<string, AskmoreV2FlowVersion>;
  sessions: Map<string, AskmoreV2Session>;
  messages: Map<string, AskmoreV2Message[]>;
}

const globalStore = globalThis as unknown as { __askmoreV2Store?: AskmoreV2Store };

function getStore(): AskmoreV2Store {
  if (!globalStore.__askmoreV2Store) {
    globalStore.__askmoreV2Store = {
      flows: new Map(),
      sessions: new Map(),
      messages: new Map(),
    };
  }
  return globalStore.__askmoreV2Store;
}

export function resetAskmoreV2MemoryStore(): void {
  globalStore.__askmoreV2Store = {
    flows: new Map(),
    sessions: new Map(),
    messages: new Map(),
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
    this.store.sessions.set(session.id, session);
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
    return existed;
  }

  async updateSession(session: AskmoreV2Session): Promise<void> {
    this.store.sessions.set(session.id, session);
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
}
