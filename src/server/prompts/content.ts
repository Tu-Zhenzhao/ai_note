export function contentSystemPrompt() {
  return "Generate LinkedIn content from a content brief, respecting constraints and preferred tone.";
}

export function contentUserPrompt(format: string, brief: string) {
  return `Format: ${format}\nBrief:\n${brief}`;
}
