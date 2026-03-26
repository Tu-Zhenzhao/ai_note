import {
  AskmoreV2InternalEventType,
  AskmoreV2PresentationEventType,
} from "@/server/askmore_v2/types";

export const ASKMORE_V2_INTERNAL_EVENT_TYPES: AskmoreV2InternalEventType[] = [
  "understanding_summary",
  "state_update",
  "coverage_summary",
  "gap_notice",
  "help_explanation",
  "help_examples",
  "micro_confirm",
  "transition_summary",
  "next_question",
];

export const ASKMORE_V2_VISIBLE_EVENT_TYPES: AskmoreV2PresentationEventType[] = [
  "understanding",
  "acknowledgement",
  "why_this_matters",
  "gentle_gap_prompt",
  "help_explanation",
  "help_examples",
  "micro_confirm",
  "transition",
  "next_step",
];

export function isAskmoreV2InternalEventType(value: string): value is AskmoreV2InternalEventType {
  return ASKMORE_V2_INTERNAL_EVENT_TYPES.includes(value as AskmoreV2InternalEventType);
}

export function isAskmoreV2VisibleEventType(value: string): value is AskmoreV2PresentationEventType {
  return ASKMORE_V2_VISIBLE_EVENT_TYPES.includes(value as AskmoreV2PresentationEventType);
}
