import {
  AskmoreV2InternalEvent,
  AskmoreV2InteractionMode,
  AskmoreV2MicroConfirmOption,
  AskmoreV2RoutedIntent,
  AskmoreV2SessionState,
  AskmoreV2VisibleEvent,
} from "@/server/askmore_v2/types";

interface PresentationSemanticHints {
  reasoning_glimpse?: string;
  help_reframe?: string;
}

export interface PresentationDraftEvent {
  event_type: AskmoreV2VisibleEvent["event_type"];
  created_at: string;
  content_hint?: string;
  items?: string[];
  options?: AskmoreV2MicroConfirmOption[];
  dimension_id?: string;
  allow_free_text?: boolean;
  mode?: AskmoreV2InteractionMode;
  badge_label?: string;
  semantic_hints?: PresentationSemanticHints;
}

function firstContent(events: AskmoreV2InternalEvent[], eventType: AskmoreV2InternalEvent["event_type"]): string | undefined {
  return events.find((item) => item.event_type === eventType)?.payload.content?.trim();
}

function firstItems(events: AskmoreV2InternalEvent[], eventType: AskmoreV2InternalEvent["event_type"]): string[] {
  return events.find((item) => item.event_type === eventType)?.payload.items ?? [];
}

function firstMicroConfirm(events: AskmoreV2InternalEvent[]): AskmoreV2InternalEvent | null {
  return events.find((item) => item.event_type === "micro_confirm") ?? null;
}

function fallbackTransition(language: "zh" | "en"): string {
  return language === "zh"
    ? "我们继续一步一步来，我先确认下一个关键点。"
    : "Let's continue step by step. I will confirm the next key point.";
}

function fallbackGap(language: "zh" | "en"): string {
  return language === "zh"
    ? "我还差一两个关键信息，就能更稳地继续判断。"
    : "I still need one or two key details to continue with better confidence.";
}

function fallbackWhy(language: "zh" | "en"): string {
  return language === "zh"
    ? "这个补充很有价值，能帮助我更快缩小判断范围。"
    : "This update is useful and helps narrow the assessment.";
}

function clipHint(text: string | undefined, maxLen = 26): string | null {
  if (!text) return null;
  const normalized = text
    .replace(/还缺的关键点[:：]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  const firstPart = normalized.split(/[，。,；;！？!?、]/).find((item) => item.trim().length > 0)?.trim();
  if (!firstPart) return null;
  return firstPart.length <= maxLen ? firstPart : `${firstPart.slice(0, maxLen)}...`;
}

function buildReasoningGlimpse(params: {
  language: "zh" | "en";
  intent: AskmoreV2RoutedIntent["intent"];
  gapHint?: string | null;
}): string {
  if (params.language === "zh") {
    if (params.intent === "ask_for_help") {
      return "我先把问题拆小，是想让你先从最确定的一点开始说。";
    }
    if (params.intent === "clarify_meaning") {
      return "我先对齐这个点，是因为它会直接影响我后面往哪个方向继续判断。";
    }
    if (params.gapHint) {
      return `我先把「${params.gapHint}」确认清楚，这会直接影响我后面的判断方向。`;
    }
    return "我先把这个关键点问清楚，这样后面的判断会更稳。";
  }
  if (params.intent === "ask_for_help") {
    return "I am reframing this first so you can start from your most certain point.";
  }
  if (params.intent === "clarify_meaning") {
    return "I am aligning this first because it changes the direction of what I ask next.";
  }
  if (params.gapHint) {
    return `I want to confirm "${params.gapHint}" first because it changes the direction of my next assessment step.`;
  }
  return "I want to clarify this key point first so the next step stays grounded.";
}

function buildHelpReframe(params: {
  language: "zh" | "en";
  gapHint?: string | null;
}): string {
  if (params.language === "zh") {
    if (params.gapHint) {
      return `你不用一次答全，我们先从「${params.gapHint}」里你最确定的一点开始，再补一个小例子就够了。`;
    }
    return "你不用一次答全，我更需要你先说一个最确定的事实，再补一个具体小例子。";
  }
  if (params.gapHint) {
    return `You do not need to answer everything at once. Start with your most certain point about "${params.gapHint}", then add one concrete example.`;
  }
  return "You do not need a perfect answer. Start with one fact you are most sure about, then add one concrete example.";
}

export function selectPresentationDraftEvents(params: {
  debugEvents: AskmoreV2InternalEvent[];
  routedIntent: AskmoreV2RoutedIntent;
  state: AskmoreV2SessionState;
  language: "zh" | "en";
}): PresentationDraftEvent[] {
  const now = new Date().toISOString();
  const drafts: PresentationDraftEvent[] = [];
  const debugEvents = params.debugEvents;
  const gapHint = clipHint(firstContent(debugEvents, "gap_notice") ?? firstItems(debugEvents, "gap_notice")[0]);
  const reasoningGlimpse = buildReasoningGlimpse({
    language: params.language,
    intent: params.routedIntent.intent,
    gapHint,
  });

  const understanding = firstContent(debugEvents, "understanding_summary")
    ?? params.state.session.last_understanding_feedback
    ?? undefined;
  drafts.push({
    event_type: params.routedIntent.intent === "other_discussion" ? "acknowledgement" : "understanding",
    created_at: debugEvents[0]?.created_at ?? now,
    content_hint: understanding,
  });

  const hasCoverageSignal = Boolean(firstContent(debugEvents, "coverage_summary"));
  const hasStateSignal = Boolean(firstContent(debugEvents, "state_update"));
  if (hasCoverageSignal || hasStateSignal) {
    drafts.push({
      event_type: "why_this_matters",
      created_at: debugEvents[0]?.created_at ?? now,
      content_hint: fallbackWhy(params.language),
      semantic_hints: {
        reasoning_glimpse: reasoningGlimpse,
      },
    });
  }

  const transitionContent = firstContent(debugEvents, "transition_summary");
  const transitionImpliesCompletion = /(访谈完成|本次访谈完成|interview\s+is\s+finished|interview\s+completed|finished)/i.test(
    transitionContent ?? "",
  );
  const turnFinalized = Boolean(params.state.session.finalized) || transitionImpliesCompletion;

  if (params.routedIntent.intent === "ask_for_help") {
    drafts.push({
      event_type: "help_explanation",
      created_at: debugEvents[0]?.created_at ?? now,
      content_hint: firstContent(debugEvents, "help_explanation"),
      semantic_hints: {
        help_reframe: buildHelpReframe({
          language: params.language,
          gapHint,
        }),
      },
    });
    const examples = firstItems(debugEvents, "help_examples");
    if (examples.length > 0) {
      drafts.push({
        event_type: "help_examples",
        created_at: debugEvents[0]?.created_at ?? now,
        items: examples,
      });
    }
  } else {
    const micro = firstMicroConfirm(debugEvents);
    if (micro && !turnFinalized) {
      drafts.push({
        event_type: "micro_confirm",
        created_at: micro.created_at,
        content_hint: micro.payload.content,
        options: micro.payload.options,
        dimension_id: micro.payload.dimension_id,
        allow_free_text: micro.payload.allow_free_text,
        mode: micro.payload.mode ?? "micro_confirm",
        badge_label: micro.payload.badge_label ?? (params.language === "zh" ? "快速确认" : "Quick confirm"),
      });
    } else if (!turnFinalized) {
      drafts.push({
        event_type: "gentle_gap_prompt",
        created_at: debugEvents[0]?.created_at ?? now,
        content_hint: firstContent(debugEvents, "gap_notice") ?? fallbackGap(params.language),
      });
    }
  }

  const nextStepContent = firstContent(debugEvents, "next_question");
  const nextStepDebugEvent = debugEvents.find((item) => item.event_type === "next_question");
  drafts.push({
    event_type: "transition",
    created_at: debugEvents[debugEvents.length - 1]?.created_at ?? now,
    content_hint: transitionContent ?? fallbackTransition(params.language),
    semantic_hints: hasCoverageSignal
      ? {
          reasoning_glimpse: reasoningGlimpse,
        }
      : undefined,
  });
  if (nextStepContent && !turnFinalized) {
    const nextStepHasOptions = (nextStepDebugEvent?.payload.options ?? []).length > 0;
    drafts.push({
      event_type: "next_step",
      created_at: debugEvents[debugEvents.length - 1]?.created_at ?? now,
      content_hint: nextStepContent,
      options: nextStepDebugEvent?.payload.options,
      dimension_id: nextStepDebugEvent?.payload.dimension_id,
      allow_free_text: nextStepDebugEvent?.payload.allow_free_text,
      mode: nextStepDebugEvent?.payload.mode ?? (nextStepHasOptions ? "follow_up_select" : undefined),
      badge_label: nextStepDebugEvent?.payload.badge_label
        ?? (nextStepHasOptions ? (params.language === "zh" ? "普通追问" : "Follow-up") : undefined),
    });
  }

  const prioritizedOrder: AskmoreV2VisibleEvent["event_type"][] = [
    "understanding",
    "acknowledgement",
    "why_this_matters",
    "help_explanation",
    "help_examples",
    "gentle_gap_prompt",
    "micro_confirm",
    "transition",
    "next_step",
  ];

  const unique: PresentationDraftEvent[] = [];
  for (const eventType of prioritizedOrder) {
    const found = drafts.find((item) => item.event_type === eventType);
    if (!found) continue;
    unique.push(found);
  }

  let limited = unique.slice(0, 4);
  const hasNextStep = unique.some((item) => item.event_type === "next_step");
  if (hasNextStep && !limited.some((item) => item.event_type === "next_step")) {
    const nextStep = unique.find((item) => item.event_type === "next_step");
    if (nextStep) {
      const replaceIdx = limited.findIndex((item) => item.event_type === "why_this_matters");
      if (replaceIdx >= 0) {
        limited[replaceIdx] = nextStep;
      } else if (limited.length >= 4) {
        limited[limited.length - 1] = nextStep;
      } else {
        limited.push(nextStep);
      }
    }
  }
  if (limited.length >= 2) return limited;
  const fallback = unique.find((item) => item.event_type === "transition");
  if (fallback) return [...limited, fallback].slice(0, 4);
  return limited;
}
