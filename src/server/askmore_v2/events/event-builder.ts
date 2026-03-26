import { randomUUID } from "crypto";
import {
  AskmoreV2MicroConfirmOption,
  AskmoreV2ResponseBlock,
  AskmoreV2RoutedIntent,
  AskmoreV2VisibleEvent,
  AskmoreV2InteractionMode,
} from "@/server/askmore_v2/types";

interface LegacyTurnOutput {
  understanding_feedback?: string;
  response_blocks?: AskmoreV2ResponseBlock[];
  summary_patch?: Record<string, unknown>;
  node_progress?: { covered: number; required: number; remaining: number } | null;
  missing_points?: string[];
  next_question?: string | null;
  node_summary?: string | null;
  planner_action?: string;
}

function pushVisibleEvent(
  target: AskmoreV2VisibleEvent[],
  params: {
    event_type: AskmoreV2VisibleEvent["event_type"];
    created_at: string;
    content?: string;
    items?: string[];
    options?: AskmoreV2MicroConfirmOption[];
    dimension_id?: string;
    allow_free_text?: boolean;
    mode?: AskmoreV2InteractionMode;
    badge_label?: string;
  },
) {
  target.push({
    event_id: randomUUID(),
    event_type: params.event_type,
    created_at: params.created_at,
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
  });
}

function hasEvent(events: AskmoreV2VisibleEvent[], eventType: AskmoreV2VisibleEvent["event_type"]): boolean {
  return events.some((item) => item.event_type === eventType);
}

function mapResponseBlockToVisibleEvent(block: AskmoreV2ResponseBlock, createdAt: string): AskmoreV2VisibleEvent | null {
  if (block.type === "understanding") {
    return {
      event_id: randomUUID(),
      event_type: "understanding",
      created_at: createdAt,
      visible: true,
      payload: { content: block.content },
    };
  }
  if (block.type === "progress") {
    return {
      event_id: randomUUID(),
      event_type: "gentle_gap_prompt",
      created_at: createdAt,
      visible: true,
      payload: { content: block.content },
    };
  }
  if (block.type === "next_question") {
    return {
      event_id: randomUUID(),
      event_type: "next_step",
      created_at: createdAt,
      visible: true,
      payload: {
        content: block.content,
        options: block.options,
        dimension_id: block.dimension_id,
        allow_free_text: block.allow_free_text,
        mode: block.mode,
        badge_label: block.badge_label,
      },
    };
  }
  if (block.type === "example_answers") {
    return {
      event_id: randomUUID(),
      event_type: "help_examples",
      created_at: createdAt,
      visible: true,
      payload: { items: block.items ?? [] },
    };
  }
  if (block.type === "micro_confirmation" || block.type === "micro_confirm_options") {
    return {
      event_id: randomUUID(),
      event_type: "micro_confirm",
      created_at: createdAt,
      visible: true,
      payload: {
        content: block.content,
        options: block.options,
        dimension_id: block.dimension_id,
        allow_free_text: block.allow_free_text,
        mode: block.mode,
        badge_label: block.badge_label,
      },
    };
  }
  if (block.type === "node_summary") {
    return {
      event_id: randomUUID(),
      event_type: "transition",
      created_at: createdAt,
      visible: true,
      payload: { content: block.content },
    };
  }
  return null;
}

function intentHelpLine(intent: AskmoreV2RoutedIntent["intent"], language: "en" | "zh"): string | null {
  if (intent !== "ask_for_help") return null;
  if (language === "zh") {
    return "我先把这题拆成更容易回答的角度，再给你可直接参考的示例。";
  }
  return "I will break this question into easier angles and give examples you can directly use.";
}

// Legacy compatibility path only.
export function buildVisibleEventsFromLegacy(params: {
  legacy: LegacyTurnOutput;
  routedIntent: AskmoreV2RoutedIntent;
  language: "en" | "zh";
  createdAt: string;
}): AskmoreV2VisibleEvent[] {
  const events: AskmoreV2VisibleEvent[] = [];

  for (const block of params.legacy.response_blocks ?? []) {
    const mapped = mapResponseBlockToVisibleEvent(block, params.createdAt);
    if (mapped) events.push(mapped);
  }

  if (!hasEvent(events, "understanding") && params.legacy.understanding_feedback) {
    pushVisibleEvent(events, {
      event_type: "understanding",
      created_at: params.createdAt,
      content: params.legacy.understanding_feedback,
    });
  }

  const helpLine = intentHelpLine(params.routedIntent.intent, params.language);
  if (helpLine && !hasEvent(events, "help_explanation")) {
    pushVisibleEvent(events, {
      event_type: "help_explanation",
      created_at: params.createdAt,
      content: helpLine,
    });
  }

  if (!hasEvent(events, "transition") && params.legacy.node_summary) {
    pushVisibleEvent(events, {
      event_type: "transition",
      created_at: params.createdAt,
      content: params.legacy.node_summary,
    });
  }

  if (!hasEvent(events, "next_step") && params.legacy.next_question) {
    pushVisibleEvent(events, {
      event_type: "next_step",
      created_at: params.createdAt,
      content: params.legacy.next_question,
    });
  }

  return events.slice(0, 4);
}

export function eventsToResponseBlocks(events: AskmoreV2VisibleEvent[]): AskmoreV2ResponseBlock[] {
  // Compatibility-only projection: this function is the single allowed bridge from event-first payload
  // to legacy response blocks. Do not add business-only semantics that are absent from events.
  const blocks: AskmoreV2ResponseBlock[] = [];

  for (const event of events) {
    if (event.event_type === "understanding" || event.event_type === "acknowledgement" || event.event_type === "why_this_matters") {
      if (event.payload.content) blocks.push({ type: "understanding", content: event.payload.content });
      continue;
    }
    if (event.event_type === "help_explanation" || event.event_type === "gentle_gap_prompt") {
      if (event.payload.content) blocks.push({ type: "understanding", content: event.payload.content });
      continue;
    }
    if (event.event_type === "help_examples") {
      if ((event.payload.items ?? []).length > 0) {
        blocks.push({ type: "example_answers", items: event.payload.items });
      }
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
          mode: event.payload.mode,
          badge_label: event.payload.badge_label,
          source_event_id: event.event_id,
        });
      } else if (event.payload.content) {
        blocks.push({ type: "micro_confirmation", content: event.payload.content });
      }
      continue;
    }
    if (event.event_type === "transition") {
      if (event.payload.content) blocks.push({ type: "node_summary", content: event.payload.content });
      continue;
    }
    if (event.event_type === "next_step") {
      if ((event.payload.options ?? []).length > 0) {
        blocks.push({
          type: "micro_confirm_options",
          content: event.payload.content,
          options: event.payload.options,
          dimension_id: event.payload.dimension_id,
          allow_free_text: event.payload.allow_free_text,
          mode: event.payload.mode,
          badge_label: event.payload.badge_label,
          source_event_id: event.event_id,
        });
      } else if (event.payload.content) {
        blocks.push({ type: "next_question", content: event.payload.content });
      }
      continue;
    }
  }

  return blocks;
}

export function composeAssistantMessageFromEvents(events: AskmoreV2VisibleEvent[]): string {
  const blocks = eventsToResponseBlocks(events);
  const lines: string[] = [];

  for (const block of blocks) {
    if (block.type === "example_answers") {
      if (!block.items || block.items.length === 0) continue;
      lines.push("你可以这样回答：");
      for (const item of block.items.slice(0, 4)) {
        lines.push(`- ${item}`);
      }
      continue;
    }

    if (block.type === "micro_confirm_options") {
      if (!block.options || block.options.length === 0) continue;
      if (block.content) lines.push(block.content);
      for (const option of block.options.slice(0, 4)) {
        lines.push(`- ${option.option_id}. ${option.label}`);
      }
      continue;
    }

    if (block.content?.trim()) lines.push(block.content.trim());
  }

  return lines.join("\n\n").trim();
}
