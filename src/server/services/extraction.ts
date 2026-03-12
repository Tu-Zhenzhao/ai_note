import { z } from "zod";
import { statusValue } from "@/lib/state";
import { FieldStatus, InterviewState, TurnDiagnostics, VerificationState } from "@/lib/types";
import { generateModelObject } from "@/server/model/adapters";
import { extractionSystemPrompt, extractionUserPrompt } from "@/server/prompts/extraction";
import { advanceChecklistItems } from "@/server/rules/checklist";
import { confirmPreviewSlots, getTargetFieldForSlotId } from "@/server/services/preview-slots";
import { syncWorkflowState } from "@/server/services/workflow";

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

function statusFromString(value: string) {
  if (!value.trim()) return "missing" as const;
  if (value.trim().split(/\s+/).length >= 8) return "strong" as const;
  return "partial" as const;
}

function statusFromArray(values: string[]) {
  if (!values.length) return "missing" as const;
  if (values.length >= 2) return "strong" as const;
  return "partial" as const;
}

function normalizeBusinessModel(value: string) {
  if (/both|hybrid/i.test(value)) return ["software", "service"];
  if (/software|saas|api product|platform/i.test(value)) return ["software"];
  if (/service|managed|done for you|agency/i.test(value)) return ["service"];
  return [];
}

function parseContrastChoice(state: InterviewState, message: string): Partial<ExtractionUpdates> {
  const lower = message.trim().toLowerCase();
  const focusModules = state.conversation_meta.current_focus_modules;
  const active = focusModules[0] ?? "";
  if (!active) return {};

  const optionMatch = lower.match(/^(?:option\s*)?([abc])(?:\)|\.|:)?(?:\s|$)/);
  const choice = optionMatch?.[1] ?? "";

  if (active === "company_profile" || active === "product_service") {
    if (choice === "a" || /software|saas|product/.test(lower)) return { business_model: ["software"] };
    if (choice === "b" || /service|managed/.test(lower)) return { business_model: ["service"] };
    if (choice === "c" || /both|hybrid/.test(lower)) return { business_model: ["software", "service"] };
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

function truncateToSentence(text: string, maxWords = 25): string {
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  const first = sentences[0]?.trim() ?? text.trim();
  const words = first.split(/\s+/);
  if (words.length <= maxWords) return first.endsWith(".") ? first : `${first}.`;
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function heuristicExtract(state: InterviewState, message: string): ExtractionUpdates {
  const text = message.trim();
  const splitByComma = text.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
  const formatMentions: string[] = [];
  if (/carousel/i.test(text)) formatMentions.push("LinkedIn Carousel");
  if (/long image/i.test(text)) formatMentions.push("LinkedIn Long Image");
  if (/video/i.test(text)) formatMentions.push("LinkedIn Short Video Script");
  if (/post/i.test(text)) formatMentions.push("LinkedIn Post Copy");

  const shorthand = parseContrastChoice(state, text);
  const businessModel = normalizeBusinessModel(text);

  let companyOneLiner: string | undefined;
  if (/we\s+(help|build|provide|offer|make|run|sell)/i.test(text)) {
    companyOneLiner = truncateToSentence(text);
  }

  let industry: string[] | undefined;
  const industryMatch = text.match(/(?:we\s+are|category|vertical|space)[\s:]*([^.!?]{3,40})/i);
  if (industryMatch) {
    industry = industryMatch[1].split(/[,/]/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  }

  let problemSolved: string[] | undefined;
  const problemPatterns = text.match(/(?:problem|solve|pain\s*point|challenge|struggle|issue)[\s:]+([^.!?]{5,80})/gi);
  if (problemPatterns) {
    problemSolved = problemPatterns.map((p) => truncateToSentence(p, 15)).slice(0, 3);
  }

  let keyDifferentiators: string[] | undefined;
  const diffMatch = text.match(/(?:different|unique|advantage|unlike|compared\s+to|stand\s+out)[\s:]+([^.!?]{5,80})/gi);
  if (diffMatch) {
    keyDifferentiators = diffMatch.map((d) => truncateToSentence(d, 15)).slice(0, 3);
  }

  let primaryOffering: string | undefined;
  const offeringMatch = text.match(/(?:we\s+(?:provide|offer|sell|build)|our\s+(?:product|service|platform|API))[\s:]+([^.!?]{5,80})/i);
  if (offeringMatch) {
    primaryOffering = truncateToSentence(offeringMatch[1], 20);
  }

  let missionStatement: string | undefined;
  const missionMatch = text.match(/(?:we\s+exist\s+to|our\s+mission|purpose\s+is)[\s:]+([^.!?]{5,80})/i);
  if (missionMatch) {
    missionStatement = truncateToSentence(missionMatch[1], 20);
  }

  let coreBelief: string | undefined;
  const beliefMatch = text.match(
    /(?:we\s+believe|core\s+belief|our\s+belief|what\s+drives\s+us|our\s+approach\s+is)[\s:]+([^.!?]{5,100})/i,
  );
  if (beliefMatch) {
    coreBelief = truncateToSentence(beliefMatch[1], 20);
  }

  let whatShouldPeopleRemember: string | undefined;
  const rememberMatch = text.match(
    /(?:what\s+people\s+should\s+remember|remember\s+(?:most)?|known\s+for|main\s+takeaway)[\s:]+([^.!?]{5,100})/i,
  );
  if (rememberMatch) {
    whatShouldPeopleRemember = truncateToSentence(rememberMatch[1], 20);
  }

  let foundingStory: string | undefined;
  const foundingMatch = text.match(/(?:started|founded|began|created|launched|born|origin)[\s:]+([^.!?]{5,100})/i);
  if (foundingMatch) {
    foundingStory = truncateToSentence(foundingMatch[1], 25);
  }

  let primaryAudience: string | undefined;
  const audienceMatch = text.match(/(?:our\s+(?:users?|customers?|clients?|audience)|we\s+serve|target\s+(?:companies|teams|buyers)|for\s+(?:companies|businesses|teams))[\s:]+([^.!?]{5,80})/i);
  if (audienceMatch) {
    primaryAudience = truncateToSentence(audienceMatch[1], 20);
  }

  let audiencePainPoints: string[] | undefined;
  const painMatch = text.match(/(?:they\s+(?:struggle|need|want|used\s+to)|pain|manual|time[- ]consuming|tedious|difficult)[\s:]+([^.!?]{5,80})/gi);
  if (painMatch) {
    audiencePainPoints = painMatch.map((p) => truncateToSentence(p, 15)).slice(0, 3);
  }

  let audienceDesiredOutcomes: string[] | undefined;
  const outcomeMatch = text.match(/(?:they\s+(?:want|need|expect|hope|wish)|so\s+they\s+can|save\s+(?:time|money|effort)|instant|faster|easier|efficient)[\s:]*([^.!?]{5,80})/gi);
  if (outcomeMatch) {
    audienceDesiredOutcomes = outcomeMatch.map((p) => truncateToSentence(p, 15)).slice(0, 3);
  }

  let attractionGoal: string | undefined;
  const attractMatch = text.match(/(?:attract|reach|connect\s+with)\s+([^.!?]{5,60})(?:\s+on\s+linkedin|\s+via\s+linkedin|$)/i);
  if (attractMatch) {
    attractionGoal = truncateToSentence(attractMatch[1], 15);
  }

  return {
    ...shorthand,
    company_one_liner: companyOneLiner,
    industry,
    business_model: shorthand.business_model ?? (businessModel.length ? businessModel : undefined),
    primary_offering: primaryOffering,
    founding_story: foundingStory,
    mission_statement: missionStatement,
    core_belief: coreBelief,
    what_should_people_remember: whatShouldPeopleRemember,
    problem_solved: problemSolved,
    key_differentiators: keyDifferentiators,
    primary_audience: primaryAudience,
    audience_pain_points: audiencePainPoints,
    audience_desired_outcomes: audienceDesiredOutcomes,
    attraction_goal: attractionGoal,
    primary_content_goal:
      shorthand.primary_content_goal ??
      (/(goal|objective|want|achieve|attract|authority|lead|educat)/i.test(text) ? truncateToSentence(text) : undefined),
    preferred_tone:
      shorthand.preferred_tone ??
      (/(tone|voice|style|professional|casual|insightful|analytical|practical|story)/i.test(text)
        ? splitByComma.slice(0, 3)
        : undefined),
    desired_content_formats: formatMentions.length ? formatMentions : undefined,
    concerns: /(worry|concern|afraid|risk|fear)/i.test(text) ? splitByComma.slice(0, 3) : undefined,
    source_material_link: extractEvidenceLinks(text)[0],
  };
}

function arraysDifferent(a: string[], b: string[]) {
  if (a.length !== b.length) return true;
  const normA = [...a].sort().join("|");
  const normB = [...b].sort().join("|");
  return normA !== normB;
}

function registerConflict(state: InterviewState, field: string, oldValue: string[], newValue: string[]) {
  const now = new Date().toISOString();
  const existing = state.system_assessment.pending_conflicts.find(
    (item) => item.field === field && item.status === "pending",
  );
  const values = [oldValue.join("/"), newValue.join("/")];
  if (existing) {
    existing.conflicting_values = Array.from(new Set([...existing.conflicting_values, ...values]));
    existing.updated_at = now;
    return;
  }
  state.system_assessment.pending_conflicts.push({
    field,
    conflicting_values: values,
    status: "pending",
    asks: 0,
    created_at: now,
    updated_at: now,
  });
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
    if (value !== undefined) out[key] = value;
  }
  return out as ExtractionUpdates;
}

function isLikelyDirectAnswer(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (/(not sure|i don't know|idk|maybe|not certain|skip)/i.test(normalized)) return false;
  return true;
}

function applyExtraction(
  state: InterviewState,
  updates: ExtractionUpdates,
  sourceTurnId: string,
  isModelExtracted: boolean,
  rawUserMessage: string,
) {
  const capturedFields: string[] = [];
  const assistantInferences: string[] = [];
  const conflicts: string[] = [];
  const now = new Date().toISOString();
  const activeSlotId = state.workflow?.next_question_slot_id ?? null;
  const activeTargetField = activeSlotId
    ? getTargetFieldForSlotId(state, activeSlotId)
    : null;
  const directAnswerForActiveTarget = isLikelyDirectAnswer(rawUserMessage);
  const shouldConfirmField = (fieldKey: string) =>
    directAnswerForActiveTarget &&
    !!activeTargetField &&
    fieldKey === activeTargetField;
  const normalizeStatusForActiveTarget = (fieldKey: string, status: FieldStatus): FieldStatus => {
    if (shouldConfirmField(fieldKey) && status === "partial") {
      return "strong";
    }
    return status;
  };

  const verState: VerificationState = isModelExtracted ? "ai_inferred" : "unverified";

  const setString = (
    fieldKey: string,
    target: { value: string; status: string; verification_state?: string; source_turn_ids?: string[]; last_updated_at?: string },
    value: string,
  ) => {
    const changed = target.value !== value;
    target.value = value;
    target.status = normalizeStatusForActiveTarget(fieldKey, statusFromString(value));
    target.verification_state = shouldConfirmField(fieldKey)
      ? "user_confirmed"
      : verState;
    target.source_turn_ids = [...(target.source_turn_ids ?? []), sourceTurnId];
    target.last_updated_at = now;
    if (changed) capturedFields.push(fieldKey);
  };

  const setArray = (
    fieldKey: string,
    target: { value: string[]; status: string; verification_state?: string; source_turn_ids?: string[]; last_updated_at?: string },
    value: string[],
  ) => {
    const changed = arraysDifferent(target.value, value);
    target.value = value;
    target.status = normalizeStatusForActiveTarget(fieldKey, statusFromArray(value));
    target.verification_state = shouldConfirmField(fieldKey)
      ? "user_confirmed"
      : verState;
    target.source_turn_ids = [...(target.source_turn_ids ?? []), sourceTurnId];
    target.last_updated_at = now;
    if (changed) capturedFields.push(fieldKey);
  };

  if (updates.company_one_liner) {
    setString("company_profile.company_one_liner", state.company_profile.company_one_liner, updates.company_one_liner);
    if (state.company_profile.company_name.status === "missing") {
      const match = updates.company_one_liner.match(/^([A-Z][A-Za-z0-9\s&-]{1,40})\s+(is|helps|builds|provides)/);
      if (match) {
        state.company_profile.company_name = statusValue(match[1].trim(), "partial");
        state.company_profile.company_name.verification_state = verState;
        capturedFields.push("company_profile.company_name");
      }
    }
  }

  if (updates.industry?.length) setArray("company_profile.industry", state.company_profile.industry, updates.industry);
  if (updates.business_model?.length) {
    const current = state.company_profile.business_model.value;
    if (current.length > 0 && arraysDifferent(current, updates.business_model)) {
      registerConflict(state, "company_profile.business_model", current, updates.business_model);
      conflicts.push("company_profile.business_model");
    }
    setArray("company_profile.business_model", state.company_profile.business_model, updates.business_model);
  }

  if (updates.founding_story) setString("brand_story.founding_story", state.brand_story.founding_story, updates.founding_story);
  if (updates.mission_statement) setString("brand_story.mission_statement", state.brand_story.mission_statement, updates.mission_statement);
  if (updates.core_belief) {
    setString("brand_story.core_belief", state.brand_story.core_belief, updates.core_belief);
  }
  if (updates.what_should_people_remember) {
    setString(
      "brand_story.what_should_people_remember",
      state.brand_story.what_should_people_remember,
      updates.what_should_people_remember,
    );
  }

  if (updates.primary_offering) {
    const changed = state.product_service.primary_offering.value?.name !== updates.primary_offering;
    state.product_service.primary_offering.value = {
      name: updates.primary_offering,
      type: updates.offering_type ?? "offering",
      description: updates.primary_offering,
      target_user: "",
      main_use_case: "",
      status: statusFromString(updates.primary_offering),
    };
    state.product_service.primary_offering.status = statusFromString(updates.primary_offering);
    state.product_service.primary_offering.verification_state = verState;
    state.product_service.primary_offering.source_turn_ids = [
      ...(state.product_service.primary_offering.source_turn_ids ?? []),
      sourceTurnId,
    ];
    state.product_service.primary_offering.last_updated_at = now;
    if (changed) capturedFields.push("product_service.primary_offering");
  }

  if (updates.problem_solved?.length) setArray("product_service.problem_solved", state.product_service.problem_solved, updates.problem_solved);
  if (updates.key_differentiators?.length) setArray("product_service.key_differentiators", state.product_service.key_differentiators, updates.key_differentiators);

  if (updates.primary_audience) {
    const changed = state.market_audience.primary_audience.value?.label !== updates.primary_audience;
    state.market_audience.primary_audience.value = {
      label: updates.primary_audience,
      roles: updates.audience_roles ?? [],
      industries: [],
      company_size: [],
      regions: [],
      pain_points: [],
      desired_outcomes: [],
      content_resonance_angle: "",
      status: statusFromString(updates.primary_audience),
    };
    state.market_audience.primary_audience.status = normalizeStatusForActiveTarget(
      "market_audience.primary_audience",
      statusFromString(updates.primary_audience),
    );
    state.market_audience.primary_audience.verification_state = shouldConfirmField(
      "market_audience.primary_audience",
    )
      ? "user_confirmed"
      : verState;
    state.market_audience.primary_audience.last_updated_at = now;
    if (changed) capturedFields.push("market_audience.primary_audience");
  }

  if (updates.audience_roles?.length) setArray("market_audience.audience_roles", state.market_audience.audience_roles, updates.audience_roles);
  if (updates.audience_pain_points?.length) setArray("market_audience.audience_pain_points", state.market_audience.audience_pain_points, updates.audience_pain_points);
  if (updates.audience_desired_outcomes?.length) {
    setArray(
      "market_audience.audience_desired_outcomes",
      state.market_audience.audience_desired_outcomes,
      updates.audience_desired_outcomes,
    );
  } else if (state.market_audience.audience_desired_outcomes.value.length === 0 && updates.audience_pain_points?.length) {
    const inferred = updates.audience_pain_points.slice(0, 1).map((pain) => {
      const cleaned = pain.replace(/^(?:they\s+)?(?:struggle|need|have\s+to|used\s+to)\s+/i, "").trim();
      return `Solve: ${truncateToSentence(cleaned, 10)}`;
    });
    setArray("market_audience.audience_desired_outcomes", state.market_audience.audience_desired_outcomes, inferred);
  }
  if (updates.attraction_goal) setString("market_audience.attraction_goal", state.market_audience.attraction_goal, updates.attraction_goal);

  if (updates.primary_content_goal) {
    const oldValue = state.linkedin_content_strategy.primary_content_goal.value;
    if (oldValue && oldValue !== updates.primary_content_goal) {
      state.system_assessment.pending_conflicts.push({
        field: "linkedin_content_strategy.primary_content_goal",
        conflicting_values: [oldValue, updates.primary_content_goal],
        status: "pending",
        asks: 0,
        created_at: now,
        updated_at: now,
      });
      conflicts.push("linkedin_content_strategy.primary_content_goal");
    }
    setString(
      "linkedin_content_strategy.primary_content_goal",
      state.linkedin_content_strategy.primary_content_goal,
      updates.primary_content_goal,
    );
  }
  if (updates.desired_content_formats?.length) {
    setArray(
      "linkedin_content_strategy.desired_content_formats",
      state.linkedin_content_strategy.desired_content_formats,
      updates.desired_content_formats,
    );
  }
  if (updates.topics_they_want_to_talk_about?.length) {
    setArray(
      "linkedin_content_strategy.topics_they_want_to_talk_about",
      state.linkedin_content_strategy.topics_they_want_to_talk_about,
      updates.topics_they_want_to_talk_about,
    );
  }
  if (updates.topics_to_avoid_or_deprioritize?.length) {
    setArray(
      "linkedin_content_strategy.topics_to_avoid_or_deprioritize",
      state.linkedin_content_strategy.topics_to_avoid_or_deprioritize,
      updates.topics_to_avoid_or_deprioritize,
    );
  }

  if (updates.preferred_tone?.length) setArray("content_preferences.preferred_tone", state.content_preferences.preferred_tone, updates.preferred_tone);
  if (updates.preferred_voice?.length) setArray("content_preferences.preferred_voice", state.content_preferences.preferred_voice, updates.preferred_voice);
  if (updates.preferred_style_tags?.length) setArray("content_preferences.preferred_style_tags", state.content_preferences.preferred_style_tags, updates.preferred_style_tags);

  if (updates.disliked_tone?.length) setArray("content_dislikes.disliked_tone", state.content_dislikes.disliked_tone, updates.disliked_tone);

  if (updates.forbidden_topics?.length) setArray("constraints_and_boundaries.forbidden_topics", state.constraints_and_boundaries.forbidden_topics, updates.forbidden_topics);
  if (updates.claims_policy) setString("constraints_and_boundaries.claims_policy", state.constraints_and_boundaries.claims_policy, updates.claims_policy);

  if (updates.concerns?.length) setArray("user_concerns.main_concerns", state.user_concerns.main_concerns, updates.concerns);

  if (updates.case_study) {
    state.evidence_library.case_studies.value = [
      ...state.evidence_library.case_studies.value,
      {
        title: updates.case_study.slice(0, 60),
        client_type: "",
        problem: updates.case_study,
        solution: "",
        result: "",
        metrics: [],
        permission_level: "public",
        status: "partial",
      },
    ];
    state.evidence_library.case_studies.status = "partial";
    state.evidence_library.case_studies.verification_state = verState;
    capturedFields.push("evidence_library.case_studies");
  }

  if (updates.metric_proof) {
    state.evidence_library.metrics_and_proof_points.value = [
      ...state.evidence_library.metrics_and_proof_points.value,
      {
        metric_name: "Reported metric",
        metric_value: updates.metric_proof,
        metric_context: "User provided",
        timeframe: "",
        confidence_level: "medium",
        can_publish_publicly: true,
        status: "partial",
      },
    ];
    state.evidence_library.metrics_and_proof_points.status = "partial";
    state.evidence_library.metrics_and_proof_points.verification_state = verState;
    capturedFields.push("evidence_library.metrics_and_proof_points");
  }

  if (updates.asset) {
    state.evidence_library.assets.value = [
      ...state.evidence_library.assets.value,
      {
        asset_type: "general",
        asset_name: updates.asset.slice(0, 60),
        description: updates.asset,
        link_or_storage_ref: null,
        usable_for_formats: ["LinkedIn Carousel"],
        usage_limitations: [],
        status: "partial",
      },
    ];
    state.evidence_library.assets.status = "partial";
    state.evidence_library.assets.verification_state = verState;
    capturedFields.push("evidence_library.assets");
  }

  if (updates.source_material_link) {
    state.evidence_library.source_material_links = [
      ...state.evidence_library.source_material_links,
      {
        label: updates.source_material_link,
        url: updates.source_material_link,
        material_type: "link",
        relevance_note: "user shared",
        status: "partial",
      },
    ];
    capturedFields.push("evidence_library.source_material_links");
  }

  if (
    activeSlotId &&
    activeTargetField &&
    capturedFields.includes(activeTargetField) &&
    shouldConfirmField(activeTargetField)
  ) {
    confirmPreviewSlots(state, [activeSlotId]);
  }

  // Cross-map: founding_story ONLY from mission_statement (not from one-liner — those are different things)
  if (updates.mission_statement && state.brand_story.founding_story.status === "missing") {
    setString("brand_story.founding_story", state.brand_story.founding_story, updates.mission_statement);
  }
  if (state.brand_story.origin_context.status === "missing" && updates.founding_story) {
    setString("brand_story.origin_context", state.brand_story.origin_context, updates.founding_story);
  }

  // Cross-map: key_differentiators ONLY from explicit user language (not inferred from offering)
  if (state.product_service.key_differentiators.value.length === 0 &&
      !(updates.key_differentiators && updates.key_differentiators.length > 0)) {
    const diffPatterns = rawUserMessage.match(
      /(?:(?:primary\s+)?(?:difference|differentiator)|what\s+(?:sets?\s+us|makes?\s+(?:us|it))\s+(?:apart|different|unique)|unlike\s+(?:other|existing|competitor)|one[- ]stop\s+shop|not?\s+(?:just|only)\s+[^.!?]+(?:but\s+also|and\s+also))[^.!?]*/gi,
    );
    if (diffPatterns && diffPatterns.length > 0) {
      const diffs = diffPatterns
        .map((p) => truncateToSentence(p.trim().replace(/^[,;\s]+/, ""), 15))
        .filter((d) => d.length > 5)
        .slice(0, 3);
      if (diffs.length > 0) {
        setArray("product_service.key_differentiators", state.product_service.key_differentiators, diffs);
      }
    }
  }

  const readiness = state.content_readiness;
  if (updates.primary_content_goal && readiness.ai_suggested_first_content_goal.status === "missing") {
    readiness.ai_suggested_first_content_goal = statusValue(
      `Support goal: ${updates.primary_content_goal}`,
      "partial",
      true,
      "ai_inferred",
    );
    assistantInferences.push("content_readiness.ai_suggested_first_content_goal");
    capturedFields.push("content_readiness.ai_suggested_first_content_goal");
  }
  if (updates.desired_content_formats?.length && readiness.ai_suggested_first_content_format.status === "missing") {
    readiness.ai_suggested_first_content_format = statusValue(updates.desired_content_formats[0], "partial", true, "ai_inferred");
    assistantInferences.push("content_readiness.ai_suggested_first_content_format");
    capturedFields.push("content_readiness.ai_suggested_first_content_format");
  }
  if (updates.topics_they_want_to_talk_about?.length && readiness.ai_suggested_first_content_topic.status === "missing") {
    readiness.ai_suggested_first_content_topic = statusValue(updates.topics_they_want_to_talk_about[0], "partial", true, "ai_inferred");
    assistantInferences.push("content_readiness.ai_suggested_first_content_topic");
    capturedFields.push("content_readiness.ai_suggested_first_content_topic");
  }

  return {
    capturedFields: Array.from(new Set(capturedFields)),
    assistantInferences: Array.from(new Set(assistantInferences)),
    conflicts: Array.from(new Set(conflicts)),
  };
}

export async function extractStructuredUpdates(params: {
  state: InterviewState;
  userMessage: string;
  sourceTurnId: string;
}) {
  const { state, userMessage, sourceTurnId } = params;
  const evidenceLinks = extractEvidenceLinks(userMessage);
  const heuristic = heuristicExtract(state, userMessage);
  let modelUpdates: ExtractionUpdates = {};
  let usedModelExtraction = false;

  try {
    modelUpdates = await generateModelObject({
      system: extractionSystemPrompt(),
      prompt: extractionUserPrompt(userMessage, state.conversation_meta.current_focus_modules[0] ?? "company_profile"),
      schema: extractionSchema,
      primaryModel: process.env.MODEL_PRIMARY ?? "gemini-3.1-flash-lite-preview",
    });
    usedModelExtraction = true;
    console.log("[extraction] Model extraction succeeded:", JSON.stringify(modelUpdates).slice(0, 300));
  } catch (err) {
    console.error("[extraction] Model extraction FAILED, using heuristic only:", err instanceof Error ? err.message : err);
    modelUpdates = {};
  }

  const updates = mergeUpdates(heuristic, modelUpdates);
  const applied = applyExtraction(state, updates, sourceTurnId, usedModelExtraction, userMessage);

  const currentSectionIndex = state.conversation_meta.current_section_index;
  const advancedChecklist = advanceChecklistItems(state, applied.capturedFields, sourceTurnId, currentSectionIndex);

  const diagnostics: TurnDiagnostics = {
    direct_user_facts: [userMessage],
    assistant_inferences: applied.assistantInferences,
    evidence_links: evidenceLinks,
    confidence: applied.capturedFields.length > 0 ? 0.85 : 0.45,
    captured_fields_this_turn: applied.capturedFields,
    captured_checklist_items_this_turn: advancedChecklist,
    deferred_fields: state.system_assessment.last_turn_diagnostics.deferred_fields,
    conflicts_detected: applied.conflicts,
    question_reason: state.system_assessment.last_turn_diagnostics.question_reason || "extraction_update",
    tool_actions_used: usedModelExtraction ? ["model_extraction"] : ["heuristic_extraction"],
  };

  state.system_assessment.last_turn_diagnostics = diagnostics;
  state.system_assessment.state_updates_this_turn = applied.capturedFields;
  syncWorkflowState(state);

  console.log("[extraction] Captured fields:", applied.capturedFields);
  console.log("[extraction] Advanced checklist items:", advancedChecklist);
  console.log("[extraction] Conflicts:", applied.conflicts);

  return { updates, diagnostics };
}
