export function handoffSystemPrompt() {
  return "Create a concise human handoff summary with strong points, missing points, and sensitive considerations.";
}

export function handoffUserPrompt(serializedState: string) {
  return `Interview state for handoff:\n${serializedState}`;
}
