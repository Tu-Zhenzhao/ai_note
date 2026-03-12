import { FATIGUE_PRIORITY_MODULES } from "@/lib/state";
import { FollowUpExitStatus, InterviewState, PreviewSlot, QuestionType } from "@/lib/types";
import { selectNextPreviewSlot, syncPreviewSlots } from "@/server/services/preview-slots";

interface FieldStrategy {
  field: string;
  module: string;
  checklistItemId: string;
  maxAttempts: number;
  questionLadder: QuestionType[];
  fallbackQuestionType: QuestionType;
  promptByType: Partial<Record<QuestionType, string>>;
}

export interface FollowUpPlan {
  nextQuestion: string;
  questionType: QuestionType;
  targetField: string;
  questionReason: string;
  exitStatus: FollowUpExitStatus;
  deferredFields: string[];
}

/**
 * v3: Ladders are fallback tools, not the main runtime logic.
 * These exist to help the system recover clarity when a critical area remains weak.
 */
const STRATEGIES: FieldStrategy[] = [
  {
    field: "company_profile.company_one_liner",
    module: "company_profile",
    checklistItemId: "cp_what_does_company_do",
    maxAttempts: 3,
    questionLadder: ["open", "clarify", "example", "ai_suggest", "confirm"],
    fallbackQuestionType: "contrast",
    promptByType: {
      open: "Could you briefly describe what your company does?",
      clarify: "What is the main thing your company helps customers achieve?",
      example: "If someone asked what your company does in one sentence, what would you say?",
      ai_suggest: "Based on what you shared, it sounds like your company helps [audience] by [offering]. Does that feel accurate?",
      confirm: "So your company mainly focuses on [focus] - correct?",
      contrast: "Closest fit: A) software B) service C) both?",
    },
  },
  {
    field: "brand_story.core_belief",
    module: "brand_story",
    checklistItemId: "bs_what_believe",
    maxAttempts: 3,
    questionLadder: ["open", "clarify", "example", "ai_suggest", "confirm"],
    fallbackQuestionType: "contrast",
    promptByType: {
      open: "What core belief drives the company, and what do you want people to remember most about your approach?",
      clarify: "Beyond the product itself, what is the deeper belief or principle behind how you do this?",
      example: "If someone remembered one thing about your approach, what would you want that to be?",
      ai_suggest: "It sounds like the company is driven by [belief] and wants to be remembered for [approach]. Is that right?",
      confirm: "So the core belief is [belief], and the memorable takeaway is [approach] - correct?",
      contrast: "Closest fit: A) speed B) accuracy C) flexibility D) something else?",
    },
  },
  {
    field: "product_service.primary_offering",
    module: "product_service",
    checklistItemId: "ps_main_offering",
    maxAttempts: 3,
    questionLadder: ["open", "clarify", "example", "ai_suggest", "confirm"],
    fallbackQuestionType: "contrast",
    promptByType: {
      open: "What are the main products or services you offer?",
      clarify: "What specific problem does your product solve?",
      example: "Could you walk me through what a typical customer gets when using your product?",
      ai_suggest: "So your main offering is [offering] which helps customers [outcome]. Does that capture it?",
      confirm: "So the core value of your product is [value] - right?",
      contrast: "Would you say your offer is mostly A) done-for-you service B) software product C) hybrid?",
    },
  },
  {
    field: "market_audience.primary_audience",
    module: "market_audience",
    checklistItemId: "ma_primary_audience",
    maxAttempts: 3,
    questionLadder: ["open", "clarify", "contrast", "example", "ai_suggest", "confirm"],
    fallbackQuestionType: "narrow",
    promptByType: {
      open: "Who are the people or companies you mainly want to reach?",
      clarify: "What kind of problems do these people usually face?",
      contrast: "Are your customers closer to [option A] or [option B]?",
      example: "Can you describe a typical customer who benefits most from your product?",
      ai_suggest: "It sounds like your main audience might be [audience]. Does that match your experience?",
      confirm: "So your primary audience is [audience] - correct?",
      narrow: "Would it be most accurate to focus first on one specific role and company size?",
    },
  },
  {
    field: "linkedin_content_strategy.primary_content_goal",
    module: "linkedin_content_strategy",
    checklistItemId: "lcs_what_achieve",
    maxAttempts: 3,
    questionLadder: ["open", "clarify", "contrast", "example", "ai_suggest", "confirm"],
    fallbackQuestionType: "contrast",
    promptByType: {
      open: "What do you mainly hope LinkedIn content will help you achieve?",
      clarify: "Is the goal more about attracting customers, building authority, or something else?",
      contrast: "Would success look more like A) more inbound leads or B) stronger industry reputation?",
      example: "Have you seen a LinkedIn strategy from another company that you admire?",
      ai_suggest: "It sounds like your primary goal might be [goal]. Would you say that is right?",
      confirm: "So LinkedIn content should primarily help you [goal] - correct?",
    },
  },
  {
    field: "evidence_library.case_studies",
    module: "evidence_library",
    checklistItemId: "ev_proof",
    maxAttempts: 3,
    questionLadder: ["open", "clarify", "example", "proof_request", "ai_suggest", "confirm"],
    fallbackQuestionType: "contrast",
    promptByType: {
      open: "Do you have any cases, results, or milestones showing the impact of your work?",
      clarify: "Have you helped clients achieve measurable results?",
      example: "For example: customer stories, growth milestones, or product breakthroughs.",
      proof_request: "Do you have numbers, screenshots, or case studies we can use as proof?",
      ai_suggest: "Even a simple milestone like 'first 100 customers' can work as content proof.",
      confirm: "So we can use [proof point] as one supporting proof element - correct?",
      contrast: "What is easiest to share first: A) a case B) a metric C) a milestone?",
    },
  },
  {
    field: "content_preferences.preferred_tone",
    module: "content_preferences",
    checklistItemId: "cpref_feel",
    maxAttempts: 3,
    questionLadder: ["open", "clarify", "contrast", "example", "ai_suggest", "confirm"],
    fallbackQuestionType: "contrast",
    promptByType: {
      open: "What kind of tone would you like your content to have?",
      clarify: "Should it feel more professional, conversational, or insightful?",
      contrast: "Closer to A) analytical thought leadership B) practical advice C) storytelling?",
      example: "Are there LinkedIn creators whose style you like?",
      ai_suggest: "It sounds like the preferred tone may be [tone]. Does that feel right?",
      confirm: "So your preferred tone is [tone] - correct?",
    },
  },
  {
    field: "constraints_and_boundaries.forbidden_topics",
    module: "constraints_and_boundaries",
    checklistItemId: "cb_not_said",
    maxAttempts: 3,
    questionLadder: ["open", "clarify", "example", "ai_suggest", "confirm"],
    fallbackQuestionType: "narrow",
    promptByType: {
      open: "Are there topics you prefer not to discuss publicly?",
      clarify: "Are there claims or information you must avoid sharing?",
      example: "For example: pricing details, internal strategy, or customer names.",
      ai_suggest: "So we should avoid discussing [topic] - correct?",
      confirm: "These boundaries sound accurate?",
      narrow: "Should we assume conservative boundaries until each sensitive area is approved by you?",
    },
  },
  {
    field: "user_concerns.main_concerns",
    module: "user_concerns",
    checklistItemId: "uc_worries",
    maxAttempts: 3,
    questionLadder: ["open", "clarify", "example", "ai_suggest", "confirm"],
    fallbackQuestionType: "contrast",
    promptByType: {
      open: "What worries you most about creating LinkedIn content?",
      clarify: "Is it more about time, quality, or positioning?",
      example: "Have you tried LinkedIn content before? What did not work?",
      ai_suggest: "It sounds like your biggest challenge may be [challenge].",
      confirm: "Is that accurate?",
      contrast: "Which is highest priority now: A) quality B) consistency C) positioning?",
    },
  },
];

function getFieldStatus(state: InterviewState, path: string) {
  const segments = path.split(".");
  let current: unknown = state;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return "missing";
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (current && typeof current === "object" && "status" in current) {
    return String((current as { status: string }).status);
  }
  return "missing";
}

function hasPendingConflict(state: InterviewState, field: string) {
  return state.system_assessment.pending_conflicts.find(
    (conflict) => conflict.field === field && conflict.status === "pending",
  );
}

function summarizeCheckpointBridge(state: InterviewState) {
  const company = state.company_profile.company_one_liner.value || "still being refined";
  const audience = state.market_audience.primary_audience.value?.label ?? "still being refined";
  const goal = state.linkedin_content_strategy.primary_content_goal.value || "still being refined";
  return `Quick checkpoint: company = ${company}; audience = ${audience}; LinkedIn goal = ${goal}. Does this summary look right before we continue?`;
}

/**
 * v3: Global planner evaluates full checklist state first.
 * If the best checklist target maps to a known strategy, use that ladder.
 * Otherwise derive a question from the checklist item itself.
 */
function resolveStrategyFromChecklist(state: InterviewState, skipField?: string): FieldStrategy | null {
  syncPreviewSlots(state);
  const nextSlot = selectNextPreviewSlot(state);
  if (!nextSlot) return null;
  return STRATEGIES.find(
    (strategy) => strategy.field === nextSlot.question_target_field && strategy.field !== skipField,
  ) ?? null;
}

function resolveStrategyByModule(state: InterviewState, skipField?: string) {
  const moduleMap = state.system_assessment.module_completion_map;
  const fatigue = state.system_assessment.user_fatigue_risk;
  const candidates = fatigue === "high" ? [...FATIGUE_PRIORITY_MODULES] : Object.keys(moduleMap);

  for (const module of candidates) {
    if (moduleMap[module] === "not_started" || moduleMap[module] === "partial") {
      const strategy = STRATEGIES.find((item) => item.module === module && item.field !== skipField);
      if (strategy) return strategy;
    }
  }

  return STRATEGIES.find((item) => item.field !== skipField) ?? STRATEGIES[0];
}

function resolveActiveStrategy(state: InterviewState): FieldStrategy {
  // v3: checklist-driven selection first
  const checklistStrategy = resolveStrategyFromChecklist(state);
  if (checklistStrategy) return checklistStrategy;

  // Fallback: module-based selection
  return resolveStrategyByModule(state);
}

function buildGenericSlotQuestion(slot: PreviewSlot, attempt: number): {
  nextQuestion: string;
  questionType: QuestionType;
  questionReason: string;
} {
  if (attempt <= 0) {
    return {
      nextQuestion: slot.question_label,
      questionType: "open",
      questionReason: `preview_slot_missing:${slot.id}`,
    };
  }
  if (attempt === 1) {
    return {
      nextQuestion: `${slot.question_label} A short answer is enough.`,
      questionType: "clarify",
      questionReason: `preview_slot_weak:${slot.id}`,
    };
  }
  return {
    nextQuestion: `Based on what you shared, can I summarize this as: ${slot.label}?`,
    questionType: "confirm",
    questionReason: `preview_slot_confirm:${slot.id}`,
  };
}

function decideExitStatus(params: {
  status: string;
  attempts: number;
  maxAttempts: number;
  fatigue: "low" | "medium" | "high";
}): FollowUpExitStatus {
  if (params.status === "strong" || params.status === "verified") return "resolved";
  if (params.attempts >= params.maxAttempts && params.fatigue !== "low") return "defer_and_continue";
  if (params.attempts >= params.maxAttempts) return "good_enough_for_now";
  return "good_enough_for_now";
}

function guidedOptionsQuestion(strategy: FieldStrategy) {
  if (strategy.field === "linkedin_content_strategy.primary_content_goal") {
    return "If easier, pick the closest option now: A) attract customers B) build authority C) educate market D) another goal.";
  }
  if (strategy.field === "company_profile.company_one_liner") {
    return "If easier, pick the closest fit: A) software B) service C) both. You can add one line after.";
  }
  return "If easier, pick the closest option first and we can refine it in one sentence.";
}

export function planFollowUp(state: InterviewState): FollowUpPlan {
  syncPreviewSlots(state);
  const nextSlot = selectNextPreviewSlot(state);
  if (nextSlot) {
    const strategy = STRATEGIES.find(
      (item) => item.field === nextSlot.question_target_field,
    );
    if (!strategy) {
      const attempts =
        state.system_assessment.follow_up_attempts[nextSlot.question_target_field]
          ?.attempts ?? 0;
      const generic = buildGenericSlotQuestion(nextSlot, attempts);
      state.system_assessment.follow_up_attempts[nextSlot.question_target_field] = {
        attempts: attempts + 1,
        last_question_type: generic.questionType,
        last_asked_at: new Date().toISOString(),
      };
      state.conversation_meta.current_focus_modules = [
        nextSlot.question_target_field.split(".")[0],
      ];
      state.system_assessment.recommended_next_question = generic.nextQuestion;
      state.system_assessment.last_turn_diagnostics.question_reason =
        generic.questionReason;
      return {
        nextQuestion: generic.nextQuestion,
        questionType: generic.questionType,
        targetField: nextSlot.question_target_field,
        questionReason: generic.questionReason,
        exitStatus: "good_enough_for_now",
        deferredFields: [...state.system_assessment.last_turn_diagnostics.deferred_fields],
      };
    }
  }

  const deferredFields = [...state.system_assessment.last_turn_diagnostics.deferred_fields];
  let strategy = resolveActiveStrategy(state);
  let tracker = state.system_assessment.follow_up_attempts[strategy.field] ?? { attempts: 0 };
  const fieldStatus = getFieldStatus(state, strategy.field);
  let exitStatus = decideExitStatus({
    status: fieldStatus,
    attempts: tracker.attempts,
    maxAttempts: strategy.maxAttempts,
    fatigue: state.system_assessment.user_fatigue_risk,
  });

  if (exitStatus === "resolved") {
    const next = resolveStrategyByModule(state, strategy.field);
    strategy = next;
    tracker = state.system_assessment.follow_up_attempts[strategy.field] ?? { attempts: 0 };
    exitStatus = "resolved";
  } else if (exitStatus === "defer_and_continue") {
    deferredFields.push(strategy.field);
    const next = resolveStrategyByModule(state, strategy.field);
    strategy = next;
    tracker = state.system_assessment.follow_up_attempts[strategy.field] ?? { attempts: 0 };
  }

  const pendingConflict = hasPendingConflict(state, strategy.field);
  if (pendingConflict && pendingConflict.asks < 1) {
    pendingConflict.asks += 1;
    pendingConflict.updated_at = new Date().toISOString();
    const nextQuestion = `I heard two versions for this area: ${pendingConflict.conflicting_values.join(" vs ")}. Which one should I use going forward?`;
    state.system_assessment.recommended_next_question = nextQuestion;
    state.conversation_meta.current_focus_modules = [strategy.module];
    state.system_assessment.last_follow_up_exit_status = "good_enough_for_now";
    state.system_assessment.last_turn_diagnostics.question_reason = "resolve_conflict";
    return {
      nextQuestion,
      questionType: "confirm",
      targetField: strategy.field,
      questionReason: "resolve_conflict",
      exitStatus: "good_enough_for_now",
      deferredFields,
    };
  }

  if (pendingConflict && pendingConflict.asks >= 1) {
    pendingConflict.status = "downgraded";
    pendingConflict.updated_at = new Date().toISOString();
  }

  let questionType: QuestionType;
  if (tracker.attempts >= strategy.maxAttempts) {
    questionType =
      state.system_assessment.user_fatigue_risk === "high"
        ? "contrast"
        : strategy.fallbackQuestionType;
  } else {
    questionType = strategy.questionLadder[Math.min(tracker.attempts, strategy.questionLadder.length - 1)];
  }

  const loopGuard = state.system_assessment.loop_guard;
  const capturedCount = state.system_assessment.last_turn_diagnostics.captured_fields_this_turn.length;
  const samePattern = loopGuard.target_field === strategy.field && loopGuard.question_type === questionType;
  const staleTurns = capturedCount === 0 && samePattern ? loopGuard.stale_turns + 1 : 0;

  let questionReason = "resolve_highest_priority_gap";
  let nextQuestion =
    strategy.promptByType[questionType] ??
    "Could you share one specific example so I can make this more concrete and accurate?";

  if (state.system_assessment.user_fatigue_risk !== "low" && tracker.attempts >= strategy.maxAttempts) {
    nextQuestion = guidedOptionsQuestion(strategy);
    questionType = "contrast";
    questionReason = "fatigue_guided_options";
  }

  if (capturedCount === 0 && samePattern && questionType === "contrast" && !pendingConflict) {
    questionType = "confirm";
    nextQuestion = "I may be over-probing here. Does the current summary feel accurate enough to move forward?";
    questionReason = "anti_repeat_shift_to_confirm";
  }

  if (staleTurns >= 2 && !pendingConflict) {
    questionType = "confirm";
    nextQuestion = summarizeCheckpointBridge(state);
    questionReason = "loop_guard_checkpoint";
    loopGuard.triggered = true;
    loopGuard.stale_turns = 0;
  } else {
    loopGuard.triggered = false;
    loopGuard.stale_turns = staleTurns;
  }

  loopGuard.target_field = strategy.field;
  loopGuard.question_type = questionType;

  state.system_assessment.follow_up_attempts[strategy.field] = {
    attempts: tracker.attempts + 1,
    last_question_type: questionType,
    last_asked_at: new Date().toISOString(),
  };

  state.conversation_meta.current_focus_modules = [strategy.module];
  state.system_assessment.recommended_next_question = nextQuestion;
  state.system_assessment.last_follow_up_exit_status = exitStatus;
  state.system_assessment.last_turn_diagnostics.question_reason = questionReason;
  state.system_assessment.last_turn_diagnostics.deferred_fields = deferredFields;

  return {
    nextQuestion,
    questionType,
    targetField: strategy.field,
    questionReason,
    exitStatus,
    deferredFields,
  };
}

export function detectFatigueFromMessage(state: InterviewState, message: string) {
  const lowSignal = message.trim().split(/\s+/).filter(Boolean).length < 5;
  const hasFatiguePhrase = /not sure|idk|don't know|whatever|skip|later|tired/i.test(message);

  if (lowSignal && hasFatiguePhrase) {
    state.system_assessment.user_fatigue_risk = "high";
    state.conversation_meta.user_engagement_level = "low";
    return;
  }

  if (lowSignal || hasFatiguePhrase) {
    state.system_assessment.user_fatigue_risk = "medium";
    state.conversation_meta.user_engagement_level = "medium";
    return;
  }

  state.system_assessment.user_fatigue_risk = "low";
  state.conversation_meta.user_engagement_level = "high";
}
