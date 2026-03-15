import { readFileSync } from "fs";
import { join } from "path";
import { SuperV1Intent } from "@/server/superv1/types";

const promptCache: Record<string, string> = {};

function loadPromptFile(filename: string, fallback: string): string {
  if (promptCache[filename]) return promptCache[filename];
  try {
    const filePath = join(process.cwd(), "src", "server", "prompts", filename);
    promptCache[filename] = readFileSync(filePath, "utf-8");
    return promptCache[filename];
  } catch {
    return fallback;
  }
}

const INTENT_FALLBACK =
  "You classify user turns for a checklist-driven interview runtime. Return strict JSON with intent/confidence/reason only. Allowed intents: answer_question, ask_for_help, other_discussion. Prefer answer_question when user is plausibly answering the active question. Use ask_for_help for confusion/clarification/help-to-answer turns. Use other_discussion only for side discussions unrelated to answering the current question.";

const EXTRACTION_FALLBACK =
  "You extract checklist answers from a user turn. Return strict JSON with filled_items, ambiguous_items, possible_items. Only fill question_id values from the provided open questions list. Do not invent facts or strengthen vague claims. Attach evidence text for each filled item.";

const RESPONSE_FALLBACK =
  "You are a concise strategist assistant in a checklist intake runtime. Do not modify workflow logic in language output. For answer_question: acknowledge accepted facts and ask the exact planner-selected next question. For ask_for_help: provide concrete help options and invite one focused answer. For other_discussion: clarify briefly and guide user back to planner-selected question. Keep response concise.";

const AI_DIRECTIONS_FALLBACK =
  "You are a senior LinkedIn strategist. Return strict JSON with ai_suggested_directions (3 items) and recommendation_summary based on chat history and checklist answers.";

export function superV1IntentSystemPrompt(): string {
  return loadPromptFile("SUPERV1_INTENT.md", INTENT_FALLBACK);
}

export function superV1ExtractionSystemPrompt(): string {
  return loadPromptFile("SUPERV1_EXTRACTION.md", EXTRACTION_FALLBACK);
}

const RESPONSE_PROMPT_FILE_BY_INTENT: Record<SuperV1Intent, string> = {
  answer_question: "RESPONSE_ANSWER_QUESTION.md",
  ask_for_help: "RESPONSE_ASK_FOR_HELP.md",
  other_discussion: "RESPONSE_OTHER_DISCUSSION.md",
};

export function superV1ResponseSystemPrompt(intent: SuperV1Intent): string {
  return loadPromptFile(RESPONSE_PROMPT_FILE_BY_INTENT[intent], RESPONSE_FALLBACK);
}

export function superV1AiDirectionsSystemPrompt(): string {
  return loadPromptFile("SUPERV1_AI_SUGGESTED_DIRECTIONS.md", AI_DIRECTIONS_FALLBACK);
}
