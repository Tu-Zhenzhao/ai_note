import { readFileSync } from "fs";
import { join } from "path";
import { ChecklistItem, InterviewMessage, InterviewState, PreviewSlot, QuestionType } from "@/lib/types";
import { SECTION_ORDER, getCurrentSectionName } from "@/server/rules/checklist";
import {
  getOpenPreviewSlotsForSectionIndex,
  getPreviewSlotsForSectionIndex,
  syncPreviewSlots,
} from "@/server/services/preview-slots";

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

const DEFAULT_FALLBACK =
  "You are a senior LinkedIn content strategist conducting a discovery interview. Be natural, brief, and conversational. Never repeat what the user said. Ask one focused question per turn.";

export function interviewSystemPrompt(): string {
  return loadPromptFile("AGENT.md", DEFAULT_FALLBACK);
}

export type TaskPromptKey = "answer_question" | "ask_for_help" | "other_discussion";

const TASK_PROMPT_FILES: Record<TaskPromptKey, string> = {
  answer_question: "ANSWER.md",
  ask_for_help: "HELP.md",
  other_discussion: "DISCUSSION.md",
};

export function loadTaskPrompt(taskType: TaskPromptKey): string {
  return loadPromptFile(TASK_PROMPT_FILES[taskType], DEFAULT_FALLBACK);
}

const HUMAN_LABELS: Record<string, string> = {
  "company_profile.company_one_liner": "company description",
  "company_profile.company_name": "company name",
  "company_profile.industry": "industry/vertical",
  "company_profile.business_model": "business model",
  "brand_story.founding_story": "founding story",
  "brand_story.origin_context": "founding context",
  "brand_story.mission_statement": "mission",
  "brand_story.core_belief": "core belief",
  "brand_story.what_should_people_remember": "memorable takeaway",
  "product_service.primary_offering": "main offering",
  "product_service.core_offerings": "core offerings",
  "product_service.problem_solved": "problem solved",
  "product_service.key_differentiators": "differentiator",
  "market_audience.primary_audience": "primary audience",
  "market_audience.audience_pain_points": "audience pain points",
  "market_audience.audience_desired_outcomes": "audience desired outcomes",
  "market_audience.attraction_goal": "LinkedIn attraction goal",
  "linkedin_content_strategy.primary_content_goal": "main content goal",
  "linkedin_content_strategy.desired_content_formats": "content formats",
  "linkedin_content_strategy.topics_they_want_to_talk_about": "content topics",
  "content_preferences.preferred_tone": "preferred tone",
  "content_preferences.preferred_voice": "preferred voice",
  "content_preferences.preferred_style_tags": "style preferences",
  "content_dislikes.disliked_tone": "style dislikes",
  "content_dislikes.disliked_messaging_patterns": "messaging dislikes",
  "evidence_library.case_studies": "case studies",
  "evidence_library.metrics_and_proof_points": "metrics/proof",
  "evidence_library.assets": "content assets",
  "evidence_library.milestones_and_updates": "milestones",
  "evidence_library.source_material_links": "source materials",
  "constraints_and_boundaries.forbidden_topics": "forbidden topics",
  "constraints_and_boundaries.sensitive_topics": "sensitive topics",
  "constraints_and_boundaries.claims_policy": "claims policy",
  "user_concerns.main_concerns": "content concerns",
  "content_readiness.ai_suggested_first_content_topic": "first content topic",
  "content_readiness.ai_suggested_first_content_format": "first content format",
  "content_readiness.required_missing_inputs_for_first_content": "generation blockers",
};

function humanizeField(field: string): string {
  return HUMAN_LABELS[field] ?? field.split(".").pop()?.replace(/_/g, " ") ?? field;
}

function summarizeChecklist(checklist: ChecklistItem[]): string {
  return checklist.map((item) => {
    const statusIcon = item.status === "answered" || item.status === "verified" ? "DONE" : item.status === "partial" ? "PARTIAL" : "OPEN";
    return `- [${statusIcon}] ${item.question_label} (${item.module}, ${item.priority})`;
  }).join("\n");
}

function summarizeSectionProgress(state: InterviewState): string {
  syncPreviewSlots(state);
  return SECTION_ORDER.map((section, idx) => {
    const slots = getPreviewSlotsForSectionIndex(state, idx);
    const done = slots.filter((slot) => slot.status === "strong" || slot.status === "verified").length;
    const partial = slots.filter((slot) => slot.status === "weak").length;
    const active = idx === state.conversation_meta.current_section_index ? " <-- CURRENT" : "";
    return `Section ${idx + 1}: ${section.name} (${done} done, ${partial} weak, ${slots.length} total)${active}`;
  }).join("\n");
}

export function interviewUserPrompt(params: {
  userMessage: string;
  state: InterviewState;
  nextQuestion: string;
  questionType: QuestionType;
  taskType?: "answer_question" | "ask_for_help" | "other_discussion";
  capturedFieldsThisTurn: string[];
  capturedChecklistItemsThisTurn: string[];
  recentMessages: InterviewMessage[];
  sectionAdvanced: boolean;
  currentSectionName: string;
  workflowPhase?: string;
  transitionAllowed?: boolean;
  pendingReviewSectionName?: string | null;
}): string {
  const currentSection = getCurrentSectionName(params.state);
  const sectionIndex = params.state.conversation_meta.current_section_index;
  syncPreviewSlots(params.state);
  const openSlots = getOpenPreviewSlotsForSectionIndex(params.state, sectionIndex);
  const answeredSlots = getPreviewSlotsForSectionIndex(params.state, sectionIndex).filter(
    (slot) => slot.status === "strong" || slot.status === "verified",
  );
  const stillNeeded =
    openSlots.map((slot) => `${slot.question_label} (${slot.blocking_priority})`).join(", ") ||
    "nothing — section complete";
  const alreadyAnswered =
    answeredSlots.map((slot) => slot.label).join(", ") || "none yet";

  const capturedHuman = params.capturedFieldsThisTurn.map(humanizeField);
  const capturedStr = capturedHuman.length > 0
    ? `Captured this turn: ${capturedHuman.join(", ")}`
    : "Nothing new was captured from the user's message.";

  const crossSectionCaptures = params.capturedChecklistItemsThisTurn.filter((id) => {
    const item = params.state.checklist.find((c) => c.id === id);
    if (!item) return false;
    const currentModules = SECTION_ORDER[sectionIndex]?.modules ?? [];
    return !currentModules.includes(item.module);
  });

  const crossSectionNote = crossSectionCaptures.length > 0
    ? `Cross-section info captured (for later sections): ${crossSectionCaptures.map((id) => {
        const item = params.state.checklist.find((c) => c.id === id);
        return item?.question_label ?? id;
      }).join(", ")}`
    : "";

  const sectionTransition = params.sectionAdvanced
    ? `SECTION TRANSITION: You just completed the previous section. You are now starting "${params.currentSectionName}". Announce this transition naturally.`
    : "";
  const workflowConstraints = [
    `Planner task type: ${params.taskType ?? "answer_question"}`,
    `Workflow phase: ${params.workflowPhase ?? "interviewing"}`,
    `Transition allowed this turn: ${params.transitionAllowed ? "yes" : "no"}`,
    params.pendingReviewSectionName
      ? `Pending review section: ${params.pendingReviewSectionName}`
      : "",
    !params.transitionAllowed
      ? "HARD RULE: Do NOT claim a section is complete or say you are moving sections."
      : "",
    params.workflowPhase === "confirming_section"
      ? "HARD RULE: Ask for section confirmation or refinement only. Do not introduce a next-section question."
      : "",
    params.taskType === "ask_for_help"
      ? "HARD RULE: Provide suggestions/options and guide selection. Do not claim checklist answers are finalized."
      : "",
    params.taskType === "other_discussion"
      ? "HARD RULE: Stay in clarification/discussion mode and avoid pretending durable state changed."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const chatHistory = params.recentMessages
    .slice(-8)
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
    .join("\n");

  return [
    "=== CURRENT STATE ===",
    `Current section (${sectionIndex + 1}/6): ${currentSection}`,
    `Already answered in this section: ${alreadyAnswered}`,
    `Still needed in this section: ${stillNeeded}`,
    "",
    "=== SECTION PROGRESS ===",
    summarizeSectionProgress(params.state),
    "",
    "=== FULL CHECKLIST ===",
    summarizeChecklist(params.state.checklist),
    "",
    "=== THIS TURN ===",
    `User said: "${params.userMessage}"`,
    capturedStr,
    crossSectionNote,
    sectionTransition,
    workflowConstraints,
    "",
    "=== SUGGESTED NEXT QUESTION ===",
    `Question type: ${params.questionType}`,
    `Suggested question: ${params.nextQuestion}`,
    "(You may rephrase this naturally. Do not ask it verbatim if it sounds robotic.)",
    "",
    "=== RECENT CHAT HISTORY ===",
    chatHistory || "(No prior messages)",
    "",
    "=== YOUR TASK ===",
    "Compose a natural response following the rules in your system prompt (including the task-specific prompt book).",
    "IMPORTANT: Do NOT mention section names or say 'We are in…' — the UI shows section status separately.",
    "Keep it conversational. Use markdown formatting naturally (bold, lists) when it adds clarity.",
    "IMPORTANT: Required items that are still weak, inferred, or unconfirmed may be revisited. Do not move to the next section while a required item in the current section is still open.",
  ].filter(Boolean).join("\n");
}
