import { AskmoreV2InsightDomain } from "@/server/askmore_v2/types";

export type InsightPackType = "core" | "domain" | "subdomain" | "style" | "safety";

export interface InsightPackDefinition {
  id: string;
  type: InsightPackType;
  version: number;
  domain?: AskmoreV2InsightDomain;
  subdomain?: string;
  description: string;
  instructions: string[];
}

const PACKS: Record<string, InsightPackDefinition> = {
  "core.ai_thinking.v2": {
    id: "core.ai_thinking.v2",
    type: "core",
    version: 2,
    description: "Two-stage AI Thinking core with expert-style interpretation target.",
    instructions: [
      "Stage A reads provider intent and respondent state before writing.",
      "Stage B writes concrete expert interpretation, not checklist recap.",
      "Keep claims evidence-linked and confidence-calibrated.",
    ],
  },
  "business.general.v2": {
    id: "business.general.v2",
    type: "domain",
    version: 2,
    domain: "business",
    description: "Business intake expert lens (v2).",
    instructions: [],
  },
  "mental_health.intake.v2": {
    id: "mental_health.intake.v2",
    type: "domain",
    version: 2,
    domain: "mental_health",
    description: "Mental health intake expert lens (v2).",
    instructions: [],
  },
  "pet_clinic.general.v2": {
    id: "pet_clinic.general.v2",
    type: "domain",
    version: 2,
    domain: "pet_clinic",
    description: "Pet clinic intake expert lens (v2).",
    instructions: [],
  },
  "style.direct_advisor.v1": {
    id: "style.direct_advisor.v1",
    type: "style",
    version: 1,
    description: "Direct, concise advisor writing style.",
    instructions: [
      "Be direct and specific.",
      "Avoid empty motivational fillers.",
    ],
  },
  "style.warm_clinical.v1": {
    id: "style.warm_clinical.v1",
    type: "style",
    version: 1,
    description: "Warm, calm and clinically grounded writing style.",
    instructions: [
      "Keep tone warm but precise.",
      "Avoid judgmental phrasing.",
    ],
  },
  "style.pet_owner_reassuring.v1": {
    id: "style.pet_owner_reassuring.v1",
    type: "style",
    version: 1,
    description: "Warm, grounded veterinary communication with active emotional stabilization.",
    instructions: [
      "Keep medical clarity while actively stabilizing owner emotions.",
      "In each visible section, include one dedicated reassurance paragraph tied to evidence.",
      "Use supportive language, but always pair reassurance with clear watch/escalation thresholds.",
    ],
  },
  "safety.standard.v1": {
    id: "safety.standard.v1",
    type: "safety",
    version: 1,
    description: "Standard safety boundary.",
    instructions: [
      "Do not fabricate evidence.",
      "Do not state uncertain guesses as facts.",
    ],
  },
  "safety.healthcare.v1": {
    id: "safety.healthcare.v1",
    type: "safety",
    version: 1,
    description: "Healthcare safety boundary.",
    instructions: [
      "Do not diagnose or prescribe.",
      "Use directional guidance and clarification priorities.",
    ],
  },
};

export function getInsightPack(packId: string): InsightPackDefinition {
  const pack = PACKS[packId];
  if (!pack) throw new Error(`Unknown insight pack: ${packId}`);
  return pack;
}
