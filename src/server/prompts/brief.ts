export function briefSystemPrompt() {
  return "Create a generation-ready LinkedIn content brief using approved preview and constraints.";
}

export function briefUserPrompt(serializedState: string, direction: string, format: string, strategicNotes: string[]) {
  return [
    `Chosen direction: ${direction}`,
    `Chosen format: ${format}`,
    `Strategic notes from chat memory: ${strategicNotes.join(" | ") || "none"}`,
    `State: ${serializedState}`,
  ].join("\n");
}
