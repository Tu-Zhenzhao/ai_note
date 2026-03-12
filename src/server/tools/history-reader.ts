import { InterviewMessage, ToolActionLog, InterviewState } from "@/lib/types";
import { InterviewRepository } from "@/server/repo/contracts";
import { recallChatBook, recallUnresolvedConflicts, RecalledMemory } from "@/server/planner/retrieval";
import { recordToolTrace } from "@/server/tools/trace";

export interface HistoryReadResult {
  messages: InterviewMessage[];
  recalled_memories: RecalledMemory[];
  unresolved_conflicts: ReturnType<typeof recallUnresolvedConflicts>;
  toolLog: ToolActionLog;
}

export async function getHistoryContext(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  query: string;
  state: InterviewState;
  limit?: number;
}): Promise<HistoryReadResult> {
  const messages = await params.repo.listMessages(params.sessionId);
  const recalledMemories = await recallChatBook({
    repo: params.repo,
    sessionId: params.sessionId,
    query: params.query,
    limit: params.limit ?? 8,
  });
  const unresolvedConflicts = recallUnresolvedConflicts(params.state.system_assessment.pending_conflicts ?? []);

  const toolLog = await recordToolTrace({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "history_reader",
    input: {
      query: params.query,
      limit: params.limit ?? 8,
    },
    output: {
      messages_count: messages.length,
      recalled_memories_count: recalledMemories.length,
      unresolved_conflicts_count: unresolvedConflicts.length,
    },
    success: true,
  });

  return {
    messages,
    recalled_memories: recalledMemories,
    unresolved_conflicts: unresolvedConflicts,
    toolLog,
  };
}
