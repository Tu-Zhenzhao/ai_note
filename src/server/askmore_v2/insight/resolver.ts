import {
  AskmoreV2InsightDomain,
  AskmoreV2InsightPackConfig,
  AskmoreV2InsightPackTrace,
} from "@/server/askmore_v2/types";
import { getInsightPack } from "@/server/askmore_v2/insight/pack-registry";

export interface InsightResolvedConfig {
  domain: AskmoreV2InsightDomain;
  subdomain: string;
  packTrace: AskmoreV2InsightPackTrace;
}

const HEALTHCARE_DOMAINS = new Set<AskmoreV2InsightDomain>(["mental_health", "pet_clinic"]);

function detectDomainFromText(text: string): AskmoreV2InsightDomain {
  const value = text.toLowerCase();
  if (/(心理|情绪|焦虑|抑郁|mental|therapy|counsel|counselling)/i.test(value)) return "mental_health";
  if (/(宠物|猫|狗|pet|vet|veterinary|clinic|乱尿|舔毛)/i.test(value)) return "pet_clinic";
  return "business";
}

export function inferInsightDomain(params: {
  scenario: string;
  targetOutputType: string;
  structuredKnowledgeText: string;
}): AskmoreV2InsightDomain {
  const joined = `${params.scenario}\n${params.targetOutputType}\n${params.structuredKnowledgeText}`;
  return detectDomainFromText(joined);
}

export function inferInsightSubdomain(params: {
  domain: AskmoreV2InsightDomain;
  scenario: string;
  targetOutputType: string;
}): string {
  const text = `${params.scenario}\n${params.targetOutputType}`.toLowerCase();
  if (params.domain === "business") {
    if (/(competition|competitor|竞争)/i.test(text)) return "competition";
    if (/(position|定位)/i.test(text)) return "positioning";
    return "general_strategy";
  }
  if (params.domain === "mental_health") return "intake";
  return "general";
}

export function resolveInsightPacks(params: {
  domain: AskmoreV2InsightDomain;
  subdomain: string;
  packConfig?: AskmoreV2InsightPackConfig;
}): InsightResolvedConfig {
  const defaultDomainPack: Record<AskmoreV2InsightDomain, string> = {
    business: "business.general.v2",
    mental_health: "mental_health.intake.v2",
    pet_clinic: "pet_clinic.general.v2",
  };

  const defaultStylePack: Record<AskmoreV2InsightDomain, string> = {
    business: "style.direct_advisor.v1",
    mental_health: "style.warm_clinical.v1",
    pet_clinic: "style.warm_clinical.v1",
  };

  const defaultSafetyPack: Record<AskmoreV2InsightDomain, string> = {
    business: "safety.standard.v1",
    mental_health: "safety.healthcare.v1",
    pet_clinic: "safety.healthcare.v1",
  };

  const corePack = params.packConfig?.corePack ?? "core.ai_thinking.v2";
  const domainPack = params.packConfig?.domainPack ?? defaultDomainPack[params.domain];
  const subdomainPacks = params.packConfig?.subdomainPacks ?? [];
  const stylePack = params.packConfig?.stylePack ?? defaultStylePack[params.domain];

  let safetyPack = params.packConfig?.safetyPack ?? defaultSafetyPack[params.domain];
  if (HEALTHCARE_DOMAINS.has(params.domain)) {
    safetyPack = "safety.healthcare.v1";
  }

  getInsightPack(corePack);
  getInsightPack(domainPack);
  for (const packId of subdomainPacks) getInsightPack(packId);
  getInsightPack(stylePack);
  getInsightPack(safetyPack);

  const packTrace: AskmoreV2InsightPackTrace = {
    core_pack: corePack,
    domain_pack: domainPack,
    subdomain_packs: subdomainPacks,
    style_pack: stylePack,
    safety_pack: safetyPack,
  };

  return {
    domain: params.domain,
    subdomain: params.subdomain,
    packTrace,
  };
}
