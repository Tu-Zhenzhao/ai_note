import { selectPresentationDraftEvents } from "@/server/askmore_v2/presentation/event-selection";
import { phrasePresentationEvents } from "@/server/askmore_v2/presentation/phrasing-helper";
import { resolveToneProfile } from "@/server/askmore_v2/presentation/tone-profiles";
import {
  resolveReasoningProfile,
  resolveSafeExplanationBoundary,
} from "@/server/askmore_v2/presentation/reasoning-profiles";
import {
  AskmoreV2InternalEvent,
  AskmoreV2RoutedIntent,
  AskmoreV2SessionState,
  AskmoreV2VisibleEvent,
} from "@/server/askmore_v2/types";

function trimVisibleEvents(events: AskmoreV2VisibleEvent[]): AskmoreV2VisibleEvent[] {
  const filtered = events.filter((event) => event.visible !== false);
  if (filtered.length <= 4) return filtered;
  return filtered.slice(0, 4);
}

export async function buildVisibleEvents(params: {
  debugEvents: AskmoreV2InternalEvent[];
  routedIntent: AskmoreV2RoutedIntent;
  state: AskmoreV2SessionState;
  language: "zh" | "en";
  scenario?: string | null;
  targetOutputType?: string | null;
  transitionReason?: string | null;
  latestUserTurn: string;
}): Promise<AskmoreV2VisibleEvent[]> {
  const drafts = selectPresentationDraftEvents({
    debugEvents: params.debugEvents,
    routedIntent: params.routedIntent,
    state: params.state,
    language: params.language,
    transitionReason: params.transitionReason,
    scenario: params.scenario,
    targetOutputType: params.targetOutputType,
  });
  const toneProfile = resolveToneProfile({
    scenario: params.scenario ?? null,
    targetOutputType: params.targetOutputType ?? null,
  });
  const reasoningProfile = resolveReasoningProfile({
    scenario: params.scenario ?? null,
    targetOutputType: params.targetOutputType ?? null,
  });
  const safeBoundary = resolveSafeExplanationBoundary({
    scenario: params.scenario ?? null,
    targetOutputType: params.targetOutputType ?? null,
  });
  const activeQuestionId = params.state.session.current_question_id;
  const activeNode = activeQuestionId ? params.state.nodes?.[activeQuestionId] : null;
  const activeQuestionText = activeNode?.user_facing_entry ?? "";
  const gapHints = params.debugEvents
    .filter((event) => event.event_type === "gap_notice")
    .map((event) => event.payload.content?.trim() ?? "")
    .filter((item) => item.length > 0);
  const phrased = await phrasePresentationEvents({
    language: params.language,
    toneProfile,
    reasoningProfile,
    safeBoundary,
    routedIntent: params.routedIntent,
    latestUserTurn: params.latestUserTurn,
    activeQuestionText,
    gapHints,
    drafts,
  });
  return trimVisibleEvents(phrased);
}
