import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2HelpCoachingPrompt } from "@/server/askmore_v2/prompts";
import {
  AskmoreV2HelpCoachingOutput,
  AskmoreV2HelpObstacleLayer,
  AskmoreV2HelpResolutionGoal,
  AskmoreV2Language,
} from "@/server/askmore_v2/types";

const schema = z.object({
  obstacle_layer: z.enum(["concept", "observation", "judgement", "expression", "scope"]),
  resolution_goal: z.enum(["identify_behavior_signal", "estimate_frequency", "describe_duration", "describe_timeline"]),
  direct_help_answer: z.string().min(6).max(420),
  downgraded_question: z.string().min(6).max(240),
  explanatory_examples: z.array(z.string().min(2).max(200)).max(3).default([]),
  answer_examples: z.array(z.string().min(2).max(220)).min(1).max(3),
  reconnect_prompt: z.string().min(6).max(240),
});

const DEFINITIVE_TERMS = /(确诊|基本可以确定|一定是|肯定是|必然是|definitely|certainly|diagnosed)/i;
const INTERNAL_TERMS = /(coverage|field|route|policy|state|q\d+__|字段|覆盖|路由|策略|state_dump|key=value)/i;

const ZH_STOPWORDS = new Set([
  "这个", "那个", "这里", "那里", "问题", "情况", "一下", "可以", "需要", "我们", "你们", "他们", "是否", "什么",
  "怎么", "然后", "继续", "确认", "描述", "用户", "目前", "最近", "一个", "两个", "这样", "那样", "对于", "关于", "猫咪",
]);
const EN_STOPWORDS = new Set([
  "this", "that", "with", "from", "your", "into", "about", "have", "will", "what", "when", "where", "which", "there",
  "then", "just", "more", "some", "into", "because", "please", "answer", "question",
]);

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function inferObstacleLayer(text: string): AskmoreV2HelpObstacleLayer {
  const t = text.toLowerCase();
  if (/(怎么答|怎么说|怎么描述|不会描述|不会回答|how to answer|how should i say|how do i phrase)/i.test(t)) {
    return "expression";
  }
  if (/(怎么判断|看什么|什么行为|哪些表现|怎么观察|观察什么|what signs|what behavior|how to tell)/i.test(t)) {
    return "observation";
  }
  if (/(是什么意思|什么叫|定义|算不算|what does .* mean|definition|mean by)/i.test(t)) {
    return "concept";
  }
  if (/(怎么区分|怎么判断是不是|严重吗|normal|abnormal|区分)/i.test(t)) {
    return "judgement";
  }
  if (/(多久算|多长时间算|范围|最近算|长期算|how long counts|time window)/i.test(t)) {
    return "scope";
  }
  return "observation";
}

function inferResolutionGoal(params: {
  userHelpQuery: string;
  activeQuestion: string;
  gapHints: string[];
  obstacleLayer: AskmoreV2HelpObstacleLayer;
}): AskmoreV2HelpResolutionGoal {
  const text = `${params.userHelpQuery} ${params.activeQuestion} ${params.gapHints.join(" ")}`.toLowerCase();
  if (/(频率|次数|每周|每天|frequency|times per|how often)/i.test(text)) return "estimate_frequency";
  if (/(持续|多久|时长|分钟|小时|duration|how long|lasts)/i.test(text)) return "describe_duration";
  if (/(最近|突然|长期|一直|什么时候开始|timeline|onset|recently|since when)/i.test(text)) return "describe_timeline";
  if (params.obstacleLayer === "scope") return "describe_timeline";
  return "identify_behavior_signal";
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

function isOnTopic(params: {
  text: string;
  activeQuestion: string;
  gapHints: string[];
}): boolean {
  const anchor = extractSemanticTokens(`${params.activeQuestion} ${params.gapHints.join(" ")}`);
  if (anchor.size < 3) return true;
  const payloadTokens = extractSemanticTokens(params.text);
  if (payloadTokens.size === 0) return false;
  for (const token of payloadTokens) {
    if (anchor.has(token)) return true;
  }
  return false;
}

function validateBoundary(text: string): boolean {
  const normalizedText = normalize(text);
  if (!normalizedText) return false;
  if (INTERNAL_TERMS.test(normalizedText)) return false;
  if (DEFINITIVE_TERMS.test(normalizedText)) return false;
  return true;
}

function goalLabel(params: {
  language: AskmoreV2Language;
  goal: AskmoreV2HelpResolutionGoal;
  gapHint?: string;
}): string {
  const gap = params.gapHint ?? "";
  if (params.language === "zh") {
    if (params.goal === "estimate_frequency") return gap || "出现频率";
    if (params.goal === "describe_duration") return gap || "持续时长";
    if (params.goal === "describe_timeline") return gap || "出现时间线";
    return gap || "关键行为表现";
  }
  if (params.goal === "estimate_frequency") return gap || "frequency";
  if (params.goal === "describe_duration") return gap || "duration";
  if (params.goal === "describe_timeline") return gap || "timeline";
  return gap || "key behavior signals";
}

function buildFallback(params: {
  language: AskmoreV2Language;
  userHelpQuery: string;
  activeQuestion: string;
  gapHints: string[];
}): AskmoreV2HelpCoachingOutput {
  const obstacle = inferObstacleLayer(params.userHelpQuery);
  const goal = inferResolutionGoal({
    userHelpQuery: params.userHelpQuery,
    activeQuestion: params.activeQuestion,
    gapHints: params.gapHints,
    obstacleLayer: obstacle,
  });
  const target = goalLabel({
    language: params.language,
    goal,
    gapHint: params.gapHints[0],
  });

  if (params.language === "zh") {
    const direct = obstacle === "observation"
      ? `我明白了，你现在卡住的是“不确定该看哪些表现才算有效线索”。这类问题可以先看最明显、最稳定重复出现的行为变化，再看它出现的频率或持续时间。`
      : obstacle === "concept"
      ? `我明白了，你现在卡在概念定义上。我这里不需要特别学术的定义，只需要你按日常观察说出最明显的变化。`
      : obstacle === "judgement"
      ? `我明白了，你现在卡在“怎么判断”这一步。我们先不急着下结论，先把能观察到的事实说清楚，再做方向判断。`
      : obstacle === "expression"
      ? `我明白了，你现在卡在“怎么表达更合适”。你不用一次答全，我先给你一个更容易开口的说法。`
      : `我明白了，你现在卡在时间范围怎么界定。我们先用一个你最确定的时间印象来回答就可以。`;

    return {
      obstacle_layer: obstacle,
      resolution_goal: goal,
      direct_help_answer: direct,
      downgraded_question: `你先不用答完整，先说一个最确定的点：关于「${target}」，你最先注意到的具体表现是什么？`,
      explanatory_examples: [
        `比如先说你“看见了什么”而不是“你怎么判断它”。`,
        "再补一条出现频率或持续时间，信息就会清楚很多。",
      ],
      answer_examples: [
        `我最确定的是：${target}最近明显出现了。`,
        `如果按日常观察来说，${target}在特定场景会更明显，持续大概一段时间。`,
      ],
      reconnect_prompt: `好，我先按这个思路继续：你回忆一下和「${target}」最相关的那次具体情况，大概是怎样的？`,
    };
  }

  return {
    obstacle_layer: obstacle,
    resolution_goal: goal,
    direct_help_answer:
      "I understand where you are stuck. We can start from concrete observable facts first, then use frequency or duration to make sense of it.",
    downgraded_question: `You do not need a perfect answer. Start with one concrete point about "${target}" that you are most sure about.`,
    explanatory_examples: [
      "Describe what you observed first, not your final judgement.",
      "Then add one detail about frequency or duration.",
    ],
    answer_examples: [
      `The most certain point for me is that ${target} became more obvious recently.`,
      `In daily observation, ${target} is more obvious in specific situations and lasts for a while.`,
    ],
    reconnect_prompt: `Great, based on that, what was the most recent concrete case related to "${target}"?`,
  };
}

function sanitizeOutput(params: {
  language: AskmoreV2Language;
  output: AskmoreV2HelpCoachingOutput;
  activeQuestion: string;
  gapHints: string[];
}): AskmoreV2HelpCoachingOutput | null {
  const direct = normalize(params.output.direct_help_answer);
  const downgraded = normalize(params.output.downgraded_question);
  const reconnect = normalize(params.output.reconnect_prompt);
  const explanations = params.output.explanatory_examples.map((item) => normalize(item)).filter(Boolean).slice(0, 2);
  const answers = params.output.answer_examples.map((item) => normalize(item)).filter(Boolean).slice(0, 2);

  if (!validateBoundary(direct) || !validateBoundary(downgraded) || !validateBoundary(reconnect)) return null;
  if (answers.length === 0) return null;
  if (!isOnTopic({
    text: `${direct} ${downgraded} ${reconnect} ${answers.join(" ")}`,
    activeQuestion: params.activeQuestion,
    gapHints: params.gapHints,
  })) return null;

  return {
    ...params.output,
    direct_help_answer: direct,
    downgraded_question: downgraded,
    reconnect_prompt: reconnect,
    explanatory_examples: explanations,
    answer_examples: answers,
  };
}

export async function generateHelpCoaching(params: {
  language: AskmoreV2Language;
  userHelpQuery: string;
  activeQuestion: string;
  gapHints: string[];
  knownContext: string[];
  scenario: string;
  targetOutputType: string;
}): Promise<AskmoreV2HelpCoachingOutput> {
  const fallback = buildFallback(params);
  try {
    const result = await generateModelObject({
      system: askmoreV2HelpCoachingPrompt(),
      prompt: [
        `language: ${params.language}`,
        `user_help_query: ${params.userHelpQuery}`,
        `active_question: ${params.activeQuestion}`,
        `gap_hints: ${params.gapHints.join(" | ") || "none"}`,
        `known_context: ${params.knownContext.join(" | ") || "none"}`,
        `scenario: ${params.scenario || "general"}`,
        `target_output_type: ${params.targetOutputType || "summary"}`,
      ].join("\n"),
      schema,
    });
    const sanitized = sanitizeOutput({
      language: params.language,
      output: result,
      activeQuestion: params.activeQuestion,
      gapHints: params.gapHints,
    });
    return sanitized ?? fallback;
  } catch {
    return fallback;
  }
}
