import { generateModelText } from "@/server/model/adapters";
import { SuperV1Intent, SuperV1PlannerResult } from "@/server/superv1/types";

function deterministicResponse(params: {
  intent: SuperV1Intent;
  language: "en" | "zh";
  acceptedFacts: string[];
  nextQuestionText: string | null;
}): string {
  const isZh = params.language === "zh";
  if (params.intent === "ask_for_help") {
    return isZh
      ? "当然可以。你可以从三个方向回答：1) 你们服务的核心人群，2) 他们最常见的问题，3) 你们带来的结果。你先选一个最确定的点告诉我。"
      : "Absolutely. You can answer from one of three angles: 1) who you serve, 2) their recurring problem, 3) the result you deliver. Start with the one you are most sure about.";
  }
  if (params.intent === "other_discussion") {
    return isZh
      ? `明白，我们先澄清这个点。${params.nextQuestionText ? `准备好后我们回到这个问题：${params.nextQuestionText}` : "准备好后我们继续下一题。"}`
      : `Understood, let's clarify this first. ${params.nextQuestionText ? `When you're ready, we can return to: ${params.nextQuestionText}` : "When you're ready, we'll continue with the next question."}`;
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
}): Promise<string> {
  const nextQuestionText = params.planner.next_question_text;
  try {
    const response = await generateModelText({
      system: [
        "You are a concise strategist assistant in a checklist intake runtime.",
        "Do not modify workflow logic in language output.",
        "For answer_question: acknowledge accepted facts and ask the exact planner-selected next question.",
        "For ask_for_help: provide concrete help options and invite one focused answer.",
        "For other_discussion: clarify briefly and guide user back to planner-selected question.",
        "Keep response concise.",
      ].join(" "),
      prompt: [
        `Intent: ${params.intent}`,
        `Language: ${params.language}`,
        `Latest user message: ${params.userMessage}`,
        `Accepted facts: ${params.acceptedFacts.join("; ") || "none"}`,
        `Next question (exact): ${nextQuestionText ?? "none"}`,
      ].join("\n"),
    });
    return response.trim() || deterministicResponse({
      intent: params.intent,
      language: params.language,
      acceptedFacts: params.acceptedFacts,
      nextQuestionText,
    });
  } catch {
    return deterministicResponse({
      intent: params.intent,
      language: params.language,
      acceptedFacts: params.acceptedFacts,
      nextQuestionText,
    });
  }
}

