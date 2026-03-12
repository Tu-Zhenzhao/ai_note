import { z } from "zod";
import {
  ConfirmationSignal,
  ExtractionEvidenceItem,
  ExtractionResult,
  ExtractedFact,
  InterviewState,
} from "@/lib/types";
import { generateModelObject } from "@/server/model/adapters";
import { extractionSystemPrompt, extractionUserPrompt } from "@/server/prompts/extraction";

const extractionSchema = z.object({
  company_one_liner: z.string().optional(),
  industry: z.array(z.string()).optional(),
  business_model: z.array(z.string()).optional(),
  founding_story: z.string().optional(),
  mission_statement: z.string().optional(),
  core_belief: z.string().optional(),
  what_should_people_remember: z.string().optional(),
  primary_offering: z.string().optional(),
  offering_type: z.string().optional(),
  problem_solved: z.array(z.string()).optional(),
  key_differentiators: z.array(z.string()).optional(),
  primary_audience: z.string().optional(),
  audience_roles: z.array(z.string()).optional(),
  audience_pain_points: z.array(z.string()).optional(),
  audience_desired_outcomes: z.array(z.string()).optional(),
  attraction_goal: z.string().optional(),
  primary_content_goal: z.string().optional(),
  desired_content_formats: z.array(z.string()).optional(),
  topics_they_want_to_talk_about: z.array(z.string()).optional(),
  topics_to_avoid_or_deprioritize: z.array(z.string()).optional(),
  preferred_tone: z.array(z.string()).optional(),
  preferred_voice: z.array(z.string()).optional(),
  preferred_style_tags: z.array(z.string()).optional(),
  disliked_tone: z.array(z.string()).optional(),
  forbidden_topics: z.array(z.string()).optional(),
  claims_policy: z.string().optional(),
  concerns: z.array(z.string()).optional(),
  case_study: z.string().optional(),
  metric_proof: z.string().optional(),
  asset: z.string().optional(),
  source_material_link: z.string().optional(),
});

type ExtractionUpdates = z.infer<typeof extractionSchema>;

function formatChatHistory(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
): string {
  return messages
    .map((message) => {
      const content = message.content.replace(/\s+/g, " ").trim();
      if (message.role === "user") return `user: ${content}`;
      if (message.role === "assistant") return `ai: ${content}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function truncateToSentence(text: string, maxWords = 25): string {
  const sentences = text.split(/[.!?。！？]+/).filter(Boolean);
  const first = sentences[0]?.trim() ?? text.trim();
  const words = first.split(/\s+/);
  if (words.length <= maxWords) return first.endsWith(".") ? first : `${first}.`;
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function normalizeBusinessModel(value: string) {
  if (/both|hybrid|两者|混合/i.test(value)) return ["software", "service"];
  if (/software|saas|api product|platform|平台|接口|额度/i.test(value)) return ["software"];
  if (/service|managed|done for you|agency|服务/i.test(value)) return ["service"];
  return [];
}

function parseContrastChoice(state: InterviewState, message: string): Partial<ExtractionUpdates> {
  const lower = message.trim().toLowerCase();
  const activeSlotId = state.workflow.pending_confirmation_slot_id ?? state.workflow.next_question_slot_id ?? "";
  const focusModules = state.conversation_meta.current_focus_modules;
  const active = focusModules[0] ?? "";
  const optionMatch = lower.match(/^(?:option\s*)?([abc])(?:\)|\.|:)?(?:\s|$)/);
  const choice = optionMatch?.[1] ?? "";

  if (active === "company_profile" || active === "product_service") {
    if (choice === "a" || /software|saas|product/.test(lower)) return { business_model: ["software"] };
    if (choice === "b" || /service|managed/.test(lower)) return { business_model: ["service"] };
    if (choice === "c" || /both|hybrid/.test(lower)) return { business_model: ["software", "service"] };
  }

  if (activeSlotId === "company_understanding.differentiator" && /^[是对可以准确没错yescorrect]+$/i.test(lower)) {
    return {};
  }

  if (active === "linkedin_content_strategy") {
    if (choice === "a" || /lead|customer|inbound/.test(lower)) {
      return { primary_content_goal: "Attract qualified inbound leads from LinkedIn content." };
    }
    if (choice === "b" || /authority|reputation|trust/.test(lower)) {
      return { primary_content_goal: "Build industry authority and long-term trust." };
    }
    if (choice === "c" || /educate|education|awareness/.test(lower)) {
      return { primary_content_goal: "Educate the market to improve problem awareness." };
    }
  }

  if (active === "content_preferences") {
    if (choice === "a") return { preferred_tone: ["analytical thought leadership"] };
    if (choice === "b") return { preferred_tone: ["practical advice"] };
    if (choice === "c") return { preferred_tone: ["storytelling"] };
  }

  return {};
}

function extractEvidenceLinks(message: string) {
  const matches = message.match(/https?:\/\/[^\s]+/g);
  return matches ?? [];
}

function mergeUpdates(base: ExtractionUpdates, overlay: ExtractionUpdates): ExtractionUpdates {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (Array.isArray(value)) {
      if (value.length > 0) out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      if (value.trim().length > 0) out[key] = value;
      continue;
    }
  }
  return out as ExtractionUpdates;
}

function heuristicExtract(state: InterviewState, message: string): ExtractionUpdates {
  const text = message.trim();
  const splitByComma = text.split(/[;,，；]/).map((part) => part.trim()).filter(Boolean);
  const shorthand = parseContrastChoice(state, text);
  const formatMentions: string[] = [];

  if (/carousel|轮播/i.test(text)) formatMentions.push("LinkedIn Carousel");
  if (/long image|长图/i.test(text)) formatMentions.push("LinkedIn Long Image");
  if (/video|视频/i.test(text)) formatMentions.push("LinkedIn Short Video Script");
  if (/post|帖子|图文/i.test(text)) formatMentions.push("LinkedIn Post Copy");

  let companyOneLiner: string | undefined;
  if (
    /we\s+(help|build|provide|offer|make|run|sell)/i.test(text) ||
    /(?:我们(?:的公司)?(?:叫|是|做|提供|运营)|我们的公司叫)/.test(text)
  ) {
    companyOneLiner = truncateToSentence(text);
  }

  let primaryOffering: string | undefined;
  const offeringMatch =
    text.match(/(?:we\s+(?:provide|offer|sell|build)|our\s+(?:product|service|platform|api))[\s:]+([^.!?]{5,80})/i) ??
    text.match(/(?:API|产品|服务|平台)(?:是|为|可以|会)?([^。！？]{5,80})/);
  if (offeringMatch) {
    primaryOffering = truncateToSentence(offeringMatch[1], 20);
  }

  let coreBelief: string | undefined;
  const beliefMatch =
    text.match(/(?:we\s+believe|core\s+belief|our\s+belief|what\s+drives\s+us|our\s+approach\s+is)[\s:]+([^.!?]{5,100})/i) ??
    text.match(/(?:理念|信念|我们相信|我们认为|核心信念)(?:是|在于|就是)?([^。！？]{5,100})/);
  if (beliefMatch) {
    coreBelief = truncateToSentence(beliefMatch[1], 20);
  }

  let whatShouldPeopleRemember: string | undefined;
  const rememberMatch =
    text.match(/(?:what\s+people\s+should\s+remember|remember\s+(?:most)?|known\s+for|main\s+takeaway)[\s:]+([^.!?]{5,100})/i) ??
    text.match(/(?:希望别人记住|让别人记住|别人记住我们|记住你们)(?:的?是)?([^。！？]{5,100})/);
  if (rememberMatch) {
    whatShouldPeopleRemember = truncateToSentence(rememberMatch[1], 20);
  }

  let problemSolved: string[] | undefined;
  const problemPatterns = text.match(
    /(?:problem|solve|pain\s*point|challenge|struggle|issue)[\s:]+([^.!?]{5,80})/gi,
  );
  const zhProblemPatterns = text.match(/(?:问题|痛点|困难|很难|耗时|效率低|手动搜索)([^。！？]{0,80})/g);
  if (problemPatterns || zhProblemPatterns) {
    problemSolved = [...(problemPatterns ?? []), ...(zhProblemPatterns ?? [])]
      .map((p) => truncateToSentence(p, 15))
      .slice(0, 3);
  }

  let keyDifferentiators: string[] | undefined;
  const diffMatch = text.match(/(?:different|unique|advantage|unlike|compared\s+to|stand\s+out)[\s:]+([^.!?]{5,120})/gi);
  const zhDiffMatch = text.match(/(?:差异化|区别在于|最不一样|不同之处|与.*相比)([^。！？]{0,120})/g);
  if (diffMatch || zhDiffMatch) {
    keyDifferentiators = [...(diffMatch ?? []), ...(zhDiffMatch ?? [])]
      .map((entry) => truncateToSentence(entry, 18))
      .slice(0, 3);
  }

  let primaryAudience: string | undefined;
  const audienceMatch =
    text.match(/(?:our\s+(?:users?|customers?|clients?|audience)|we\s+serve|target\s+(?:companies|teams|buyers)|for\s+(?:companies|businesses|teams))[\s:]+([^.!?]{5,80})/i) ??
    text.match(/(?:我们服务|我们的用户|企业用户|客户|受众)([^。！？]{3,80})/);
  if (audienceMatch) {
    primaryAudience = truncateToSentence(audienceMatch[1], 20);
  }

  let missionStatement: string | undefined;
  const missionMatch =
    text.match(/(?:we\s+exist\s+to|our\s+mission|purpose\s+is)[\s:]+([^.!?]{5,80})/i) ??
    text.match(/(?:我们的目标|我们的使命|目标是)([^。！？]{5,80})/);
  if (missionMatch) {
    missionStatement = truncateToSentence(missionMatch[1], 20);
  }

  let attractionGoal: string | undefined;
  const attractMatch =
    text.match(/(?:attract|reach|connect\s+with)\s+([^.!?]{5,60})(?:\s+on\s+linkedin|\s+via\s+linkedin|$)/i) ??
    text.match(/(?:在\s*LinkedIn\s*上.*吸引|希望吸引)([^。！？]{3,60})/i);
  if (attractMatch) {
    attractionGoal = truncateToSentence(attractMatch[1], 15);
  }

  return {
    ...shorthand,
    company_one_liner: companyOneLiner,
    business_model: shorthand.business_model ?? (normalizeBusinessModel(text).length ? normalizeBusinessModel(text) : undefined),
    primary_offering: primaryOffering,
    mission_statement: missionStatement,
    core_belief: coreBelief,
    what_should_people_remember: whatShouldPeopleRemember,
    problem_solved: problemSolved,
    key_differentiators: keyDifferentiators,
    primary_audience: primaryAudience,
    attraction_goal: attractionGoal,
    primary_content_goal:
      shorthand.primary_content_goal ??
      (/(goal|objective|want|achieve|attract|authority|lead|educat|目标|希望|吸引)/i.test(text)
        ? truncateToSentence(text)
        : undefined),
    preferred_tone:
      shorthand.preferred_tone ??
      (/(tone|voice|style|professional|casual|insightful|analytical|practical|story|语气|风格)/i.test(text)
        ? splitByComma.slice(0, 3)
        : undefined),
    desired_content_formats: formatMentions.length ? formatMentions : undefined,
    concerns: /(worry|concern|afraid|risk|fear|担心|顾虑)/i.test(text) ? splitByComma.slice(0, 3) : undefined,
    source_material_link: extractEvidenceLinks(text)[0],
  };
}

function looksLikeAffirmation(message: string): boolean {
  const raw = message.trim().toLowerCase();
  if (!raw || raw.length > 40) return false;
  const exactMatches = new Set([
    "yes",
    "yep",
    "yeah",
    "correct",
    "accurate",
    "right",
    "exactly",
    "ok",
    "okay",
    "是",
    "是的",
    "对",
    "对的",
    "没错",
    "可以",
    "准确",
    "正确",
    "完全准确",
  ]);
  if (exactMatches.has(raw)) return true;
  return /(yes that is right|sounds accurate|没问题|这样可以|这个表述准确|这个描述准确)/i.test(raw);
}

function buildFactsFromUpdates(updates: ExtractionUpdates): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const push = (fieldPath: string, value: unknown, sourceType: ExtractedFact["source_type"] = "direct") => {
    if (value === undefined) return;
    if (typeof value === "string" && !value.trim()) return;
    if (Array.isArray(value) && value.length === 0) return;
    facts.push({
      field_path: fieldPath,
      normalized_value: value,
      confidence: sourceType === "direct" ? 0.85 : 0.65,
      source_type: sourceType,
    });
  };

  push("company_profile.company_one_liner", updates.company_one_liner);
  push("company_profile.industry", updates.industry);
  push("company_profile.business_model", updates.business_model);
  push("brand_story.founding_story", updates.founding_story);
  push("brand_story.mission_statement", updates.mission_statement);
  push("brand_story.core_belief", updates.core_belief);
  push("brand_story.what_should_people_remember", updates.what_should_people_remember);
  if (updates.primary_offering) {
    push("product_service.primary_offering", {
      name: updates.primary_offering,
      type: updates.offering_type ?? "offering",
      description: updates.primary_offering,
      target_user: "",
      main_use_case: "",
      status: "partial",
    });
  }
  push("product_service.problem_solved", updates.problem_solved);
  push("product_service.key_differentiators", updates.key_differentiators);
  if (updates.primary_audience) {
    push("market_audience.primary_audience", {
      label: updates.primary_audience,
      roles: updates.audience_roles ?? [],
      industries: [],
      company_size: [],
      regions: [],
      pain_points: [],
      desired_outcomes: [],
      content_resonance_angle: "",
      status: "partial",
    });
  }
  push("market_audience.audience_roles", updates.audience_roles);
  push("market_audience.audience_pain_points", updates.audience_pain_points);
  push("market_audience.audience_desired_outcomes", updates.audience_desired_outcomes);
  push("market_audience.attraction_goal", updates.attraction_goal);
  push("linkedin_content_strategy.primary_content_goal", updates.primary_content_goal);
  push("linkedin_content_strategy.desired_content_formats", updates.desired_content_formats);
  push("linkedin_content_strategy.topics_they_want_to_talk_about", updates.topics_they_want_to_talk_about);
  push("linkedin_content_strategy.topics_to_avoid_or_deprioritize", updates.topics_to_avoid_or_deprioritize);
  push("content_preferences.preferred_tone", updates.preferred_tone);
  push("content_preferences.preferred_voice", updates.preferred_voice);
  push("content_preferences.preferred_style_tags", updates.preferred_style_tags);
  push("content_dislikes.disliked_tone", updates.disliked_tone);
  push("constraints_and_boundaries.forbidden_topics", updates.forbidden_topics);
  push("constraints_and_boundaries.claims_policy", updates.claims_policy);
  push("user_concerns.main_concerns", updates.concerns);
  push("evidence_library.case_studies", updates.case_study);
  push("evidence_library.metrics_and_proof_points", updates.metric_proof);
  push("evidence_library.assets", updates.asset);
  push("evidence_library.source_material_links", updates.source_material_link);

  return facts;
}

export async function extractAnswerTurn(params: {
  state: InterviewState;
  userMessage: string;
  fullChatHistory?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
}): Promise<ExtractionResult> {
  const { state, userMessage, fullChatHistory = [] } = params;
  const confirmations: ConfirmationSignal[] = [];
  const chatHistory = formatChatHistory(fullChatHistory);
  const heuristic = heuristicExtract(state, userMessage);
  let modelUpdates: ExtractionUpdates = {};

  if (looksLikeAffirmation(userMessage)) {
    if (state.workflow.pending_review_section_id) {
      confirmations.push({
        kind: "section_confirm",
        target_slot_id: null,
        confidence: 0.95,
      });
    }
    const pendingSlotId = state.workflow.pending_confirmation_slot_id ?? state.workflow.next_question_slot_id;
    if (pendingSlotId) {
      confirmations.push({
        kind: "slot_summary_confirm",
        target_slot_id: pendingSlotId,
        confidence: 0.9,
      });
    }
  }

  try {
    modelUpdates = await generateModelObject({
      system: extractionSystemPrompt(),
      prompt: extractionUserPrompt(
        userMessage,
        state.conversation_meta.current_focus_modules[0] ?? "company_profile",
        chatHistory,
      ),
      schema: extractionSchema,
      primaryModel: process.env.MODEL_PRIMARY ?? "gemini-3.1-flash-lite-preview",
    });
  } catch {
    modelUpdates = {};
  }

  const mergedUpdates = mergeUpdates(heuristic, modelUpdates);
  const facts = buildFactsFromUpdates(mergedUpdates);
  const evidence: ExtractionEvidenceItem[] =
    facts.length > 0
      ? facts.map((fact) => ({
          field: fact.field_path,
          snippet: userMessage.trim().slice(0, 220),
          turn_id: "pending",
        }))
      : [{
          field: state.workflow.next_question_slot_id ?? "unknown",
          snippet: userMessage.trim().slice(0, 220),
          turn_id: "pending",
        }];

  return {
    facts,
    confirmations,
    no_answer_detected: facts.length === 0 && confirmations.length === 0,
    evidence,
  };
}
