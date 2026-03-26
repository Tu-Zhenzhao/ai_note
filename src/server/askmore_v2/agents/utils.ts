import { randomUUID } from "crypto";
import {
  AskmoreV2InternalEvent,
  AskmoreV2ResponseBlock,
  AskmoreV2SessionState,
} from "@/server/askmore_v2/types";
import { AgentRunInput } from "@/server/askmore_v2/agents/contracts";

export function cloneRuntimeState(state: AskmoreV2SessionState): AskmoreV2SessionState {
  return JSON.parse(JSON.stringify(state)) as AskmoreV2SessionState;
}

export function emitVisibleEvent(params: {
  event_type: AskmoreV2InternalEvent["event_type"];
  content?: string;
  items?: string[];
  options?: AskmoreV2InternalEvent["payload"]["options"];
  dimension_id?: string;
  allow_free_text?: boolean;
  mode?: AskmoreV2InternalEvent["payload"]["mode"];
  badge_label?: string;
  created_at?: string;
}): AskmoreV2InternalEvent {
  return {
    event_id: randomUUID(),
    event_type: params.event_type,
    created_at: params.created_at ?? new Date().toISOString(),
    visible: true,
    payload: {
      content: params.content,
      items: params.items,
      options: params.options,
      dimension_id: params.dimension_id,
      allow_free_text: params.allow_free_text,
      mode: params.mode,
      badge_label: params.badge_label,
    },
  };
}

export function inferCurrentQuestionText(input: AgentRunInput): string | null {
  return input.context.active_question.node?.user_facing_entry
    ?? input.context.active_question.question?.entry_question
    ?? null;
}

export function toLegacyBlocks(events: AskmoreV2InternalEvent[]): AskmoreV2ResponseBlock[] {
  const blocks: AskmoreV2ResponseBlock[] = [];
  for (const event of events) {
    if (event.event_type === "understanding_summary" || event.event_type === "help_explanation") {
      if (event.payload.content) blocks.push({ type: "understanding", content: event.payload.content });
      continue;
    }
    if (event.event_type === "state_update" || event.event_type === "coverage_summary" || event.event_type === "gap_notice") {
      if (event.payload.content) blocks.push({ type: "progress", content: event.payload.content });
      continue;
    }
    if (event.event_type === "help_examples" && (event.payload.items ?? []).length > 0) {
      blocks.push({ type: "example_answers", items: event.payload.items });
      continue;
    }
    if (event.event_type === "micro_confirm") {
      if ((event.payload.options ?? []).length > 0) {
        blocks.push({
          type: "micro_confirm_options",
          content: event.payload.content,
          options: event.payload.options,
          dimension_id: event.payload.dimension_id,
          allow_free_text: event.payload.allow_free_text,
        });
      } else if (event.payload.content) {
        blocks.push({ type: "micro_confirmation", content: event.payload.content });
      }
      continue;
    }
    if (event.event_type === "transition_summary" && event.payload.content) {
      blocks.push({ type: "node_summary", content: event.payload.content });
      continue;
    }
    if (event.event_type === "next_question" && event.payload.content) {
      blocks.push({ type: "next_question", content: event.payload.content });
    }
  }
  return blocks;
}
