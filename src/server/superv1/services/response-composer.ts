import { generateModelText } from "@/server/model/adapters";
import {
  SuperV1DetectedHelpSelection,
  SuperV1HelpContext,
  SuperV1Intent,
  SuperV1InteractionMode,
  SuperV1PlannerResult,
} from "@/server/superv1/types";
import { SuperV1LocalizedQuestionGuidance } from "@/server/superv1/question-guidance";
import { superV1ResponseSystemPrompt } from "@/server/prompts/superv1";

function deterministicResponse(params: {
  intent: SuperV1Intent;
  language: "en" | "zh";
  acceptedFacts: string[];
  interactionMode: SuperV1InteractionMode;
  isHelpContinuation: boolean;
  helpContext: SuperV1HelpContext | null;
  detectedHelpSelection: SuperV1DetectedHelpSelection | null;
  currentQuestionText: string | null;
  currentQuestionGuidance: SuperV1LocalizedQuestionGuidance | null;
  knownBusinessContext: string[];
  nextQuestionText: string | null;
}): string {
  const isZh = params.language === "zh";
  if (params.intent === "ask_for_help") {
    const baseQuestion = params.currentQuestionText ?? params.nextQuestionText ?? "the current question";
    const guidanceOptions = params.currentQuestionGuidance?.canonical_options ?? [];
    const contextHint =
      params.knownBusinessContext.length > 0
        ? isZh
          ? `\n\n已知上下文：${params.knownBusinessContext.join("；")}`
          : `\n\nKnown context: ${params.knownBusinessContext.join("; ")}`
        : "";
    if (params.detectedHelpSelection?.detected && params.detectedHelpSelection.selected_option_text) {
      return isZh
        ? `你选的是：${params.detectedHelpSelection.selected_option_text}。我可以继续展开这个方向，或者你也可以直接用一句话回答当前问题：${baseQuestion}${contextHint}`
        : `You picked: ${params.detectedHelpSelection.selected_option_text}. I can expand this direction, or you can answer the current question directly in one sentence: ${baseQuestion}`;
    }
    if (params.isHelpContinuation) {
      return isZh
        ? `当然，我们继续拆解这个问题：${baseQuestion}${guidanceOptions.length ? `\n\n可参考类别：${guidanceOptions.join("、")}` : ""}${contextHint}\n\n---\n\n你可以继续问我解释、示例，或直接给出你的答案。`
        : `Absolutely, let's keep breaking this down: ${baseQuestion}\n\n---\n\nYou can ask for clarification/examples, or answer directly when ready.`;
    }
    return isZh
      ? `当然可以。这道题核心是：${baseQuestion}${guidanceOptions.length ? `\n\n可参考类别：${guidanceOptions.join("、")}` : ""}${contextHint}\n\n---\n\n我可以给你示例、换个说法，或你直接先说一个你最确定的点。`
      : `Absolutely. This question is mainly asking: ${baseQuestion}\n\n---\n\nI can give examples, simplify it, or you can share the one point you're most sure about.`;
  }
  if (params.intent === "other_discussion") {
    const backToQuestion = params.currentQuestionText ?? params.nextQuestionText;
    return isZh
      ? `明白，我们先把这个点说清楚。${backToQuestion ? `准备好后我们回到这个问题：${backToQuestion}` : "准备好后我们继续。"}`
      : `Understood, let's clarify this first. ${backToQuestion ? `When you're ready, we can return to: ${backToQuestion}` : "When you're ready, we'll continue."}`;
  }

  const accepted = params.acceptedFacts.length
    ? isZh
      ? `我已记录：${params.acceptedFacts.join("；")}。`
      : `Captured: ${params.acceptedFacts.join("; ")}.`
    : isZh
      ? "我已收到你的回答。"
      : "Got it.";

  if (!params.nextQuestionText) {
    return isZh
      ? `${accepted} 当前必填问题已完成，我们可以进入下一阶段。`
      : `${accepted} Required questions are complete for now, and we can move to the next stage.`;
  }
  return isZh
    ? `${accepted} 下一个关键问题是：${params.nextQuestionText}`
    : `${accepted} Next key question: ${params.nextQuestionText}`;
}

export async function composeResponse(params: {
  intent: SuperV1Intent;
  language: "en" | "zh";
  acceptedFacts: string[];
  planner: SuperV1PlannerResult;
  userMessage: string;
  interactionMode: SuperV1InteractionMode;
  isHelpContinuation: boolean;
  helpContext: SuperV1HelpContext | null;
  detectedHelpSelection: SuperV1DetectedHelpSelection | null;
  currentQuestionText: string | null;
  currentQuestionGuidance: SuperV1LocalizedQuestionGuidance | null;
  knownBusinessContext: string[];
}): Promise<string> {
  const nextQuestionText = params.planner.next_question_text;
  try {
    const response = await generateModelText({
      system: superV1ResponseSystemPrompt(params.intent),
      prompt: [
        `Intent: ${params.intent}`,
        `Interaction mode: ${params.interactionMode}`,
        `Is help continuation: ${params.isHelpContinuation ? "yes" : "no"}`,
        `Language: ${params.language}`,
        `Latest user message: ${params.userMessage}`,
        `Accepted facts: ${params.acceptedFacts.join("; ") || "none"}`,
        `Current question text: ${params.currentQuestionText ?? "none"}`,
        `Question help focus: ${params.currentQuestionGuidance?.help_focus ?? "none"}`,
        `Question canonical options: ${params.currentQuestionGuidance?.canonical_options.join(" | ") || "none"}`,
        `Question answer examples: ${params.currentQuestionGuidance?.answer_examples.join(" | ") || "none"}`,
        `Known business context: ${params.knownBusinessContext.join(" | ") || "none"}`,
        `Help context: ${params.helpContext ? JSON.stringify(params.helpContext) : "none"}`,
        `Detected help selection: ${params.detectedHelpSelection ? JSON.stringify(params.detectedHelpSelection) : "none"}`,
        `Next question (exact): ${nextQuestionText ?? "none"}`,
      ].join("\n"),
    });
    return response.trim() || deterministicResponse({
      intent: params.intent,
      language: params.language,
      acceptedFacts: params.acceptedFacts,
      interactionMode: params.interactionMode,
      isHelpContinuation: params.isHelpContinuation,
      helpContext: params.helpContext,
      detectedHelpSelection: params.detectedHelpSelection,
      currentQuestionText: params.currentQuestionText,
      currentQuestionGuidance: params.currentQuestionGuidance,
      knownBusinessContext: params.knownBusinessContext,
      nextQuestionText,
    });
  } catch {
    return deterministicResponse({
      intent: params.intent,
      language: params.language,
      acceptedFacts: params.acceptedFacts,
      interactionMode: params.interactionMode,
      isHelpContinuation: params.isHelpContinuation,
      helpContext: params.helpContext,
      detectedHelpSelection: params.detectedHelpSelection,
      currentQuestionText: params.currentQuestionText,
      currentQuestionGuidance: params.currentQuestionGuidance,
      knownBusinessContext: params.knownBusinessContext,
      nextQuestionText,
    });
  }
}
