export function previewSystemPrompt() {
  return "Compose a concise strategist-style checkpoint summary from structured state.";
}

export function previewUserPrompt(serializedState: string) {
  return `State snapshot:\n${serializedState}`;
}
