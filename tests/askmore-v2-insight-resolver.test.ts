import { describe, expect, test } from "vitest";
import { inferInsightDomain, inferInsightSubdomain, resolveInsightPacks } from "@/server/askmore_v2/insight/resolver";

describe("askmore v2 insight resolver", () => {
  test("detects business domain by default", () => {
    const domain = inferInsightDomain({
      scenario: "咨询 intake",
      targetOutputType: "结构化总结报告",
      structuredKnowledgeText: "用户提到增长、竞争和资源分配",
    });
    expect(domain).toBe("business");
  });

  test("detects mental health and enforces healthcare safety pack", () => {
    const domain = inferInsightDomain({
      scenario: "心理咨询 intake",
      targetOutputType: "阶段性建议",
      structuredKnowledgeText: "最近焦虑和情绪波动明显",
    });
    expect(domain).toBe("mental_health");

    const resolved = resolveInsightPacks({
      domain,
      subdomain: inferInsightSubdomain({
        domain,
        scenario: "心理咨询 intake",
        targetOutputType: "阶段性建议",
      }),
      packConfig: {
        safetyPack: "safety.standard.v1",
      },
    });
    expect(resolved.packTrace.safety_pack).toBe("safety.healthcare.v1");
  });

  test("keeps deterministic pack order and subdomain enhancement", () => {
    const resolved = resolveInsightPacks({
      domain: "business",
      subdomain: "competition",
    });

    expect(resolved.packTrace.core_pack).toBe("core.ai_thinking.v2");
    expect(resolved.packTrace.domain_pack).toBe("business.general.v2");
    expect(resolved.packTrace.subdomain_packs).toEqual([]);
    expect(resolved.packTrace.style_pack).toBe("style.direct_advisor.v1");
    expect(resolved.packTrace.safety_pack).toBe("safety.standard.v1");
  });
});
