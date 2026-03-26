import { AskmoreV2PendingCommitment } from "@/server/askmore_v2/types";
import { RuntimeContextSnapshot } from "@/server/askmore_v2/runtime/context-engine";

export interface CoverageDecision {
  covered_count: number;
  required_count: number;
  remaining_count: number;
  must_covered_count: number;
  must_required_count: number;
  must_remaining_count: number;
  can_wrap_up: boolean;
  blocking_pending_commitments: AskmoreV2PendingCommitment[];
  prioritized_gap: RuntimeContextSnapshot["unresolved_gaps"][number] | null;
}

function isPendingCommitmentOpen(item: AskmoreV2PendingCommitment): boolean {
  return (item.status ?? "pending") === "pending";
}

export function evaluateCoveragePolicy(params: {
  covered: number;
  required: number;
  mustCovered: number;
  mustRequired: number;
  unresolvedGaps: RuntimeContextSnapshot["unresolved_gaps"];
  pendingCommitments: AskmoreV2PendingCommitment[];
}): CoverageDecision {
  const requiredCount = Math.max(1, params.required);
  const coveredCount = Math.max(0, Math.min(requiredCount, params.covered));
  const mustRequiredCount = Math.max(1, params.mustRequired);
  const mustCoveredCount = Math.max(0, Math.min(mustRequiredCount, params.mustCovered));
  const mustRemaining = Math.max(0, mustRequiredCount - mustCoveredCount);

  const blockingPendingCommitments = params.pendingCommitments.filter(isPendingCommitmentOpen);
  const prioritizedGap = [...params.unresolvedGaps].sort((a, b) => {
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    if (a.severity === b.severity) return 0;
    if (a.severity === "high") return -1;
    if (b.severity === "high") return 1;
    if (a.severity === "medium") return -1;
    if (b.severity === "medium") return 1;
    return 0;
  })[0] ?? null;

  return {
    covered_count: coveredCount,
    required_count: requiredCount,
    remaining_count: Math.max(0, requiredCount - coveredCount),
    must_covered_count: mustCoveredCount,
    must_required_count: mustRequiredCount,
    must_remaining_count: mustRemaining,
    can_wrap_up: mustRemaining === 0 && blockingPendingCommitments.length === 0,
    blocking_pending_commitments: blockingPendingCommitments,
    prioritized_gap: prioritizedGap,
  };
}
