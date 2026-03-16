import { getSuperV1Repository } from "@/server/superv1/repo";
import { SuperV1RuntimeError } from "@/server/superv1/runtime-errors";
import {
  SuperV1AiSuggestedDirectionsPayload,
  SuperV1ChecklistAnswer,
  SuperV1TemplateQuestion,
  SuperV1Turn,
} from "@/server/superv1/types";

export type SuperV1ExportFormat =
  | "chat_history_txt"
  | "question_sheet_md"
  | "question_sheet_txt"
  | "ai_direction_report_md";

export interface SuperV1ExportFile {
  filename: string;
  contentType: string;
  body: string;
}

interface AnsweredQuestionEntry {
  question: SuperV1TemplateQuestion | null;
  answer: SuperV1ChecklistAnswer;
}

const EXPORT_VERSION = "superv1-export-v1";

function buildTimestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
}

function sanitizeConversationId(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned || "conversation";
}

function confidenceText(value: number | null): string {
  if (typeof value !== "number") return "n/a";
  return `${Math.round(value * 100)}%`;
}

function stringifyUnknown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => stringifyUnknown(item)).filter(Boolean).join("; ");
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function valueToMarkdownLines(value: unknown): string[] {
  if (value == null) return ["- (empty)"];
  if (typeof value === "string") {
    const text = value.trim();
    return [text || "(empty)"];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => stringifyUnknown(item)).filter(Boolean);
    return items.length > 0 ? items.map((item) => `- ${item}`) : ["- (empty)"];
  }
  let asJson = "";
  try {
    asJson = JSON.stringify(value, null, 2);
  } catch {
    asJson = String(value);
  }
  return ["```json", asJson, "```"];
}

function valueToTxtLines(value: unknown): string[] {
  if (value == null) return ["(empty)"];
  if (typeof value === "string") {
    const text = value.trim();
    return [text || "(empty)"];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => stringifyUnknown(item)).filter(Boolean);
    return items.length > 0 ? items.map((item) => `- ${item}`) : ["(empty)"];
  }
  let asJson = "";
  try {
    asJson = JSON.stringify(value, null, 2);
  } catch {
    asJson = String(value);
  }
  return asJson.split("\n");
}

function findAnsweredQuestions(
  questions: SuperV1TemplateQuestion[],
  answers: SuperV1ChecklistAnswer[],
): AnsweredQuestionEntry[] {
  const answerByQuestionId = new Map(answers.map((answer) => [answer.question_id, answer]));
  const ordered: AnsweredQuestionEntry[] = [];

  for (const question of questions) {
    const answer = answerByQuestionId.get(question.question_id);
    if (!answer || answer.status === "empty") continue;
    ordered.push({ question, answer });
    answerByQuestionId.delete(question.question_id);
  }

  for (const answer of answerByQuestionId.values()) {
    if (answer.status === "empty") continue;
    ordered.push({ question: null, answer });
  }

  return ordered;
}

function ensureAiSuggestionsReady(payload: SuperV1AiSuggestedDirectionsPayload | null): void {
  const directions = payload?.ai_suggested_directions ?? [];
  if (directions.length > 0) return;
  throw new SuperV1RuntimeError(
    "SUPERV1_RUNTIME_ERROR",
    "Please finish all steps and wait for AI suggestions before exporting.",
    409,
    { reason: "ai_suggestions_not_ready" },
  );
}

function buildMetaHeaderLines(params: {
  conversationId: string;
  generatedAtIso: string;
  language: "en" | "zh";
  turnsCount: number;
  answeredCount: number;
}): string[] {
  return [
    `Export Version: ${EXPORT_VERSION}`,
    `Conversation ID: ${params.conversationId}`,
    `Generated At (ISO): ${params.generatedAtIso}`,
    `Language: ${params.language}`,
    `Turns: ${params.turnsCount}`,
    `Answered Questions: ${params.answeredCount}`,
  ];
}

function buildChatHistoryTxt(params: {
  conversationId: string;
  language: "en" | "zh";
  turns: SuperV1Turn[];
  answeredCount: number;
  generatedAtIso: string;
}): string {
  const lines: string[] = [];
  lines.push("AI Content Strategist - Chat History");
  lines.push(...buildMetaHeaderLines({
    conversationId: params.conversationId,
    generatedAtIso: params.generatedAtIso,
    language: params.language,
    turnsCount: params.turns.length,
    answeredCount: params.answeredCount,
  }));
  lines.push("");
  lines.push("============================================================");
  lines.push("");

  for (const turn of params.turns) {
    lines.push(`[${turn.created_at}] ${turn.role.toUpperCase()}`);
    lines.push(turn.message_text?.trim() || "(empty)");
    lines.push("");
    lines.push("------------------------------------------------------------");
    lines.push("");
  }

  return lines.join("\n");
}

function buildQuestionSheetMd(params: {
  conversationId: string;
  language: "en" | "zh";
  turnsCount: number;
  answered: AnsweredQuestionEntry[];
  generatedAtIso: string;
}): string {
  const lines: string[] = [];
  lines.push("# Question List Answered Sheet");
  lines.push("");
  for (const line of buildMetaHeaderLines({
    conversationId: params.conversationId,
    generatedAtIso: params.generatedAtIso,
    language: params.language,
    turnsCount: params.turnsCount,
    answeredCount: params.answered.length,
  })) {
    lines.push(`- ${line}`);
  }
  lines.push("");

  if (params.answered.length === 0) {
    lines.push("No answered questions found.");
    return lines.join("\n");
  }

  lines.push(`## Answered Questions (${params.answered.length})`);
  lines.push("");

  params.answered.forEach((entry, index) => {
    const title = entry.question?.question_text || entry.answer.question_id;
    lines.push(`### ${index + 1}. ${title}`);
    lines.push(`- Question ID: ${entry.answer.question_id}`);
    if (entry.question?.section_id) {
      lines.push(`- Section: ${entry.question.section_id}`);
    }
    lines.push(`- Status: ${entry.answer.status}`);
    lines.push(`- Confidence: ${confidenceText(entry.answer.confidence)}`);
    lines.push(`- Updated At: ${entry.answer.updated_at}`);
    lines.push("- Answer:");
    for (const valueLine of valueToMarkdownLines(entry.answer.value_json)) {
      lines.push(`  ${valueLine}`);
    }
    if (entry.answer.evidence_text) {
      lines.push(`- Evidence: ${entry.answer.evidence_text}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

function buildQuestionSheetTxt(params: {
  conversationId: string;
  language: "en" | "zh";
  turnsCount: number;
  answered: AnsweredQuestionEntry[];
  generatedAtIso: string;
}): string {
  const lines: string[] = [];
  lines.push("Question List Answered Sheet");
  lines.push(...buildMetaHeaderLines({
    conversationId: params.conversationId,
    generatedAtIso: params.generatedAtIso,
    language: params.language,
    turnsCount: params.turnsCount,
    answeredCount: params.answered.length,
  }));
  lines.push("");
  lines.push("============================================================");
  lines.push("");

  if (params.answered.length === 0) {
    lines.push("No answered questions found.");
    return lines.join("\n");
  }

  params.answered.forEach((entry, index) => {
    const title = entry.question?.question_text || entry.answer.question_id;
    lines.push(`${index + 1}. ${title}`);
    lines.push(`Question ID: ${entry.answer.question_id}`);
    if (entry.question?.section_id) {
      lines.push(`Section: ${entry.question.section_id}`);
    }
    lines.push(`Status: ${entry.answer.status}`);
    lines.push(`Confidence: ${confidenceText(entry.answer.confidence)}`);
    lines.push(`Updated At: ${entry.answer.updated_at}`);
    lines.push("Answer:");
    for (const valueLine of valueToTxtLines(entry.answer.value_json)) {
      lines.push(`  ${valueLine}`);
    }
    if (entry.answer.evidence_text) {
      lines.push(`Evidence: ${entry.answer.evidence_text}`);
    }
    lines.push("");
    lines.push("------------------------------------------------------------");
    lines.push("");
  });

  return lines.join("\n");
}

function buildAiDirectionReportMd(params: {
  conversationId: string;
  language: "en" | "zh";
  turnsCount: number;
  answeredCount: number;
  aiPayload: SuperV1AiSuggestedDirectionsPayload;
  generatedAtIso: string;
}): string {
  const lines: string[] = [];
  lines.push("# AI Suggested Direction Report");
  lines.push("");
  for (const line of buildMetaHeaderLines({
    conversationId: params.conversationId,
    generatedAtIso: params.generatedAtIso,
    language: params.language,
    turnsCount: params.turnsCount,
    answeredCount: params.answeredCount,
  })) {
    lines.push(`- ${line}`);
  }
  lines.push("");

  const directions = params.aiPayload.ai_suggested_directions ?? [];
  directions.forEach((direction, index) => {
    lines.push(`## Direction ${index + 1}: ${direction.title || direction.id}`);
    lines.push(`- ID: ${direction.id}`);
    lines.push(`- Target Audience: ${direction.target_audience}`);
    lines.push(`- Core Insight: ${direction.core_insight}`);
    lines.push(`- Content Angle: ${direction.content_angle}`);
    lines.push(`- Suggested Formats: ${(direction.suggested_formats ?? []).join(" / ")}`);
    lines.push(`- Example Hook: ${direction.example_hook}`);
    lines.push(`- Proof To Use: ${(direction.proof_to_use ?? []).join(" / ")}`);
    lines.push(`- Risk Boundary Check: ${direction.risk_boundary_check}`);
    lines.push(`- Why Fit: ${direction.why_fit}`);
    lines.push(`- Execution Difficulty: ${direction.execution_difficulty}`);
    lines.push("");
  });

  const summary = params.aiPayload.recommendation_summary;
  if (summary) {
    lines.push("## Recommendation Summary");
    lines.push(`- Best Starting Direction: ${summary.best_starting_direction_id}`);
    lines.push(`- Reason: ${summary.reason}`);
    lines.push("- First Week Plan:");
    for (const item of summary.first_week_plan ?? []) {
      lines.push(`  - ${item}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function isSuperV1ExportFormat(value: string | null): value is SuperV1ExportFormat {
  return (
    value === "chat_history_txt" ||
    value === "question_sheet_md" ||
    value === "question_sheet_txt" ||
    value === "ai_direction_report_md"
  );
}

export async function buildSuperV1Export(
  conversationId: string,
  format: SuperV1ExportFormat,
): Promise<SuperV1ExportFile> {
  const repo = getSuperV1Repository();
  const conversation = await repo.getConversation(conversationId);
  if (!conversation) {
    throw new SuperV1RuntimeError("SUPERV1_RUNTIME_ERROR", "Conversation not found", 404);
  }

  const [turns, answers, questions, aiRecord] = await Promise.all([
    repo.listTurns(conversationId, 1000),
    repo.listAnswers(conversationId),
    repo.listTemplateQuestions(conversation.template_id),
    repo.getAiSuggestedDirections(conversationId),
  ]);

  const aiPayload = aiRecord?.payload_json ?? null;
  ensureAiSuggestionsReady(aiPayload);

  const answered = findAnsweredQuestions(questions, answers);
  const generatedAtIso = new Date().toISOString();
  const safeConversationId = sanitizeConversationId(conversationId);
  const stamp = buildTimestampForFilename(new Date(generatedAtIso));
  const language = aiRecord?.language ?? "en";

  switch (format) {
    case "chat_history_txt": {
      return {
        filename: `chat-history-${safeConversationId}-${stamp}.txt`,
        contentType: "text/plain",
        body: buildChatHistoryTxt({
          conversationId,
          language,
          turns,
          answeredCount: answered.length,
          generatedAtIso,
        }),
      };
    }
    case "question_sheet_md": {
      return {
        filename: `question-sheet-${safeConversationId}-${stamp}.md`,
        contentType: "text/markdown",
        body: buildQuestionSheetMd({
          conversationId,
          language,
          turnsCount: turns.length,
          answered,
          generatedAtIso,
        }),
      };
    }
    case "question_sheet_txt": {
      return {
        filename: `question-sheet-${safeConversationId}-${stamp}.txt`,
        contentType: "text/plain",
        body: buildQuestionSheetTxt({
          conversationId,
          language,
          turnsCount: turns.length,
          answered,
          generatedAtIso,
        }),
      };
    }
    case "ai_direction_report_md": {
      return {
        filename: `ai-direction-report-${safeConversationId}-${stamp}.md`,
        contentType: "text/markdown",
        body: buildAiDirectionReportMd({
          conversationId,
          language,
          turnsCount: turns.length,
          answeredCount: answered.length,
          aiPayload: aiPayload as SuperV1AiSuggestedDirectionsPayload,
          generatedAtIso,
        }),
      };
    }
    default:
      throw new SuperV1RuntimeError("SUPERV1_RUNTIME_ERROR", `Unsupported export format: ${format}`, 400);
  }
}

