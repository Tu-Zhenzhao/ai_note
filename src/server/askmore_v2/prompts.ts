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
  "You are AskMore V3 Question Refiner. Return strict JSON with grounded evaluation, concrete entry question, and semantically distinct sub-questions.";

const TURN_UNDERSTANDING_FALLBACK =
  "You are AskMore V3 turn-understanding helper for legacy path. Return strict JSON only.";

const TURN_EXTRACTOR_FALLBACK =
  "You are AskMore V3 turn extractor. Extract only active-node dimensions from latest user message and return strict JSON only.";

const DIALOGUE_PLANNER_FALLBACK =
  "You are AskMore V3 dialogue planner helper. Output policy-friendly next-action suggestion in strict JSON only.";

const RESPONSE_COMPOSER_FALLBACK =
  "You are AskMore V3 response-composer compatibility helper. Return strict JSON response blocks only.";

const MICRO_CONFIRM_GENERATOR_FALLBACK =
  "You are AskMore V3 micro-confirm generator. Return strict JSON with concise ack plus 3-4 easy options.";

const EXAMPLE_ANSWER_FALLBACK =
  "You are AskMore V3 example-answer generator. Return strict JSON with 3-4 short, low-barrier user-like examples.";

const HELP_COACHING_FALLBACK =
  "You are AskMore V3 help-coaching generator. First resolve the user's immediate confusion, then reconnect to current question in easier form. Return strict JSON only.";

const FOLLOWUP_OPTIONIZE_FALLBACK =
  "You are AskMore V3 follow-up optionizer. Convert a single follow-up gap into 2-4 short user-selectable options within the current question scope. Return strict JSON only.";

const SUMMARY_GENERATOR_FALLBACK =
  "You are AskMore V3 summary generator. Return strict JSON summary and structured report, without inventing unknown facts.";

const COMPLETION_JUDGE_FALLBACK =
  "You are AskMore V3 completion judge. Return strict JSON for readiness and early-stop recommendation with conservative criteria.";

const INTENT_ROUTER_FALLBACK =
  "You are AskMore V3 intent router. Classify latest user turn into one intent: answer_question | ask_for_help | clarify_meaning | other_discussion. Prioritize ask_for_help when user asks how to answer or asks for examples/explanation. Prioritize clarify_meaning when user asks to confirm wording/meaning. If uncertain between answer_question and other_discussion, choose answer_question. Return strict JSON only.";

const UNDERSTANDING_SUMMARY_FALLBACK =
  "You are AskMore V3 understanding-summary event writer. Write one concise, natural, professional user-facing sentence that reflects what was understood from the latest turn, grounded in provided facts only.";

const PRESENTATION_PHRASING_FALLBACK =
  "You are AskMore V3 presentation-phrasing helper. Rewrite draft event hints into concise natural user-facing text. Return strict JSON only.";

const PRESENTATION_CORE_FALLBACK =
  "You are the visible voice of AskMore. Use first-person Chinese/English, keep calm and thoughtful, avoid system wording, and keep each block within 1-2 sentences.";

const PRESENTATION_UNDERSTANDING_FALLBACK =
  "For understanding blocks: capture one key signal and briefly explain why it matters for your current direction. Avoid verbatim repetition.";

const PRESENTATION_HELP_FALLBACK =
  "For help blocks: identify where user is stuck, reframe into easier answer path, provide 1-2 answer angles and one tightly relevant example without answering for the user.";

const PRESENTATION_MICRO_CONFIRM_FALLBACK =
  "For micro-confirm blocks: confirm only one ambiguity point naturally, optionally with one short reason.";

const PRESENTATION_TRANSITION_FALLBACK =
  "For transition blocks: connect from current understanding and explain why the next question is asked.";

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

export function askmoreV2HelpCoachingPrompt(): string {
  return loadPromptFile("ASKMORE_V2_HELP_COACHING.md", HELP_COACHING_FALLBACK);
}

export function askmoreV2FollowUpOptionizePrompt(): string {
  return loadPromptFile("ASKMORE_V2_FOLLOWUP_OPTIONIZE.md", FOLLOWUP_OPTIONIZE_FALLBACK);
}

export function askmoreV2SummaryPrompt(): string {
  return loadPromptFile("ASKMORE_V2_SUMMARY_GENERATOR.md", SUMMARY_GENERATOR_FALLBACK);
}

export function askmoreV2CompletionJudgePrompt(): string {
  return loadPromptFile("ASKMORE_V2_COMPLETION_JUDGE.md", COMPLETION_JUDGE_FALLBACK);
}

export function askmoreV2IntentRouterPrompt(): string {
  return loadPromptFile("ASKMORE_V2_INTENT_ROUTER.md", INTENT_ROUTER_FALLBACK);
}

export function askmoreV2UnderstandingSummaryPrompt(): string {
  return loadPromptFile("ASKMORE_V2_UNDERSTANDING_SUMMARY.md", UNDERSTANDING_SUMMARY_FALLBACK);
}

export function askmoreV2PresentationPhrasingPrompt(): string {
  return loadPromptFile("ASKMORE_V2_PRESENTATION_PHRASING.md", PRESENTATION_PHRASING_FALLBACK);
}

export interface AskmoreV2PresentationPromptPack {
  core: string;
  understanding: string;
  help: string;
  microConfirm: string;
  transition: string;
}

export function askmoreV2PresentationPromptPack(): AskmoreV2PresentationPromptPack {
  return {
    core: loadPromptFile("ASKMORE_PRESENTATION_CORE.md", PRESENTATION_CORE_FALLBACK),
    understanding: loadPromptFile("ASKMORE_PRESENTATION_UNDERSTANDING.md", PRESENTATION_UNDERSTANDING_FALLBACK),
    help: loadPromptFile("ASKMORE_PRESENTATION_HELP.md", PRESENTATION_HELP_FALLBACK),
    microConfirm: loadPromptFile("ASKMORE_PRESENTATION_MICRO_CONFIRM.md", PRESENTATION_MICRO_CONFIRM_FALLBACK),
    transition: loadPromptFile("ASKMORE_PRESENTATION_TRANSITION.md", PRESENTATION_TRANSITION_FALLBACK),
  };
}
