import { readFileSync } from "fs";
import { join } from "path";

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

const QUESTION_REFINER_FALLBACK =
  "You review interview questions and return strict JSON with quality evaluation, a simpler entry question, and sub-questions for each original question.";

const TURN_UNDERSTANDING_FALLBACK =
  "You are a turn understanding agent. Return strict JSON including understanding feedback, answer status, missing points, next action, example answers, summary patch, and readiness.";

const TURN_EXTRACTOR_FALLBACK =
  "You extract structured facts from the latest user message for the active question node. Return strict JSON only.";

const DIALOGUE_PLANNER_FALLBACK =
  "You plan the next dialogue action based on node state and interview state. Return strict JSON only.";

const RESPONSE_COMPOSER_FALLBACK =
  "You compose user-facing response blocks from planner and extractor outputs. Return strict JSON only.";

const MICRO_CONFIRM_GENERATOR_FALLBACK =
  "You generate a concise micro-confirmation ack and 3-4 easy options. Return strict JSON only.";

const EXAMPLE_ANSWER_FALLBACK =
  "You generate 3-4 low-barrier example answers for the current interview question. Return strict JSON only.";

const SUMMARY_GENERATOR_FALLBACK =
  "You generate a concise interview summary and a structured report JSON. Return strict JSON only.";

const COMPLETION_JUDGE_FALLBACK =
  "You assess summary readiness and early-stop recommendation. Return strict JSON only.";

export function askmoreV2QuestionRefinerPrompt(): string {
  return loadPromptFile("ASKMORE_V2_QUESTION_REFINER.md", QUESTION_REFINER_FALLBACK);
}

export function askmoreV2TurnUnderstandingPrompt(): string {
  return loadPromptFile("ASKMORE_V2_TURN_UNDERSTANDING.md", TURN_UNDERSTANDING_FALLBACK);
}

export function askmoreV2TurnExtractorPrompt(): string {
  return loadPromptFile("ASKMORE_V2_TURN_EXTRACTOR.md", TURN_EXTRACTOR_FALLBACK);
}

export function askmoreV2DialoguePlannerPrompt(): string {
  return loadPromptFile("ASKMORE_V2_DIALOGUE_PLANNER.md", DIALOGUE_PLANNER_FALLBACK);
}

export function askmoreV2ResponseComposerPrompt(): string {
  return loadPromptFile("ASKMORE_V2_RESPONSE_COMPOSER.md", RESPONSE_COMPOSER_FALLBACK);
}

export function askmoreV2MicroConfirmGeneratorPrompt(): string {
  return loadPromptFile("ASKMORE_V2_MICRO_CONFIRM_GENERATOR.md", MICRO_CONFIRM_GENERATOR_FALLBACK);
}

export function askmoreV2ExampleAnswerPrompt(): string {
  return loadPromptFile("ASKMORE_V2_EXAMPLE_ANSWER.md", EXAMPLE_ANSWER_FALLBACK);
}

export function askmoreV2SummaryPrompt(): string {
  return loadPromptFile("ASKMORE_V2_SUMMARY_GENERATOR.md", SUMMARY_GENERATOR_FALLBACK);
}

export function askmoreV2CompletionJudgePrompt(): string {
  return loadPromptFile("ASKMORE_V2_COMPLETION_JUDGE.md", COMPLETION_JUDGE_FALLBACK);
}
