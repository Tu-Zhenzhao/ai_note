import { randomUUID } from "crypto";
import { CompletionState, InterviewState, PlannerAction, QuestionStyle, QuestionType } from "@/lib/types";
import { getInterviewRepository } from "@/server/repo";
import { recallChatBook, recallUnresolvedConflicts } from "@/server/planner/retrieval";
import { getCurrentSectionName, selectBestChecklistTarget } from "@/server/rules/checklist";
import {
  getOpenPreviewSlotsForSectionIndex,
  selectNextPreviewSlot,
  syncPreviewSlots,
} from "@/server/services/preview-slots";
import { syncWorkflowState } from "@/server/services/workflow";
import {
  toolAppendChatBook,
  toolBuildCheckpointPreview,
  toolEvaluateCompletion,
  toolExtractFacts,
  toolMarkConflict,
  toolPrepareBriefCandidate,
  toolSelectNextQuestion,
  toolUpdatePayload,
} from "@/server/planner/tools";

export interface PlannerTurnDecision {
  plannerAction: PlannerAction;
  questionStyle: QuestionStyle;
  questionType: QuestionType;
  nextQuestion: string;
  rationale: string;
  targetFields: string[];
  checkpointRecommended: boolean;
  userFacingProgressNote: string;
  sectionAdvanced: boolean;
  currentSectionName: string;
}

function normalizeQuestion(question: string) {
  return question.toLowerCase().replace(/\s+/g, " ").trim();
}

function humanProgressNote(state: InterviewState) {
  const diagnostics = state.system_assessment.last_turn_diagnostics;
  const captured = diagnostics.captured_fields_this_turn.length;
  const checklistAdvanced = diagnostics.captured_checklist_items_this_turn.length;
  const conflicts = diagnostics.conflicts_detected.length;
  const deferred = diagnostics.deferred_fields.length;

  if (captured >= 3 || checklistAdvanced >= 2) return "Great progress. I captured several strategic details from your last answer.";
  if (captured > 0) return "Good progress. I captured a new detail we can build on.";
  if (conflicts > 0) return "I found one conflicting detail, so I will reconcile it once and keep moving.";
  if (deferred > 0) return "We deferred one detail for now so the conversation can keep momentum.";
  return "I still need one focused detail to strengthen this section.";
}

/**
 * v3 planner decision policy (Architecture Doc 12.9):
 * 1. Resolve contradictions first → confirm
 * 2. Fill critical knowledge gaps → ask
 * 3. Stabilize understanding (large info received) → summarize
 * 4. Pause for verification (mostly complete) → checkpoint
 * 5. Escalate when confidence drops → handoff
 * 6. Generate only after checkpoint approval → generate_brief
 */
export async function runPlannerTurn(params: {
  sessionId: string;
  turnId: string;
  userMessage: string;
  state: InterviewState;
  completionState?: CompletionState;
}): Promise<PlannerTurnDecision> {
  const repo = getInterviewRepository();
  const now = new Date().toISOString();

  // ── Tool sequence: extract → update → chat book → conflicts → evaluate ─

  const extracted = await toolExtractFacts({
    repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    state: params.state,
    userMessage: params.userMessage,
  });

  await toolUpdatePayload({
    repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    capturedFields: extracted.captured_fields_this_turn,
  });

  const startIndex = params.state.conversation_meta.current_section_index;
  syncWorkflowState(params.state);
  const sectionResult = {
    advanced: false,
    newIndex: params.state.conversation_meta.current_section_index,
    sectionName: getCurrentSectionName(params.state),
  };
  syncPreviewSlots(params.state);
  const openInCurrent = getOpenPreviewSlotsForSectionIndex(
    params.state,
    params.state.conversation_meta.current_section_index,
  );
  console.log("[planner] Section advancement:", {
    advanced: sectionResult.advanced,
    newIndex: sectionResult.newIndex,
    sectionName: sectionResult.sectionName,
    capturedFields: extracted.captured_fields_this_turn.length,
    capturedChecklist: extracted.captured_checklist_items_this_turn.length,
    stillOpenInSection: openInCurrent.map((slot) => `${slot.id}(${slot.status})`),
  });

  await toolAppendChatBook({
    repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    state: params.state,
    facts: extracted.direct_user_fact,
    inferences: extracted.assistant_inference,
  });

  if (extracted.conflicts_detected.length > 0) {
    await toolMarkConflict({
      repo,
      sessionId: params.sessionId,
      turnId: params.turnId,
      conflicts: extracted.conflicts_detected,
      module: params.state.conversation_meta.current_focus_modules[0] ?? "company_profile",
    });
  }

  const completion = await toolEvaluateCompletion({
    repo,
    sessionId: params.sessionId,
    turnId: params.turnId,
    state: params.state,
    completionState: params.completionState,
  });

  // ── Recall context ─

  const unresolved = recallUnresolvedConflicts(params.state.system_assessment.pending_conflicts);
  const reconcilableConflict = unresolved.find((conflict) => conflict.asks < 1);
  for (const conflict of unresolved) {
    if (conflict.asks >= 1) {
      conflict.status = "downgraded";
      conflict.updated_at = now;
    }
  }

  const recalled = await recallChatBook({
    repo,
    sessionId: params.sessionId,
    query: params.userMessage,
    module: params.state.conversation_meta.current_focus_modules[0],
    limit: 6,
  });

  // ── v3 Priority-Based Decision Policy ─

  let plannerAction: PlannerAction = "ask";
  let questionStyle: QuestionStyle = "reflect_and_advance";
  let questionType: QuestionType = "clarify";
  let nextQuestion = "Could you share one concrete detail so we can keep building this strategy?";
  let rationale = "Default ask move to maintain forward momentum.";
  let targetFields: string[] = [];
  let checkpointRecommended = false;

  const criticalOpen = openInCurrent.filter(
    (slot) =>
      slot.blocking_priority === "critical" ||
      slot.blocking_priority === "high",
  );
  const capturedCount = extracted.captured_fields_this_turn.length;
  const nextPreviewSlot = selectNextPreviewSlot(params.state);

  // Priority 1: Resolve contradictions first
  if (reconcilableConflict) {
    plannerAction = "confirm";
    questionStyle = "resolve_conflict_once";
    questionType = "confirm";
    const conflict = reconcilableConflict;
    nextQuestion = `I heard two versions here (${conflict.conflicting_values.join(" vs ")}). Which one should I keep?`;
    rationale = `Pending conflict for ${conflict.field} requires one reconciliation turn.`;
    targetFields = [conflict.field];
    conflict.asks += 1;
    conflict.updated_at = now;
  }
  // Priority 5 (checked early): Escalate when confidence drops / handoff conditions
  else if (completion.completion_level === "handoff_ready") {
    plannerAction = "handoff";
    questionStyle = "handoff_explain";
    questionType = "confirm";
    nextQuestion = "Do you want me to package this into a human handoff summary now?";
    rationale = "Complexity/fatigue conditions indicate handoff readiness.";
  }
  // Priority 6: Generate only after checkpoint approval
  else if (completion.generation_permission_flag && params.state.system_assessment.checkpoint_approved) {
    plannerAction = "generate_brief";
    questionStyle = "guided_choice";
    questionType = "confirm";
    const candidate = await toolPrepareBriefCandidate({
      repo,
      sessionId: params.sessionId,
      turnId: params.turnId,
      state: params.state,
    });
    nextQuestion = `I can generate the first brief now. Use "${candidate.topic}" in ${candidate.format}?`;
    rationale = "Hard blockers cleared and checkpoint approved.";
  }
  // Priority 4: Pause for verification / checkpoint
  else if (
    completion.completion_score >= 65 ||
    params.state.system_assessment.user_fatigue_risk === "high" ||
    params.state.system_assessment.next_action === "checkpoint"
  ) {
    plannerAction = "checkpoint";
    questionStyle = "checkpoint_summary";
    questionType = "confirm";
    checkpointRecommended = true;
    const snapshot = await toolBuildCheckpointPreview({
      repo,
      sessionId: params.sessionId,
      turnId: params.turnId,
      state: params.state,
    });
    const weak = params.state.system_assessment.weak_fields.slice(0, 2).join(", ") || "none";
    const missing = params.state.system_assessment.missing_fields.slice(0, 2).join(", ") || "none";
    nextQuestion = `I prepared a checkpoint summary. Should we confirm it now and then close weak areas (${weak}; missing: ${missing})?`;
    rationale = `Checkpoint preferred with score ${completion.completion_score} and fatigue ${params.state.system_assessment.user_fatigue_risk}.`;
    await repo.addChatBookEntry({
      id: randomUUID(),
      session_id: params.sessionId,
      entry_type: "strategy_note",
      text: `Checkpoint snapshot created with sections: ${Object.keys(snapshot).join(", ")}`,
      module: params.state.conversation_meta.current_focus_modules[0] ?? "company_profile",
      confidence: 0.8,
      status: "active",
      source_turn_ids: [params.turnId],
      metadata_json: {},
      created_at: now,
    });
  }
  // Priority 3: Stabilize understanding when user gave rich info
  else if (capturedCount >= 3) {
    plannerAction = "summarize";
    questionStyle = "synthesize_and_confirm";
    questionType = "confirm";
    nextQuestion = "You shared a lot of useful detail. Let me summarize what I have so far — does this sound right?";
    rationale = `Captured ${capturedCount} fields this turn; stabilizing understanding before probing further.`;
  }
  // Priority 2: Fill critical knowledge gaps
  else if (criticalOpen.length > 0) {
    const next = await toolSelectNextQuestion({
      repo,
      sessionId: params.sessionId,
      turnId: params.turnId,
      state: params.state,
    });
    plannerAction = next.questionType === "confirm" ? "confirm" : "ask";
    questionStyle = next.questionType === "confirm" ? "synthesize_and_confirm" : "reflect_and_advance";
    questionType = next.questionType;
    nextQuestion = next.nextQuestion;
    rationale = next.questionReason;
    targetFields = [next.targetField];
  }
  // Default: use checklist-driven question selection
  else {
    const next = await toolSelectNextQuestion({
      repo,
      sessionId: params.sessionId,
      turnId: params.turnId,
      state: params.state,
    });
    plannerAction = next.questionType === "confirm" ? "confirm" : "ask";
    questionStyle = next.questionType === "confirm" ? "synthesize_and_confirm" : "reflect_and_advance";
    questionType = next.questionType;
    nextQuestion = next.nextQuestion;
    rationale = next.questionReason;
    targetFields = [next.targetField];
  }

  // ── Anti-repeat guard ─

  const messages = await repo.listMessages(params.sessionId);
  const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant")?.content ?? "";
  const repeatedQuestion = normalizeQuestion(lastAssistant).includes(normalizeQuestion(nextQuestion));
  if (repeatedQuestion && unresolved.length === 0) {
    plannerAction = "summarize";
    questionStyle = "synthesize_and_confirm";
    questionType = "confirm";
    nextQuestion = "I may be over-asking here. Does the current summary feel accurate enough to move forward?";
    rationale = "Anti-repeat guard switched to summarize+confirm.";
  }

  // ── Enrich rationale with recalled context ─

  if (recalled.length > 0 && plannerAction === "ask") {
    const latest = recalled[0].entry.text;
    rationale = `${rationale} Recalled recent context: ${latest.slice(0, 80)}`;
  }

  const userFacingProgressNote = humanProgressNote(params.state);

  // ── Persist planner decision ─

  await repo.addPlannerDecision({
    id: randomUUID(),
    session_id: params.sessionId,
    turn_id: params.turnId,
    chosen_action: plannerAction,
    question_style: questionStyle,
    rationale,
    target_fields: targetFields,
    created_at: now,
  });

  // ── Write v3 planner state ─

  params.state.conversation_meta.last_planner_move = plannerAction;
  params.state.conversation_meta.last_planner_reason = rationale;
  params.state.system_assessment.last_planner_action = plannerAction;
  params.state.system_assessment.last_question_style = questionStyle;
  params.state.system_assessment.checkpoint_recommended = checkpointRecommended;
  params.state.system_assessment.last_user_facing_progress_note = userFacingProgressNote;
  params.state.system_assessment.recommended_next_question = nextQuestion;
  params.state.system_assessment.planner_confidence = completion.planner_confidence;

  // Update focus modules based on target fields
  if (targetFields.length > 0) {
    const modules = Array.from(new Set(targetFields.map((f) => f.split(".")[0])));
    params.state.conversation_meta.current_focus_modules = modules;
  }

  // Update focus checklist IDs
  const bestTarget = selectBestChecklistTarget(params.state);
  if (bestTarget) {
    params.state.conversation_meta.current_focus_checklist_ids = [bestTarget.id];
  } else if (nextPreviewSlot) {
    params.state.conversation_meta.current_focus_checklist_ids =
      nextPreviewSlot.checklist_item_ids;
  }

  return {
    plannerAction,
    questionStyle,
    questionType,
    nextQuestion,
    rationale,
    targetFields,
    checkpointRecommended,
    userFacingProgressNote,
    sectionAdvanced: sectionResult.advanced || params.state.conversation_meta.current_section_index !== startIndex,
    currentSectionName: sectionResult.sectionName,
  };
}
