export interface RepetitionDecision {
  should_avoid: boolean;
  reason: "none" | "user_repeat_complaint" | "dimension_prompted_recently";
}

export function evaluateRepetitionPolicy(params: {
  userMessage: string;
  recentPrompts: string[];
  candidateDimensionId: string | null;
}): RepetitionDecision {
  const complainsRepeat = /(我已经说过|我说过了|都说过了|别重复|重复了|already said|you asked this|asked this already)/i.test(
    params.userMessage,
  );
  if (complainsRepeat) {
    return {
      should_avoid: true,
      reason: "user_repeat_complaint",
    };
  }

  if (!params.candidateDimensionId) {
    return {
      should_avoid: false,
      reason: "none",
    };
  }

  const recentWindow = params.recentPrompts.slice(-2);
  if (recentWindow.some((prompt) => prompt.includes(params.candidateDimensionId!))) {
    return {
      should_avoid: true,
      reason: "dimension_prompted_recently",
    };
  }

  return {
    should_avoid: false,
    reason: "none",
  };
}
