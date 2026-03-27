import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { askmoreV2IntentRouterPrompt } from "@/server/askmore_v2/prompts";
import { AskmoreV2RoutedIntent, AskmoreV2TurnChoiceInput } from "@/server/askmore_v2/types";
import { RuntimeContextSnapshot } from "@/server/askmore_v2/runtime/context-engine";
import { logAskmoreRuntime } from "@/server/askmore_v2/runtime/runtime-logger";

const schema = z.object({
  intent: z.enum(["answer_question", "ask_for_help", "clarify_meaning", "other_discussion"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

function isSummaryRequest(text: string): boolean {
  return /(summary|summarize|show summary|总结|小结|概括|汇总|看总结|先看总结|给我总结)/i.test(text);
}

function isCompletionCheckRequest(text: string): boolean {
  return /(我(都)?(已经)?(答|说)(完|过)了|我都回答了|不是都说了吗|还要问|为什么还问|我已经提供了|already answered|already told you|why are you asking again)/i.test(
    text,
  );
}

function isHelpRequest(text: string): boolean {
  return /(怎么答|不会答|不知道怎么|举个例子|给我例子|例子描述|怎么描述|怎么说|怎么回答|不确定你想知道什么|能举例吗|help|example|not sure how to answer|can you give examples|how should i answer)/i.test(
    text,
  );
}

function isClarifyRequest(text: string): boolean {
  return /(你是说|我理解对吗|确认一下|再确认|你指的是|你问的是哪种|前面那个|这个状态是指|这种状态是指|什么意思|什么叫|怎么判断|什么行为算|哪些行为算|怎么观察|判断标准|怎么算|标准是什么|clarify|did you mean|confirm this|what do you mean|what counts as|how to judge|definition|criteria)/i.test(
    text,
  );
}

function isDiscussion(text: string): boolean {
  return /(顺便|另外|题外话|担心|背景|先说个情况|by the way|background|concern|story)/i.test(text);
}

function isQuestionLike(text: string): boolean {
  return /[?？]$/.test(text.trim()) || /(怎么|为什么|哪些|什么|如何|can you|what|how)/i.test(text);
}

function deterministicFallback(params: {
  text: string;
  pendingIntent: RuntimeContextSnapshot["ui_state_hint"]["pending_intent"];
  choice?: AskmoreV2TurnChoiceInput;
}): AskmoreV2RoutedIntent {
  if (params.choice) {
    return {
      intent: "answer_question",
      confidence: 0.99,
      rationale: "choice_payload_forces_answer",
    };
  }

  if (isSummaryRequest(params.text)) {
    return {
      intent: "answer_question",
      confidence: 0.95,
      rationale: "summary_signal_routed_to_answer_path",
    };
  }

  if (isCompletionCheckRequest(params.text)) {
    return {
      intent: "answer_question",
      confidence: 0.95,
      rationale: "completion_check_signal",
    };
  }

  if (isClarifyRequest(params.text)) {
    return {
      intent: "clarify_meaning",
      confidence: 0.9,
      rationale: "contains_clarify_signal",
    };
  }

  if (isHelpRequest(params.text)) {
    return {
      intent: "ask_for_help",
      confidence: 0.93,
      rationale: "contains_help_signal",
    };
  }

  if (params.pendingIntent === "ask_for_help" && isQuestionLike(params.text)) {
    return {
      intent: "ask_for_help",
      confidence: 0.8,
      rationale: "pending_help_with_question_like_turn",
    };
  }

  if (isDiscussion(params.text)) {
    return {
      intent: "other_discussion",
      confidence: 0.74,
      rationale: "contains_discussion_signal",
    };
  }

  return {
    intent: "answer_question",
    confidence: 0.7,
    rationale: "deterministic_default_answer",
  };
}

function applyRuleCorrections(params: {
  text: string;
  pendingIntent: RuntimeContextSnapshot["ui_state_hint"]["pending_intent"];
  choice?: AskmoreV2TurnChoiceInput;
  modelIntent: AskmoreV2RoutedIntent;
}): AskmoreV2RoutedIntent {
  const trimmed = params.text.trim();

  if (params.choice) {
    return {
      intent: "answer_question",
      confidence: 0.99,
      rationale: "choice_payload_forces_answer",
    };
  }
  if (isSummaryRequest(trimmed)) {
    return {
      intent: "answer_question",
      confidence: 0.96,
      rationale: "summary_signal_routed_to_answer_path",
    };
  }
  if (isCompletionCheckRequest(trimmed)) {
    return {
      intent: "answer_question",
      confidence: Math.max(0.9, params.modelIntent.confidence),
      rationale: "completion_check_rule_override",
    };
  }
  if (isClarifyRequest(trimmed)) {
    return {
      intent: "clarify_meaning",
      confidence: 0.94,
      rationale: "explicit_clarify_rule_override",
    };
  }
  if (isHelpRequest(trimmed)) {
    return {
      intent: "ask_for_help",
      confidence: 0.97,
      rationale: "explicit_help_rule_override",
    };
  }
  if (params.pendingIntent === "ask_for_help" && isQuestionLike(trimmed)) {
    return {
      intent: "ask_for_help",
      confidence: Math.max(0.82, params.modelIntent.confidence),
      rationale: "pending_help_mode_continuation",
    };
  }
  return params.modelIntent;
}

async function classifyWithModel(params: {
  text: string;
  context: RuntimeContextSnapshot;
}): Promise<AskmoreV2RoutedIntent> {
  const activeQuestionText = params.context.active_question.question?.entry_question
    ?? params.context.active_question.node?.user_facing_entry
    ?? "none";
  const unresolved = params.context.unresolved_gaps.map((item) => item.label).join(" | ") || "none";
  const recent = params.context.recent_memory.user_turns.slice(-3).join(" | ") || "none";

  const result = await generateModelObject({
    system: askmoreV2IntentRouterPrompt(),
    prompt: [
      `Latest user turn: ${params.text}`,
      `Active question: ${activeQuestionText}`,
      `Unresolved gaps: ${unresolved}`,
      `Recent user turns: ${recent}`,
    ].join("\n"),
    schema,
  });

  return {
    intent: result.intent,
    confidence: result.confidence,
    rationale: result.rationale,
  };
}

export async function routeIntent(params: {
  userMessage: string;
  context: RuntimeContextSnapshot;
  choice?: AskmoreV2TurnChoiceInput;
}): Promise<AskmoreV2RoutedIntent> {
  const text = params.userMessage.trim();
  if (!text) {
    logAskmoreRuntime("intent_router_empty_input", {
      pending_intent: params.context.ui_state_hint.pending_intent ?? null,
    });
    return {
      intent: "other_discussion",
      confidence: 0.55,
      rationale: "empty_or_whitespace",
    };
  }

  let modelIntent: AskmoreV2RoutedIntent;
  try {
    modelIntent = await classifyWithModel({
      text,
      context: params.context,
    });
    logAskmoreRuntime("intent_router_model_result", {
      model_intent: modelIntent.intent,
      confidence: modelIntent.confidence,
      rationale: modelIntent.rationale ?? null,
    });
  } catch {
    modelIntent = deterministicFallback({
      text,
      pendingIntent: params.context.ui_state_hint.pending_intent,
      choice: params.choice,
    });
    logAskmoreRuntime("intent_router_model_failed_fallback", {
      fallback_intent: modelIntent.intent,
      confidence: modelIntent.confidence,
      rationale: modelIntent.rationale ?? null,
    });
  }

  const corrected = applyRuleCorrections({
    text,
    pendingIntent: params.context.ui_state_hint.pending_intent,
    choice: params.choice,
    modelIntent,
  });
  logAskmoreRuntime("intent_router_corrected", {
    model_intent: modelIntent.intent,
    final_intent: corrected.intent,
    final_confidence: corrected.confidence,
    rationale: corrected.rationale ?? null,
  });
  return corrected;
}
