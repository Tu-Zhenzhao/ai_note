import {
  SuperV1DetectedHelpSelection,
  SuperV1HelpContext,
  SuperV1InteractionMode,
} from "@/server/superv1/types";

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeForLooseMatch(value: string): string {
  return normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function overlapRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  let overlap = 0;
  for (let i = 0; i < shorter.length; i += 1) {
    if (longer.includes(shorter.slice(i, i + 3))) overlap += 1;
  }
  return overlap / Math.max(shorter.length, 1);
}

function detectSelectionByIndex(message: string, optionCount: number): number | null {
  const trimmed = message.trim();
  const numeric = trimmed.match(/^([1-9]\d?)$/);
  if (numeric) {
    const idx = Number(numeric[1]);
    if (idx >= 1 && idx <= optionCount) return idx - 1;
  }

  const optionPhrase = trimmed.match(/^(?:option\s*)?([1-9]\d?)$/i);
  if (optionPhrase) {
    const idx = Number(optionPhrase[1]);
    if (idx >= 1 && idx <= optionCount) return idx - 1;
  }

  const zhMatch = trimmed.match(/^第([一二三四五六七八九十\d]+)个?$/);
  if (!zhMatch) return null;
  const zhToken = zhMatch[1];
  const zhMap: Record<string, number> = {
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
  };
  const idx = zhToken in zhMap ? zhMap[zhToken] : Number(zhToken);
  if (!Number.isFinite(idx)) return null;
  if (idx >= 1 && idx <= optionCount) return idx - 1;
  return null;
}

const HELP_ACTION_PATTERNS = [
  /\bi don'?t understand\b/i,
  /\bnot sure (how|what)\b/i,
  /\bnot sure\b/i,
  /\bi don'?t know\b/i,
  /\bwhat does .* mean\b/i,
  /what does option/i,
  /\bexplain\b/i,
  /\bexamples?\b/i,
  /\bsimplify\b/i,
  /\brephrase\b/i,
  /\bclarify\b/i,
  /\bcan you help\b/i,
  /\bhelp me\b/i,
  /什么意思/i,
  /什么叫/i,
  /啥意思/i,
  /有点不懂/i,
  /没太懂/i,
  /能再解释/i,
  /可以再解释/i,
  /没懂/i,
  /不理解/i,
  /不知道怎么/i,
  /解释一下/i,
  /举个例子/i,
  /再简单一点/i,
  /换个说法/i,
];

const EXPLICIT_ABANDON_PATTERNS = [
  /\bskip (this|the) question\b/i,
  /\blet'?s move on\b/i,
  /\bcome back later\b/i,
  /先跳过/i,
  /换个问题/i,
  /稍后再说/i,
];

const ANSWER_HINT_PATTERNS = [
  /\bi think\b/i,
  /\bour (product|service|company|customers)\b/i,
  /\bwe (are|mainly|serve|provide|build|focus)\b/i,
  /\b(we|our)\s+belong\s+to\b/i,
  /\btarget (users|customers|enterprises?)\b/i,
  /\bmainly\b/i,
  /\btarget\b/i,
  /我们(是|做|主要|服务|提供|面向|帮助|属于|针对)/,
  /我们属于/,
  /针对(企业|用户|客户|开发者)/,
  /公司(是|做|主要|提供)/,
  /客户(是|主要是|主要为)/,
  /产品(是|主要是|核心是)/,
  /服务(是|主要是|核心是)/,
  /(api|saas).*(服务|service)/i,
];

const ACK_ONLY_PATTERNS = [
  /^thanks?\.?$/i,
  /^ok(?:ay)?\.?$/i,
  /^got it\.?$/i,
  /^sure\.?$/i,
  /^收到\.?$/,
  /^好的\.?$/,
  /^谢谢\.?$/,
];

const OTHER_DISCUSSION_PATTERNS = [
  /\bby the way\b/i,
  /\bsummarize (what|everything)\b/i,
  /\bwe'?ll talk later\b/i,
  /先总结一下/i,
  /我们稍后再聊/i,
  /我先走了/i,
];

function isLikelyQuestionOnly(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return /[?？]$/.test(text);
}

export function detectHelpSelection(params: {
  message: string;
  helpContext: SuperV1HelpContext | null;
}): SuperV1DetectedHelpSelection | null {
  const options = params.helpContext?.last_help_options ?? [];
  if (options.length === 0) return null;

  const byIndex = detectSelectionByIndex(params.message, options.length);
  if (byIndex != null) {
    return {
      detected: true,
      selection_type: /^\d+$/.test(params.message.trim()) ? "numeric" : "option_phrase",
      selected_option_index: byIndex,
      selected_option_text: options[byIndex] ?? null,
      confidence: 0.98,
      raw_message: params.message,
    };
  }

  const normalizedInput = normalizeForLooseMatch(params.message);
  if (!normalizedInput) return null;

  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < options.length; i += 1) {
    const option = options[i] ?? "";
    const normalizedOption = normalizeForLooseMatch(option);
    if (!normalizedOption) continue;
    const score = overlapRatio(normalizedInput, normalizedOption);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0 && bestScore >= 0.72) {
    return {
      detected: true,
      selection_type: "near_match",
      selected_option_index: bestIdx,
      selected_option_text: options[bestIdx] ?? null,
      confidence: Math.min(0.95, bestScore),
      raw_message: params.message,
    };
  }

  return null;
}

export function detectHelpAction(message: string): boolean {
  return HELP_ACTION_PATTERNS.some((pattern) => pattern.test(message));
}

export function detectExplicitHelpAbandon(message: string): boolean {
  return EXPLICIT_ABANDON_PATTERNS.some((pattern) => pattern.test(message));
}

export function detectPlausibleAnswer(message: string): boolean {
  const text = normalizeText(message);
  if (!text) return false;
  if (ACK_ONLY_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (HELP_ACTION_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (EXPLICIT_ABANDON_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (OTHER_DISCUSSION_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (isLikelyQuestionOnly(text)) return false;
  if (text.length >= 24 && !/\b(can you|could you|please|help)\b/i.test(text)) {
    if (/(what|why|how|meaning|什么意思|什么叫|怎么|为何|为什么)/i.test(text)) return false;
    return true;
  }
  return ANSWER_HINT_PATTERNS.some((pattern) => pattern.test(text));
}

export function detectLikelyOtherDiscussion(message: string): boolean {
  const text = normalizeText(message);
  if (!text) return false;
  if (ACK_ONLY_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return OTHER_DISCUSSION_PATTERNS.some((pattern) => pattern.test(text));
}

export function shouldUseHelpModeDetector(mode: SuperV1InteractionMode): boolean {
  return mode === "help_open";
}
