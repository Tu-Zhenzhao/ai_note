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
import { InterviewRepository, InterviewStateRecord } from "@/server/repo/contracts";

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

export class MemoryInterviewRepository implements InterviewRepository {
  private readonly store = getStore();

  async getSession(sessionId: string): Promise<InterviewSession | null> {
    return this.store.sessions.get(sessionId) ?? null;
  }

  async createSession(session: InterviewSession): Promise<void> {
    this.store.sessions.set(session.id, session);
  }

  async upsertSession(session: InterviewSession): Promise<void> {
    this.store.sessions.set(session.id, session);
  }

  async getState(sessionId: string): Promise<InterviewStateRecord | null> {
    return this.store.states.get(sessionId) ?? null;
  }

  async upsertState(record: InterviewStateRecord): Promise<void> {
    this.store.states.set(record.session_id, record);
  }

  async listMessages(sessionId: string): Promise<InterviewMessage[]> {
    return this.store.messages.get(sessionId) ?? [];
  }

  async addMessage(message: InterviewMessage): Promise<void> {
    const items = this.store.messages.get(message.session_id) ?? [];
    items.push(message);
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
    items.push(entry);
    this.store.chatBook.set(entry.session_id, items);
  }

  async listChatBookEntries(sessionId: string, limit = 50): Promise<ChatBookEntry[]> {
    const items = this.store.chatBook.get(sessionId) ?? [];
    return items.slice(-limit);
  }

  async addPlannerDecision(decision: PlannerDecision): Promise<void> {
    const items = this.store.plannerDecisions.get(decision.session_id) ?? [];
    items.push(decision);
    this.store.plannerDecisions.set(decision.session_id, items);
  }

  async listPlannerDecisions(sessionId: string, limit = 100): Promise<PlannerDecision[]> {
    const items = this.store.plannerDecisions.get(sessionId) ?? [];
    return items.slice(-limit);
  }

  async addPayloadPatchLog(log: PayloadPatchLog): Promise<void> {
    const items = this.store.payloadPatchLog.get(log.session_id) ?? [];
    items.push(log);
    this.store.payloadPatchLog.set(log.session_id, items);
  }

  async listPayloadPatchLogs(sessionId: string, limit = 100): Promise<PayloadPatchLog[]> {
    const items = this.store.payloadPatchLog.get(sessionId) ?? [];
    return items.slice(-limit);
  }

  async addToolActionLog(log: ToolActionLog): Promise<void> {
    const items = this.store.toolActionLog.get(log.session_id) ?? [];
    items.push(log);
    this.store.toolActionLog.set(log.session_id, items);
  }

  async listToolActionLogs(sessionId: string, limit = 200): Promise<ToolActionLog[]> {
    const items = this.store.toolActionLog.get(sessionId) ?? [];
    return items.slice(-limit);
  }

  async addCheckpointSnapshot(snapshot: CheckpointSnapshot): Promise<void> {
    const items = this.store.checkpointSnapshots.get(snapshot.session_id) ?? [];
    items.push(snapshot);
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
