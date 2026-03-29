import { z } from "zod";
import { randomUUID } from "crypto";
import { generateModelObject } from "@/server/model/adapters";
import {
  askmoreV2PresentationPhrasingPrompt,
  askmoreV2PresentationPromptPack,
} from "@/server/askmore_v2/prompts";
import { AskmoreV2RoutedIntent, AskmoreV2VisibleEvent } from "@/server/askmore_v2/types";
import { PresentationDraftEvent } from "@/server/askmore_v2/presentation/event-selection";
import { buildCompletionClosureText } from "@/server/askmore_v2/completion-closure";
import { AskmoreV2ToneProfile, toneInstruction } from "@/server/askmore_v2/presentation/tone-profiles";
import {
  AskmoreV2ReasoningProfile,
  AskmoreV2SafeExplanationBoundary,
  boundaryInstruction,
  reasoningInstruction,
} from "@/server/askmore_v2/presentation/reasoning-profiles";

const schema = z.object({
  blocks: z.array(z.object({
    index: z.number().int().min(0).max(10),
    text: z.string().min(1).max(280),
  })).max(8),
});

const INTERNAL_TERMS = /(coverage|ratio|field|route|policy|state|id|字段|覆盖|路由|策略|state_dump|key=value|q\d+__)/i;
const DEFINITIVE_TERMS = /(确诊|基本可以确定|一定是|肯定是|必然是|definitely|certainly|diagnosed)/i;
const VAGUE_IMPORTANCE = /(很关键|很重要|值得重视|非常关键|important|critical)/i;
const REASON_WORDS = /(因为|会让|所以|影响|用于|帮助|这样|means|because|so that|which helps)/i;

const ZH_STOPWORDS = new Set([
  "这个", "那个", "这里", "那里", "问题", "情况", "一下", "可以", "需要", "我们", "你们", "他们", "是否", "什么",
  "怎么", "然后", "继续", "确认", "描述", "用户", "目前", "最近", "一个", "两个", "这样", "那样", "对于", "关于", "猫咪",
]);
const EN_STOPWORDS = new Set([
  "this", "that", "with", "from", "your", "into", "about", "have", "will", "what", "when", "where", "which", "there",
  "then", "just", "more", "some", "into", "because", "please", "answer", "question",
]);

function stripInternalArtifacts(text: string): string {
  return text
    .replace(/当前(关键)?覆盖[:：]\s*\d+\s*\/\s*\d+\.?/gi, "")
    .replace(/已记录[:：]\s*/gi, "")
    .replace(/还缺的关键点[:：]\s*/gi, "")
    .replace(/\b(q\d+__[\w-]+)\b/g, "")
    .replace(/([^\s=：:]{2,})=/g, "$1：")
    .replace(/\s+/g, " ")
    .trim();
}

function countSentences(text: string): number {
  const fragments = text.split(/[。！？!?;；\n]/).map((item) => item.trim()).filter(Boolean);
  return fragments.length === 0 ? 1 : fragments.length;
}

function hasFirstPerson(text: string, language: "zh" | "en"): boolean {
  if (language === "zh") return text.includes("我");
  return /\bI\b/i.test(text);
}

function hasVagueImportanceWithoutReason(text: string): boolean {
  return VAGUE_IMPORTANCE.test(text) && !REASON_WORDS.test(text);
}

function extractOpening(text: string, language: "zh" | "en"): string {
  const cleaned = text.trim();
  if (!cleaned) return "";
  if (language === "zh") return cleaned.slice(0, Math.min(cleaned.length, 8));
  return cleaned.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
}

function containsInternalTerms(text: string): boolean {
  return INTERNAL_TERMS.test(text) || /[A-Za-z0-9_]{2,}\s*=\s*[^\s]/.test(text);
}

function containsBoundaryViolation(text: string): boolean {
  return DEFINITIVE_TERMS.test(text);
}

function normalizeOutput(text: string): string {
  return stripInternalArtifacts(text).replace(/\s+/g, " ").trim();
}

function extractSemanticTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = text.toLowerCase();

  const enMatches = normalized.match(/[a-z]{3,}/g) ?? [];
  for (const token of enMatches) {
    if (EN_STOPWORDS.has(token)) continue;
    tokens.add(token);
  }

  const zhRuns = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const run of zhRuns) {
    const phrase = run.trim();
    if (phrase.length >= 2 && phrase.length <= 8 && !ZH_STOPWORDS.has(phrase)) {
      tokens.add(phrase);
    }
    for (let i = 0; i < phrase.length - 1; i += 1) {
      const bi = phrase.slice(i, i + 2);
      if (!ZH_STOPWORDS.has(bi)) tokens.add(bi);
    }
  }
  return tokens;
}

function validateHelpExamples(params: {
  items: string[];
  activeQuestionText: string;
  gapHints: string[];
}): boolean {
  if (params.items.length === 0) return true;
  const anchor = extractSemanticTokens([params.activeQuestionText, ...params.gapHints].join(" "));
  if (anchor.size < 3) return true;
  return params.items.some((item) => {
    const exampleTokens = extractSemanticTokens(item);
    if (exampleTokens.size === 0) return false;
    for (const token of exampleTokens) {
      if (anchor.has(token)) return true;
    }
    return false;
  });
}

function fallbackHelpExamples(params: {
  language: "zh" | "en";
  gapHints: string[];
}): string[] {
  const gap = params.gapHints.find((item) => item.trim().length > 0)?.trim() ?? "";
  if (params.language === "zh") {
    if (gap) {
      return [
        `你可以先说一个最确定的事实，比如“关于${gap}，我目前最确定的是……”。`,
        "再补一个具体场景，比如“最近一周里最明显的是……”。",
      ];
    }
    return [
      "你可以先说一个最确定的事实，比如“最近一周更明显”。",
      "再补一个具体例子，比如“主要在晚上发生，频率大概每天两三次”。",
    ];
  }
  if (gap) {
    return [
      `Start with one certain fact, for example: "About ${gap}, what I am most sure about is ...".`,
      "Then add one concrete scene, for example: \"The most obvious pattern in the last week is ...\".",
    ];
  }
  return [
    "Start with one fact you are most sure about, for example: \"This became obvious in the past week.\"",
    "Then add one concrete scene, for example: \"It happens mostly at night, around two to three times a day.\".",
  ];
}

function toFallbackText(params: {
  event: PresentationDraftEvent;
  language: "zh" | "en";
}): string {
  const hint = stripInternalArtifacts(params.event.content_hint ?? "");
  const reasoningGlimpse = params.event.semantic_hints?.reasoning_glimpse?.trim();
  const helpReframe = params.event.semantic_hints?.help_reframe?.trim();

  if (params.event.event_type === "understanding") {
    if (params.language === "zh") return hint || "我先接住你刚刚补充的重点。";
    return hint || "I will first capture the key point you just added.";
  }
  if (params.event.event_type === "acknowledgement") {
    if (params.language === "zh") return hint || "我收到你这段背景和顾虑了，我们按你的节奏继续。";
    return hint || "I hear the background and concern you shared, and we can continue at your pace.";
  }
  if (params.event.event_type === "why_this_matters") {
    if (params.language === "zh") {
      if (reasoningGlimpse) return `这个信息对我很关键，${reasoningGlimpse}`;
      return "这个信息对我很关键，因为它会直接影响我后面的判断方向。";
    }
    if (reasoningGlimpse) return `This detail matters for my direction, and ${reasoningGlimpse}`;
    return "This detail matters because it directly affects my next assessment direction.";
  }
  if (params.event.event_type === "gentle_gap_prompt") {
    if (params.language === "zh") return hint ? `为了判断更稳一点，我还想再确认一下：${hint}` : "为了判断更稳一点，我还差一两个关键信息。";
    return hint ? `To keep this grounded, I want to confirm one more point: ${hint}` : "To keep this grounded, I still need one or two key details.";
  }
  if (params.event.event_type === "help_explanation") {
    if (params.language === "zh") {
      if (hint && helpReframe) return `${hint}\n${helpReframe}`;
      if (hint) return hint;
      if (helpReframe) return helpReframe;
      return "我先把这题拆小，你可以先说最确定的一点，再补一个具体例子。";
    }
    if (hint && helpReframe) return `${hint}\n${helpReframe}`;
    if (hint) return hint;
    if (helpReframe) return helpReframe;
    return "I will break this down first. Start with your most certain point, then add one concrete example.";
  }
  if (params.event.event_type === "micro_confirm") {
    if (params.language === "zh") return hint || "我先确认一句，避免我们理解偏了。";
    return hint || "Let me confirm one quick point so we stay aligned.";
  }
  if (params.event.event_type === "transition") {
    if (params.event.semantic_hints?.is_completion_closure) {
      const caseSummary = params.event.semantic_hints.completion_case_summary?.trim()
        || hint
        || (
          params.language === "zh"
            ? "根据你的描述，我们已经把这次访谈最关键的信息收齐了。"
            : "Based on your responses, we have captured the key information for this interview."
        );
      return buildCompletionClosureText({
        language: params.language,
        domain: params.event.semantic_hints.completion_domain ?? "general",
        caseSummary,
      });
    }
    if (params.language === "zh") {
      if (reasoningGlimpse) return `好的，我们继续。${reasoningGlimpse}`;
      return hint || "好的，我们继续往下，把最后这个关键点确认掉。";
    }
    if (reasoningGlimpse) return `Great, let's continue. ${reasoningGlimpse}`;
    return hint || "Great, let's continue and lock the next key point.";
  }
  if (params.event.event_type === "next_step") {
    if (params.event.mode === "follow_up_select") {
      if (params.language === "zh") {
        return hint || "我先把这个点问清楚，你先选最接近的一项就行。";
      }
      return hint || "Let me lock this point first. Pick the closest option to continue.";
    }
    return hint;
  }
  return hint;
}

function isValidGeneratedText(params: {
  text: string;
  eventType: PresentationDraftEvent["event_type"];
  mode?: PresentationDraftEvent["mode"];
  language: "zh" | "en";
  skipFirstPersonCheck?: boolean;
}): boolean {
  const normalized = normalizeOutput(params.text);
  if (!normalized) return false;
  if (containsInternalTerms(normalized)) return false;
  if (containsBoundaryViolation(normalized)) return false;
  if (countSentences(normalized) > 2) return false;
  if (hasVagueImportanceWithoutReason(normalized)) return false;
  if (params.mode === "follow_up_select" && /(确认一下|快速确认|quick confirm|small confirmation|align meaning)/i.test(normalized)) {
    return false;
  }
  if (!params.skipFirstPersonCheck
    && params.eventType !== "next_step"
    && params.eventType !== "help_examples"
    && !hasFirstPerson(normalized, params.language)
  ) {
    return false;
  }
  return true;
}

function isCompletionClosureEvent(event: PresentationDraftEvent): boolean {
  return event.event_type === "transition" && Boolean(event.semantic_hints?.is_completion_closure);
}

export async function phrasePresentationEvents(params: {
  language: "zh" | "en";
  toneProfile: AskmoreV2ToneProfile;
  reasoningProfile: AskmoreV2ReasoningProfile;
  safeBoundary: AskmoreV2SafeExplanationBoundary;
  routedIntent: AskmoreV2RoutedIntent;
  latestUserTurn: string;
  activeQuestionText: string;
  gapHints: string[];
  drafts: PresentationDraftEvent[];
}): Promise<AskmoreV2VisibleEvent[]> {
  const promptPack = askmoreV2PresentationPromptPack();
  const textualDrafts = params.drafts
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.event_type !== "help_examples");
  const modelDrafts = textualDrafts.filter(({ event }) => !isCompletionClosureEvent(event));

  const fallbackByIndex = new Map<number, string>();
  for (const { event, index } of textualDrafts) {
    fallbackByIndex.set(index, toFallbackText({ event, language: params.language }));
  }

  const composedTexts = new Map<number, string>(fallbackByIndex);
  if (modelDrafts.length > 0) {
    try {
      const modelInput = modelDrafts.map(({ event, index }) => ({
        index,
        type: event.event_type,
        content_hint: event.content_hint ?? "",
        mode: event.mode ?? null,
        badge_label: event.badge_label ?? null,
        semantic_hints: event.semantic_hints ?? {},
      }));
      const systemPrompt = [
        askmoreV2PresentationPhrasingPrompt(),
        "",
        "=== CORE ===",
        promptPack.core,
        "",
        "=== UNDERSTANDING ===",
        promptPack.understanding,
        "",
        "=== HELP ===",
        promptPack.help,
        "",
        "=== MICRO_CONFIRM ===",
        promptPack.microConfirm,
        "",
        "=== TRANSITION ===",
        promptPack.transition,
      ].join("\n");
      const result = await generateModelObject({
        system: systemPrompt,
        prompt: [
          `language: ${params.language}`,
          `tone_profile: ${params.toneProfile}`,
          `tone_instruction: ${toneInstruction(params.toneProfile, params.language)}`,
          `reasoning_profile: ${params.reasoningProfile}`,
          `reasoning_instruction: ${reasoningInstruction(params.reasoningProfile, params.language)}`,
          `safe_explanation_boundary: ${params.safeBoundary.id}`,
          `boundary_instruction: ${boundaryInstruction(params.safeBoundary, params.language)}`,
          `routed_intent: ${params.routedIntent.intent}`,
          `latest_user_turn: ${params.latestUserTurn}`,
          `active_question_text: ${params.activeQuestionText}`,
          `gap_hints: ${JSON.stringify(params.gapHints)}`,
          `draft_blocks: ${JSON.stringify(modelInput)}`,
        ].join("\n"),
        schema,
      });
      for (const block of result.blocks) {
        if (!fallbackByIndex.has(block.index)) continue;
        const targetEvent = modelDrafts.find(({ index }) => index === block.index)?.event;
        if (!targetEvent) continue;
        const normalized = normalizeOutput(block.text);
        if (!isValidGeneratedText({
          text: normalized,
          eventType: targetEvent.event_type,
          mode: targetEvent.mode,
          language: params.language,
          skipFirstPersonCheck: isCompletionClosureEvent(targetEvent),
        })) continue;
        composedTexts.set(block.index, normalized);
      }
    } catch {
      // Keep fallback texts on model failure.
    }
  }

  const openingSeen = new Set<string>();
  for (const { event, index } of textualDrafts) {
    const candidate = composedTexts.get(index) ?? toFallbackText({ event, language: params.language });
    const opening = extractOpening(candidate, params.language);
    if (!opening) continue;
    if (openingSeen.has(opening)) {
      composedTexts.set(index, toFallbackText({ event, language: params.language }));
      continue;
    }
    openingSeen.add(opening);
  }

  return params.drafts.map((event, index) => {
    const isHelpExamples = event.event_type === "help_examples";
    const incomingItems = (event.items ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
    const normalizedItems = isHelpExamples
      ? (
          validateHelpExamples({
            items: incomingItems,
            activeQuestionText: params.activeQuestionText,
            gapHints: params.gapHints,
          })
            ? incomingItems
            : fallbackHelpExamples({
                language: params.language,
                gapHints: params.gapHints,
              })
        ).slice(0, 2)
      : event.items;

    return {
      event_id: randomUUID(),
      event_type: event.event_type,
      created_at: event.created_at,
      visible: true,
      payload: {
        content: isHelpExamples ? undefined : composedTexts.get(index) ?? toFallbackText({ event, language: params.language }),
        items: normalizedItems,
        options: event.options,
        dimension_id: event.dimension_id,
        allow_free_text: event.allow_free_text,
        mode: event.mode,
        badge_label: event.badge_label,
      },
    };
  });
}
