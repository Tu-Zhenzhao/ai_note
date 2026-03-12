import { randomUUID } from "crypto";
import { CompletionState, InterviewState } from "@/lib/types";
import { evaluateCompletion } from "@/server/rules/completion";
import { planFollowUp } from "@/server/rules/followup";
import { composePreview } from "@/server/services/preview";
import { InterviewRepository } from "@/server/repo/contracts";

/**
 * v3 tool calling contract: every tool call is logged with
 * { tool, reason, arguments } structure for traceability.
 */
async function logTool(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  toolName: string;
  reason: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  success: boolean;
}) {
  const entry = {
    id: randomUUID(),
    session_id: params.sessionId,
    turn_id: params.turnId,
    tool_name: params.toolName,
    input_json: { tool: params.toolName, reason: params.reason, arguments: params.input },
    output_json: params.output,
    success: params.success,
    created_at: new Date().toISOString(),
  };
  await params.repo.addToolActionLog(entry);
  return entry.id;
}

export async function toolExtractFacts(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  state: InterviewState;
  userMessage: string;
}) {
  const diagnostics = params.state.system_assessment.last_turn_diagnostics;
  const output = {
    direct_user_fact: diagnostics.direct_user_facts,
    assistant_inference: diagnostics.assistant_inferences,
    confidence: diagnostics.confidence,
    evidence_link: diagnostics.evidence_links,
    captured_fields_this_turn: diagnostics.captured_fields_this_turn,
    captured_checklist_items_this_turn: diagnostics.captured_checklist_items_this_turn,
    conflicts_detected: diagnostics.conflicts_detected,
  };
  const traceId = await logTool({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "extract_facts",
    reason: "Extract structured facts from user message",
    input: { user_message: params.userMessage },
    output,
    success: true,
  });
  params.state.conversation_meta.tool_call_trace_ids.push(traceId);
  params.state.system_assessment.tool_calls_this_turn.push("extract_facts");
  return output;
}

export async function toolUpdatePayload(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  capturedFields: string[];
}) {
  const patch = {
    captured_fields: params.capturedFields,
    captured_count: params.capturedFields.length,
  };
  await params.repo.addPayloadPatchLog({
    id: randomUUID(),
    session_id: params.sessionId,
    turn_id: params.turnId,
    patch_json: patch,
    applied_by_tool: "update_checklist",
    created_at: new Date().toISOString(),
  });
  await logTool({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "update_checklist",
    reason: "Move checklist items forward based on evidence",
    input: { captured_fields: params.capturedFields },
    output: patch,
    success: true,
  });
  return patch;
}

export async function toolAppendChatBook(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  state: InterviewState;
  facts: string[];
  inferences: string[];
}) {
  const module = params.state.conversation_meta.current_focus_modules[0] ?? "company_profile";
  let inserted = 0;

  for (const fact of params.facts) {
    if (!fact.trim()) continue;
    await params.repo.addChatBookEntry({
      id: randomUUID(),
      session_id: params.sessionId,
      entry_type: "direct_user_fact",
      text: fact.trim(),
      module,
      confidence: 0.9,
      status: "active",
      source_turn_ids: [params.turnId],
      metadata_json: {},
      created_at: new Date().toISOString(),
    });
    inserted += 1;
  }

  for (const inference of params.inferences) {
    if (!inference.trim()) continue;
    await params.repo.addChatBookEntry({
      id: randomUUID(),
      session_id: params.sessionId,
      entry_type: "assistant_inference",
      text: inference.trim(),
      module,
      confidence: 0.65,
      status: "active",
      source_turn_ids: [params.turnId],
      metadata_json: {},
      created_at: new Date().toISOString(),
    });
    inserted += 1;
  }

  await logTool({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "append_chat_book",
    reason: "Record user facts and assistant inferences in chat memory",
    input: { facts: params.facts.length, inferences: params.inferences.length },
    output: { inserted },
    success: true,
  });

  return { inserted };
}

export async function toolMarkConflict(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  conflicts: string[];
  module: string;
}) {
  let inserted = 0;
  for (const field of params.conflicts) {
    await params.repo.addChatBookEntry({
      id: randomUUID(),
      session_id: params.sessionId,
      entry_type: "conflict",
      text: `Potential contradiction detected for ${field}`,
      module: params.module,
      confidence: 0.4,
      status: "active",
      source_turn_ids: [params.turnId],
      metadata_json: { field },
      created_at: new Date().toISOString(),
    });
    inserted += 1;
  }

  await logTool({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "mark_conflict",
    reason: "Record contradictions or uncertainty for reconciliation",
    input: { conflicts: params.conflicts },
    output: { inserted },
    success: true,
  });

  return { inserted };
}

export async function toolEvaluateCompletion(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  state: InterviewState;
  completionState?: CompletionState;
}) {
  const completion = params.completionState ?? evaluateCompletion(params.state);
  await logTool({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "evaluate_completion",
    reason: "Recompute interview readiness and missing areas",
    input: {},
    output: {
      completion_level: completion.completion_level,
      completion_score: completion.completion_score,
      blockers: completion.red_line_blockers,
      verification_coverage: completion.verification_coverage,
      evidence_confidence: completion.evidence_confidence_score,
      open_checklist_items: completion.open_checklist_items.length,
    },
    success: true,
  });
  return completion;
}

export async function toolBuildCheckpointPreview(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  state: InterviewState;
}) {
  const latestPreview = composePreview(params.state) as Record<string, any>;
  const proj = latestPreview.sections;
  const summary = {
    company_understanding: proj?.company_understanding ?? {},
    audience_understanding: proj?.audience_understanding ?? {},
    linkedin_content_strategy: proj?.linkedin_content_strategy ?? {},
    evidence_and_proof_assets: proj?.evidence_and_proof_assets ?? {},
    ai_suggested_content_directions: proj?.ai_suggested_content_directions ?? [],
    generation_plan: proj?.generation_plan ?? {},
    open_items: latestPreview.open_items ?? [],
    weak_missing_unconfirmed: latestPreview.weak_missing_unconfirmed ?? {},
  };

  await params.repo.addCheckpointSnapshot({
    id: randomUUID(),
    session_id: params.sessionId,
    snapshot_json: summary,
    user_confirmed: false,
    created_at: new Date().toISOString(),
  });

  await params.repo.addChatBookEntry({
    id: randomUUID(),
    session_id: params.sessionId,
    entry_type: "checkpoint",
    text: "Planner prepared checkpoint summary before next generation transition.",
    module: params.state.conversation_meta.current_focus_modules[0] ?? "company_profile",
    confidence: 0.8,
    status: "active",
    source_turn_ids: [params.turnId],
    metadata_json: {},
    created_at: new Date().toISOString(),
  });

  await logTool({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "build_preview",
    reason: "Build the live preview panel from structured state",
    input: {},
    output: {
      has_company: !!summary.company_understanding?.company_summary,
      missing_count: params.state.system_assessment.missing_fields.length,
      weak_count: params.state.system_assessment.weak_fields.length,
      open_items_count: (latestPreview.open_items ?? []).length,
    },
    success: true,
  });
  return summary;
}

/**
 * v3: prepare_checkpoint — generate a checkpoint summary for user review.
 * Separate from build_preview; this specifically creates the checkpoint artifact.
 */
export async function toolPrepareCheckpoint(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  state: InterviewState;
}) {
  const latestPreview = composePreview(params.state) as Record<string, any>;
  const proj = latestPreview.sections;

  const checkpointSummary = {
    company: proj?.company_understanding?.company_summary ?? "Not yet defined",
    audience: proj?.audience_understanding?.primary_audience ?? "Not yet defined",
    strategy: proj?.linkedin_content_strategy?.main_content_goal ?? "Not yet defined",
    evidence: proj?.evidence_and_proof_assets?.narrative_proof ?? [],
    open_items: latestPreview.open_items ?? [],
    completion_score: params.state.system_assessment.global_completion_score,
    verification_coverage: params.state.system_assessment.confidence_scores.verification_confidence,
  };

  const snapshotId = randomUUID();
  await params.repo.addCheckpointSnapshot({
    id: snapshotId,
    session_id: params.sessionId,
    snapshot_json: checkpointSummary,
    user_confirmed: false,
    created_at: new Date().toISOString(),
  });

  await logTool({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "prepare_checkpoint",
    reason: "Generate a checkpoint summary for user review",
    input: {},
    output: { snapshot_id: snapshotId, score: checkpointSummary.completion_score },
    success: true,
  });

  return checkpointSummary;
}

export async function toolSelectNextQuestion(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  state: InterviewState;
}) {
  const plan = planFollowUp(params.state);
  await logTool({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "select_next_question",
    reason: "Determine the best next question based on current gaps",
    input: {
      fatigue: params.state.system_assessment.user_fatigue_risk,
      open_checklist_items: params.state.system_assessment.open_checklist_items.length,
    },
    output: {
      next_question: plan.nextQuestion,
      question_type: plan.questionType,
      target_field: plan.targetField,
      question_reason: plan.questionReason,
    },
    success: true,
  });
  return plan;
}

export async function toolPrepareBriefCandidate(params: {
  repo: InterviewRepository;
  sessionId: string;
  turnId: string;
  state: InterviewState;
}) {
  const topic = params.state.content_readiness.ai_suggested_first_content_topic.value;
  const format = params.state.content_readiness.ai_suggested_first_content_format.value || "LinkedIn Carousel";
  const goal = params.state.linkedin_content_strategy.primary_content_goal.value;
  const candidate = {
    topic: topic || "Practical strategy breakdown for your target audience",
    format,
    goal: goal || "Build authority and attract qualified inbound conversations",
  };
  await logTool({
    repo: params.repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    toolName: "prepare_brief_candidate",
    reason: "Produce the structured strategist brief candidate",
    input: {},
    output: candidate,
    success: true,
  });
  return candidate;
}
