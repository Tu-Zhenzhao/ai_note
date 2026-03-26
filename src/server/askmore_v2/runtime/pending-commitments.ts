import { randomUUID } from "crypto";
import { AskmoreV2PendingCommitment, AskmoreV2SessionState } from "@/server/askmore_v2/types";
import { ensureRuntimeStateDefaults } from "@/server/askmore_v2/runtime/context-engine";

const DEFAULT_COMMITMENT_TTL_TURNS = 4;

function isPending(item: AskmoreV2PendingCommitment): boolean {
  return (item.status ?? "pending") === "pending";
}

function toTime(nowIso: string): number {
  return new Date(nowIso).getTime();
}

export function createPendingCommitment(params: {
  state: AskmoreV2SessionState;
  type: AskmoreV2PendingCommitment["type"];
  questionId: string | null;
  dimensionId?: string | null;
  note?: string | null;
  now: string;
  turnIndex: number;
  ttlTurns?: number;
}): AskmoreV2PendingCommitment {
  ensureRuntimeStateDefaults(params.state);

  const ttlTurns = params.ttlTurns ?? DEFAULT_COMMITMENT_TTL_TURNS;
  const expiresAt = new Date(toTime(params.now) + ttlTurns * 60_000).toISOString();
  const commitment: AskmoreV2PendingCommitment = {
    id: randomUUID(),
    type: params.type,
    status: "pending",
    question_id: params.questionId,
    dimension_id: params.dimensionId ?? null,
    note: params.note ?? null,
    created_at: params.now,
    expires_at: expiresAt,
    resolved_at: null,
    expired_at: null,
    resolution_note: null,
    resolved_turn_index: null,
  };

  params.state.session.pending_commitments = [
    ...(params.state.session.pending_commitments ?? []),
    commitment,
  ];

  return commitment;
}

export function resolvePendingCommitments(params: {
  state: AskmoreV2SessionState;
  now: string;
  turnIndex: number;
  questionId?: string | null;
  dimensionId?: string | null;
  reason: string;
}): number {
  ensureRuntimeStateDefaults(params.state);
  let resolved = 0;

  params.state.session.pending_commitments = (params.state.session.pending_commitments ?? []).map((item) => {
    if (!isPending(item)) return item;
    if (params.questionId && item.question_id !== params.questionId) return item;
    if (params.dimensionId && item.dimension_id !== params.dimensionId) return item;

    resolved += 1;
    return {
      ...item,
      status: "resolved",
      resolved_at: params.now,
      resolution_note: params.reason,
      resolved_turn_index: params.turnIndex,
    };
  });

  return resolved;
}

export function expirePendingCommitments(params: {
  state: AskmoreV2SessionState;
  now: string;
  turnIndex: number;
  activeQuestionId: string | null;
}): AskmoreV2PendingCommitment[] {
  ensureRuntimeStateDefaults(params.state);
  const expired: AskmoreV2PendingCommitment[] = [];
  const nowTs = toTime(params.now);

  params.state.session.pending_commitments = (params.state.session.pending_commitments ?? []).map((item) => {
    if (!isPending(item)) return item;

    const byQuestionSwitch = Boolean(item.question_id) && item.question_id !== params.activeQuestionId;
    const byTime = Boolean(item.expires_at) && toTime(item.expires_at!) <= nowTs;

    if (!byQuestionSwitch && !byTime) return item;

    const next: AskmoreV2PendingCommitment = {
      ...item,
      status: "expired",
      expired_at: params.now,
      resolution_note: byQuestionSwitch ? "question_switched" : "ttl_expired",
      resolved_turn_index: params.turnIndex,
    };
    expired.push(next);
    return next;
  });

  return expired;
}

export function getOpenCommitments(params: {
  state: AskmoreV2SessionState;
  questionId?: string | null;
  type?: AskmoreV2PendingCommitment["type"];
}): AskmoreV2PendingCommitment[] {
  ensureRuntimeStateDefaults(params.state);
  return (params.state.session.pending_commitments ?? []).filter((item) => {
    if (!isPending(item)) return false;
    if (params.questionId && item.question_id !== params.questionId) return false;
    if (params.type && item.type !== params.type) return false;
    return true;
  });
}
