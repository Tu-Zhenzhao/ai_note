import {
  ChatBookEntry,
  CheckpointSnapshot,
  GeneratedBrief,
  GeneratedContent,
  HandoffSummary,
  InterviewMessage,
  InterviewSession,
  PayloadPatchLog,
  PlannerDecision,
  SessionTrace,
  ToolActionLog,
} from "@/lib/types";
import { InterviewRepository, InterviewStateRecord, SessionSummary } from "@/server/repo/contracts";

interface Store {
  sessions: Map<string, InterviewSession>;
  states: Map<string, InterviewStateRecord>;
  messages: Map<string, InterviewMessage[]>;
  briefs: Map<string, GeneratedBrief>;
  contents: Map<string, GeneratedContent>;
  handoffs: Map<string, HandoffSummary>;
  chatBook: Map<string, ChatBookEntry[]>;
  plannerDecisions: Map<string, PlannerDecision[]>;
  payloadPatchLog: Map<string, PayloadPatchLog[]>;
  toolActionLog: Map<string, ToolActionLog[]>;
  checkpointSnapshots: Map<string, CheckpointSnapshot[]>;
}

const globalStore = globalThis as unknown as { __interviewStore?: Store };

function getStore(): Store {
  if (!globalStore.__interviewStore) {
    globalStore.__interviewStore = {
      sessions: new Map(),
      states: new Map(),
      messages: new Map(),
      briefs: new Map(),
      contents: new Map(),
      handoffs: new Map(),
      chatBook: new Map(),
      plannerDecisions: new Map(),
      payloadPatchLog: new Map(),
      toolActionLog: new Map(),
      checkpointSnapshots: new Map(),
    };
  }
  return globalStore.__interviewStore;
}

const CAPS = {
  messages: 200,
  chatBook: 100,
  plannerDecisions: 100,
  payloadPatchLog: 100,
  toolActionLog: 300,
  checkpointSnapshots: 50,
} as const;

function pushCapped<T>(items: T[], entry: T, cap: number): void {
  items.push(entry);
  if (items.length > cap) items.splice(0, items.length - cap);
}

export class MemoryInterviewRepository implements InterviewRepository {
  private readonly store = getStore();

  async listSessions(): Promise<SessionSummary[]> {
    return Array.from(this.store.sessions.values())
      .map((s) => ({
        id: s.id,
        status: s.status,
        completion_level: s.completion_level,
        completion_score: s.completion_score,
        created_at: s.created_at,
        updated_at: s.updated_at,
      }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getSession(sessionId: string): Promise<InterviewSession | null> {
    return this.store.sessions.get(sessionId) ?? null;
  }

  async createSession(session: InterviewSession): Promise<void> {
    this.store.sessions.set(session.id, session);
  }

  async upsertSession(session: InterviewSession): Promise<void> {
    this.store.sessions.set(session.id, session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.store.sessions.delete(sessionId);
    this.store.states.delete(sessionId);
    this.store.messages.delete(sessionId);
    this.store.chatBook.delete(sessionId);
    this.store.plannerDecisions.delete(sessionId);
    this.store.payloadPatchLog.delete(sessionId);
    this.store.toolActionLog.delete(sessionId);
    this.store.checkpointSnapshots.delete(sessionId);
  }

  async getState(sessionId: string): Promise<InterviewStateRecord | null> {
    return this.store.states.get(sessionId) ?? null;
  }

  async upsertState(record: InterviewStateRecord): Promise<void> {
    this.store.states.set(record.session_id, record);
  }

  async listMessages(sessionId: string, limit?: number): Promise<InterviewMessage[]> {
    const items = this.store.messages.get(sessionId) ?? [];
    return limit ? items.slice(-limit) : items;
  }

  async addMessage(message: InterviewMessage): Promise<void> {
    const items = this.store.messages.get(message.session_id) ?? [];
    pushCapped(items, message, CAPS.messages);
    this.store.messages.set(message.session_id, items);
  }

  async addBrief(brief: GeneratedBrief): Promise<void> {
    this.store.briefs.set(brief.id, brief);
  }

  async getBrief(briefId: string): Promise<GeneratedBrief | null> {
    return this.store.briefs.get(briefId) ?? null;
  }

  async addGeneratedContent(content: GeneratedContent): Promise<void> {
    this.store.contents.set(content.id, content);
  }

  async addHandoffSummary(summary: HandoffSummary): Promise<void> {
    this.store.handoffs.set(summary.id, summary);
  }

  async addChatBookEntry(entry: ChatBookEntry): Promise<void> {
    const items = this.store.chatBook.get(entry.session_id) ?? [];
    pushCapped(items, entry, CAPS.chatBook);
    this.store.chatBook.set(entry.session_id, items);
  }

  async listChatBookEntries(sessionId: string, limit = 50): Promise<ChatBookEntry[]> {
    const items = this.store.chatBook.get(sessionId) ?? [];
    return items.slice(-limit);
  }

  async addPlannerDecision(decision: PlannerDecision): Promise<void> {
    const items = this.store.plannerDecisions.get(decision.session_id) ?? [];
    pushCapped(items, decision, CAPS.plannerDecisions);
    this.store.plannerDecisions.set(decision.session_id, items);
  }

  async listPlannerDecisions(sessionId: string, limit = 100): Promise<PlannerDecision[]> {
    const items = this.store.plannerDecisions.get(sessionId) ?? [];
    return items.slice(-limit);
  }

  async addPayloadPatchLog(log: PayloadPatchLog): Promise<void> {
    const items = this.store.payloadPatchLog.get(log.session_id) ?? [];
    pushCapped(items, log, CAPS.payloadPatchLog);
    this.store.payloadPatchLog.set(log.session_id, items);
  }

  async listPayloadPatchLogs(sessionId: string, limit = 100): Promise<PayloadPatchLog[]> {
    const items = this.store.payloadPatchLog.get(sessionId) ?? [];
    return items.slice(-limit);
  }

  async addToolActionLog(log: ToolActionLog): Promise<void> {
    const items = this.store.toolActionLog.get(log.session_id) ?? [];
    pushCapped(items, log, CAPS.toolActionLog);
    this.store.toolActionLog.set(log.session_id, items);
  }

  async listToolActionLogs(sessionId: string, limit = 200): Promise<ToolActionLog[]> {
    const items = this.store.toolActionLog.get(sessionId) ?? [];
    return items.slice(-limit);
  }

  async addCheckpointSnapshot(snapshot: CheckpointSnapshot): Promise<void> {
    const items = this.store.checkpointSnapshots.get(snapshot.session_id) ?? [];
    pushCapped(items, snapshot, CAPS.checkpointSnapshots);
    this.store.checkpointSnapshots.set(snapshot.session_id, items);
  }

  async listCheckpointSnapshots(sessionId: string, limit = 50): Promise<CheckpointSnapshot[]> {
    const items = this.store.checkpointSnapshots.get(sessionId) ?? [];
    return items.slice(-limit);
  }

  async getSessionTrace(sessionId: string, limit = 200): Promise<SessionTrace> {
    return {
      session_id: sessionId,
      planner_decisions: await this.listPlannerDecisions(sessionId, limit),
      tool_action_log: await this.listToolActionLogs(sessionId, limit),
      payload_patch_log: await this.listPayloadPatchLogs(sessionId, limit),
      checkpoint_snapshots: await this.listCheckpointSnapshots(sessionId, Math.min(limit, 50)),
    };
  }
}
