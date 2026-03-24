import {
  AskmoreV2FlowQuestion,
  AskmoreV2Language,
  AskmoreV2QuestionNode,
  AskmoreV2QuestionNodeDimension,
} from "@/server/askmore_v2/types";

const CANONICAL_DIMENSION_KEYWORDS: Record<string, string[]> = {
  posture: [
    "posture",
    "urination_posture",
    "position",
    "squat",
    "squatting",
    "spray",
    "spraying",
    "姿势",
    "蹲",
    "喷",
    "蹲着",
    "喷尿",
  ],
  urine_amount: [
    "urine_amount",
    "amount",
    "volume",
    "urine_volume",
    "尿量",
    "量",
    "多少",
    "少量",
    "大量",
  ],
  pain_signs: [
    "pain_signs",
    "pain",
    "discomfort",
    "pain_behavior",
    "signs_of_pain",
    "不适",
    "疼痛",
    "痛",
    "舔",
    "费劲",
    "频繁进出猫砂盆",
  ],
  duration: [
    "duration",
    "time",
    "length",
    "how_long",
    "持续",
    "多久",
    "时长",
    "小时",
    "分钟",
  ],
  onset_timing: [
    "onset_timing",
    "onset",
    "start_time",
    "started",
    "begin",
    "recently_started",
    "起始时间",
    "开始时间",
    "什么时候开始",
    "最近才开始",
    "刚开始",
    "一直以来",
    "常年",
    "突然",
    "搬家后",
    "发生",
  ],
  stress_response: [
    "stress_response",
    "stress",
    "anxiety",
    "hide",
    "hiding",
    "应激",
    "紧张",
    "躲人",
    "躲",
    "躲藏",
    "来人",
  ],
  skin_lesion: [
    "skin_lesion",
    "hair_loss",
    "bald_spot",
    "itch",
    "skin",
    "掉毛",
    "秃",
    "皮屑",
    "红点",
    "瘙痒",
  ],
  urination_location: [
    "urination_location",
    "location",
    "where",
    "位置",
    "地方",
    "猫砂盆",
    "床",
    "衣物",
    "沙发",
    "外面",
  ],
  frequency: [
    "frequency",
    "freq",
    "times",
    "频率",
    "次数",
    "每周几次",
    "一周",
    "每天",
  ],
  blood_signs: [
    "blood_signs",
    "blood",
    "hematuria",
    "血尿",
    "血丝",
    "带血",
  ],
};

const GLOBAL_DIMENSION_ALIASES: Record<string, string[]> = {
  pain_signs: ["discomfort", "pain_behavior", "signs_of_pain", "pain_sign", "不适表现"],
  urine_amount: ["amount", "volume", "urine_volume", "尿量大小"],
  posture: ["position", "urination_posture", "排尿姿势"],
  duration: ["time", "length", "持续时间", "多久"],
  onset_timing: ["onset", "start_time", "started", "begin", "起始时间", "开始时间", "最近才开始", "一直以来", "常年"],
  stress_response: ["stress", "anxiety", "hide", "hiding", "应激反应"],
  skin_lesion: ["hair_loss", "bald_spot", "itch", "皮肤症状"],
  urination_location: ["location", "where", "排尿位置", "尿在哪里"],
  frequency: ["freq", "times", "频次"],
};

function sanitizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

function splitEnglishTokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(Boolean);
}

function dedupeDimensionId(baseId: string, used: Set<string>): string {
  if (!used.has(baseId)) {
    used.add(baseId);
    return baseId;
  }

  let idx = 2;
  while (used.has(`${baseId}_${idx}`)) idx += 1;
  const next = `${baseId}_${idx}`;
  used.add(next);
  return next;
}

function keywordScore(text: string, keywords: string[]): number {
  let score = 0;
  for (const keyword of keywords) {
    if (!keyword) continue;
    const normalizedKeyword = sanitizeToken(keyword);
    if (!normalizedKeyword) continue;
    if (text.includes(normalizedKeyword)) score += 1;
  }
  return score;
}

function inferCanonicalDimensionBaseId(label: string): string | null {
  const normalized = sanitizeToken(label);
  if (!normalized) return null;

  let bestId: string | null = null;
  let bestScore = 0;
  for (const [dimensionId, keywords] of Object.entries(CANONICAL_DIMENSION_KEYWORDS)) {
    const score = keywordScore(normalized, keywords);
    if (score > bestScore) {
      bestScore = score;
      bestId = dimensionId;
    }
  }
  return bestScore > 0 ? bestId : null;
}

function inferSlugDimensionBaseId(label: string, index: number): string {
  const englishTokens = splitEnglishTokens(label);
  if (englishTokens.length > 0) {
    return englishTokens.slice(0, 4).join("_");
  }
  return `dimension_topic_${index + 1}`;
}

function inferDimensionBaseId(label: string, index: number): string {
  return inferCanonicalDimensionBaseId(label) ?? inferSlugDimensionBaseId(label, index);
}

export function buildSemanticDimensionsFromLabels(params: {
  labels: string[];
  language: AskmoreV2Language;
  maxCount?: number;
}): AskmoreV2QuestionNodeDimension[] {
  const limit = Math.max(1, Math.min(6, params.maxCount ?? 4));
  const used = new Set<string>();
  const dimensions = params.labels
    .map((rawLabel) => rawLabel.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((label, index) => {
      const baseId = inferDimensionBaseId(label, index);
      return {
        id: dedupeDimensionId(baseId, used),
        label,
      };
    });

  if (dimensions.length > 0) return dimensions;

  const fallbackLabel = params.language === "zh" ? "核心观察" : "core observation";
  return [
    {
      id: "core_observation",
      label: fallbackLabel,
    },
  ];
}

export function buildSemanticDimensionsFromQuestion(params: {
  question: AskmoreV2FlowQuestion;
  language: AskmoreV2Language;
}): AskmoreV2QuestionNodeDimension[] {
  return buildSemanticDimensionsFromLabels({
    labels: params.question.sub_questions,
    language: params.language,
    maxCount: 4,
  });
}

export function deriveCompletionCriteriaFromDimensions(dimensions: AskmoreV2QuestionNodeDimension[]): string[] {
  return dimensions.slice(0, Math.max(1, Math.min(3, dimensions.length))).map((item) => item.id);
}

function collectDimensionAliases(currentNode: AskmoreV2QuestionNode): Record<string, string> {
  const map: Record<string, string> = {};

  for (const dimension of currentNode.target_dimensions) {
    const dimId = dimension.id;
    const dimIdToken = sanitizeToken(dimId);
    if (dimIdToken) map[dimIdToken] = dimId;
    map[sanitizeToken(dimId.replace(/_/g, ""))] = dimId;

    const labelToken = sanitizeToken(dimension.label);
    if (labelToken) map[labelToken] = dimId;

    for (const token of splitEnglishTokens(dimension.label)) {
      const normalized = sanitizeToken(token);
      if (normalized.length >= 3) map[normalized] = dimId;
    }
  }

  for (const [canonicalId, aliases] of Object.entries(GLOBAL_DIMENSION_ALIASES)) {
    if (!currentNode.target_dimensions.some((item) => item.id === canonicalId)) continue;
    for (const alias of aliases) {
      const normalized = sanitizeToken(alias);
      if (!normalized) continue;
      map[normalized] = canonicalId;
    }
  }

  return map;
}

export function normalizeDimensionKey(params: {
  rawKey: string;
  currentNode: AskmoreV2QuestionNode;
}): string | null {
  const aliasMap = collectDimensionAliases(params.currentNode);
  const normalized = sanitizeToken(params.rawKey);
  if (!normalized) return null;
  return aliasMap[normalized] ?? null;
}

function keywordsForDimension(dimension: AskmoreV2QuestionNodeDimension): string[] {
  const keywords = new Set<string>();
  const canonicalKeywords = CANONICAL_DIMENSION_KEYWORDS[dimension.id] ?? [];
  for (const item of canonicalKeywords) keywords.add(item);
  keywords.add(dimension.id);
  keywords.add(dimension.id.replace(/_/g, ""));

  const label = dimension.label.trim();
  if (label) keywords.add(label);
  for (const token of splitEnglishTokens(label)) {
    if (token.length >= 3) keywords.add(token);
  }
  return [...keywords];
}

function temporalSignal(text: string): { hasTemporal: boolean; hasSpecificTemporal: boolean } {
  const hasTemporal =
    /(最近|刚开始|才开始|开始|一直以来|常年|突然|搬家后|近期|近来|since|recent|started|begin|sudden)/i.test(text);
  const hasSpecificTemporal =
    /(\d+\s*(天|周|个月|月|年|days?|weeks?|months?|years?))|(最近几天|最近几周|最近几个月|搬家后|一直以来|常年|上周|上个月|这几天|这几周|这几个月)/i.test(
      text,
    );
  return {
    hasTemporal,
    hasSpecificTemporal,
  };
}

export function dimensionMentionSignal(params: {
  currentNode: AskmoreV2QuestionNode;
  dimensionId: string;
  text: string;
}): { mentioned: boolean; strong: boolean } {
  const dimension = params.currentNode.target_dimensions.find((item) => item.id === params.dimensionId);
  if (!dimension) return { mentioned: false, strong: false };

  const normalizedText = sanitizeToken(params.text);
  if (!normalizedText) return { mentioned: false, strong: false };

  const keywords = keywordsForDimension(dimension);
  let hitCount = 0;

  for (const keyword of keywords) {
    const normalizedKeyword = sanitizeToken(keyword);
    if (!normalizedKeyword) continue;
    if (normalizedText.includes(normalizedKeyword)) hitCount += 1;
  }

  const hasNumericSignal = /\d/.test(params.text);
  const hasChineseQuantifierSignal =
    /((?:几|一|二|三|四|五|六|七|八|九|十|两|半|多|少)(?:次|块|处|点|天|周|月|小时|分钟))|局部|大片|对称|全身|到处|散在/.test(
      params.text,
    );
  const hasQuantifierSignal = hasNumericSignal || hasChineseQuantifierSignal;
  const temporal = temporalSignal(params.text);
  const dimensionMeta = `${dimension.id} ${dimension.label}`;
  const temporalDimension = /(onset|timing|duration|start|时间|开始|起始|发生|最近|常年)/i.test(dimensionMeta);
  const temporalMention = temporalDimension && temporal.hasTemporal;
  const temporalStrong = temporalDimension && (temporal.hasSpecificTemporal || (temporal.hasTemporal && hitCount >= 1));
  const mentioned = hitCount > 0 || temporalMention;
  const strong = hitCount >= 2 || (hasQuantifierSignal && hitCount >= 1) || temporalStrong;
  return { mentioned, strong };
}

export function detectDimensionMentionsInTurns(params: {
  currentNode: AskmoreV2QuestionNode;
  turns: string[];
}): Record<string, { mentioned: boolean; strong: boolean }> {
  const result: Record<string, { mentioned: boolean; strong: boolean }> = {};
  for (const dimension of params.currentNode.target_dimensions) {
    result[dimension.id] = { mentioned: false, strong: false };
  }

  for (const turn of params.turns) {
    for (const dimension of params.currentNode.target_dimensions) {
      const signal = dimensionMentionSignal({
        currentNode: params.currentNode,
        dimensionId: dimension.id,
        text: turn,
      });
      if (signal.mentioned) result[dimension.id].mentioned = true;
      if (signal.strong) result[dimension.id].strong = true;
    }
  }

  return result;
}

export function isWeakDimensionId(dimensionId: string): boolean {
  return /^d\d+$/i.test(dimensionId.trim());
}
