import { getPool, withDbTransaction } from "@/server/repo/db";
import {
  AskmoreV2Language,
  AskmoreV2PhaseProgressCallback,
  AskmoreV2TurnChoiceInput,
  AskmoreV2TurnResult,
} from "@/server/askmore_v2/types";
import { SessionRun } from "@/server/askmore_v2/runtime/session-run";

const IN_MEMORY_SESSION_QUEUE = new Map<string, Promise<unknown>>();

interface EnqueueTurnInput {
  sessionId: string;
  workspaceId?: string;
  userMessage: string;
  language: AskmoreV2Language;
  clientTurnId: string;
  choice?: AskmoreV2TurnChoiceInput;
  onPhaseProgress?: AskmoreV2PhaseProgressCallback;
}

function isStateVersionConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ASKMORE_V2_STATE_VERSION_CONFLICT");
}

export class SessionRuntimeManager {
  async enqueueTurn(input: EnqueueTurnInput): Promise<AskmoreV2TurnResult> {
    if (getPool()) {
      return this.runWithRetry(input);
    }
    return this.runSerializedInMemory(input);
  }

  private async runWithRetry(input: EnqueueTurnInput): Promise<AskmoreV2TurnResult> {
    let attempt = 0;
    while (attempt < 2) {
      attempt += 1;
      try {
        return await withDbTransaction(async () => {
          const run = new SessionRun(input);
          return run.executeTurn();
        });
      } catch (error) {
        if (attempt < 2 && isStateVersionConflict(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Unexpected runtime retry exhaustion");
  }

  private async runSerializedInMemory(input: EnqueueTurnInput): Promise<AskmoreV2TurnResult> {
    const previous = IN_MEMORY_SESSION_QUEUE.get(input.sessionId) ?? Promise.resolve();
    const current = previous.then(async () => {
      const run = new SessionRun(input);
      return run.executeTurn();
    });
    const chain = current.catch(() => undefined);

    IN_MEMORY_SESSION_QUEUE.set(input.sessionId, chain);

    try {
      return await current;
    } finally {
      const latest = IN_MEMORY_SESSION_QUEUE.get(input.sessionId);
      if (latest === chain) {
        IN_MEMORY_SESSION_QUEUE.delete(input.sessionId);
      }
    }
  }
}
