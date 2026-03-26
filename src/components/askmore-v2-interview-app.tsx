"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentRuntimeProgress,
  RuntimeProgressItem,
  RuntimeProgressPhase,
} from "@/components/agent-runtime-progress";

type AskmoreV2Language = "en" | "zh";

type FlowQuestion = {
  question_id: string;
  original_question: string;
  entry_question: string;
  sub_questions: string[];
  example_answer_styles: string[];
  recommended_strategy: string;
  source_mode: "use_original" | "use_ai_refined" | "custom_manual";
};

type FlowVersion = {
  id: string;
  version: number;
  status: "draft" | "published";
  published_at: string | null;
  flow_jsonb: {
    schema_version?: number;
    scenario: string;
    target_output_type: string;
    language: AskmoreV2Language;
    final_flow_questions: FlowQuestion[];
  };
};

type ActiveFlowResponse = {
  flow: FlowVersion | null;
  error?: string;
};

type SessionListItem = {
  id: string;
  status: "in_progress" | "completed";
  turn_count: number;
  flow_version_id: string;
  created_at: string;
  updated_at: string;
  current_question_id: string | null;
};

type SessionMessage = {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  message_text: string;
  created_at: string;
};

type SessionState = {
  session: {
    current_question_id: string | null;
    current_sub_question_index: number;
    active_turn_index?: number;
    pending_intent?: "answer_question" | "ask_for_help" | "clarify_meaning" | "other_discussion" | null;
    pending_commitments?: Array<{
      id: string;
      type: "micro_confirm" | "pending_correction" | "follow_up";
      status?: "pending" | "resolved" | "expired";
      question_id: string;
      dimension_id?: string | null;
      note?: string | null;
      created_at: string;
      expires_at?: string | null;
    }>;
    summary_generated: boolean;
    finalized: boolean;
    pending_end_confirmation: boolean;
    last_missing_points: string[];
    last_understanding_feedback: string | null;
  };
  question_progress: Record<
    string,
    {
      question_id: string;
      status: "empty" | "partial" | "completed" | "skipped";
      times_asked: number;
      follow_up_count: number;
      coverage_score: number;
    }
  >;
  structured_knowledge: Record<
    string,
    {
      value: unknown;
      confidence: number;
      confirmed: boolean;
      updated_at: string;
    }
  >;
  latest_summary_text: string | null;
  latest_structured_report: {
    overview?: string;
    confirmed_points?: string[];
    open_points?: string[];
    next_steps?: string[];
  } | null;
  runtime_meta?: {
    last_task_module?: string;
    last_transition_reason?: string;
    latest_visible_summary?: string;
    last_help_obstacle_layer?: "concept" | "observation" | "judgement" | "expression" | "scope";
    last_help_resolution_goal?: "identify_behavior_signal" | "estimate_frequency" | "describe_duration" | "describe_timeline";
    last_help_reconnect_target?: string;
  };
  nodes?: Record<
    string,
    {
      target_dimensions: Array<{
        id: string;
        label: string;
      }>;
      completion_criteria?: string[];
    }
  >;
  node_runtime?: Record<
    string,
    {
      dimension_state?: Record<string, "unanswered" | "answered_unstructured" | "micro_confirm_pending" | "structured_confirmed">;
      dimension_confidence?: Record<string, number>;
      dimension_answered?: Record<string, boolean>;
      dimension_priority_current?: Record<string, "must" | "optional">;
      dimension_priority_downgraded_by_limit?: Record<string, boolean>;
    }
  >;
};

type StartResponse = {
  session_id: string;
  flow_version_id: string;
  opening_turn: string;
  state: SessionState;
  error?: string;
};

type SessionDetailResponse = {
  session: {
    id: string;
    flow_version_id: string;
    status: "in_progress" | "completed";
    turn_count: number;
    state_jsonb: SessionState;
    created_at: string;
    updated_at: string;
  };
  messages: SessionMessage[];
  flow_questions: FlowQuestion[] | null;
  error?: string;
};

type TurnResponse = {
  session_id: string;
  turn_id: string;
  state: SessionState;
  routed_intent: {
    intent: "answer_question" | "ask_for_help" | "clarify_meaning" | "other_discussion";
    confidence: number;
    rationale?: string;
  };
  events: VisibleEvent[];
  debug_events: DebugEvent[];
  next_question?: {
    question_id: string | null;
    question_text: string;
  } | null;
  response_blocks: ResponseBlock[];
  error?: string;
};

type AskmoreV2RuntimePhase =
  | "assemble_context"
  | "route_intent"
  | "execute_task"
  | "build_response"
  | "persist_and_finalize";

type TurnStreamEvent =
  | {
      type: "phase";
      phase: AskmoreV2RuntimePhase;
      status: "start" | "done";
      label?: string;
    }
  | {
      type: "final";
      payload: TurnResponse;
    }
  | {
      type: "error";
      error: string;
      code?: string;
    };

type AgentTraceView = {
  routed_intent: TurnResponse["routed_intent"];
  task_module?: string;
  transition_reason?: string;
  current_question_id: string | null;
  active_turn_index?: number;
  help_obstacle_layer?: "concept" | "observation" | "judgement" | "expression" | "scope";
  help_resolution_goal?: "identify_behavior_signal" | "estimate_frequency" | "describe_duration" | "describe_timeline";
  help_reconnect_target?: string;
  interaction_mode?: "micro_confirm" | "follow_up_select";
  interaction_badge?: string;
  pending_commitments: Array<{
    id: string;
    type: "micro_confirm" | "pending_correction" | "follow_up";
    status: "pending" | "resolved" | "expired";
    question_id: string | null;
    dimension_id?: string | null;
  }>;
};

type MicroConfirmOption = {
  option_id: string;
  label: string;
  normalized_value: string;
};

type ResponseBlock = {
  type: "understanding" | "micro_confirmation" | "micro_confirm_options" | "progress" | "next_question" | "example_answers" | "node_summary";
  content?: string;
  items?: string[];
  options?: MicroConfirmOption[];
  dimension_id?: string;
  allow_free_text?: boolean;
  mode?: "micro_confirm" | "follow_up_select";
  badge_label?: string;
  source_event_id?: string;
};

type VisibleEvent = {
  event_id: string;
  event_type:
    | "understanding"
    | "acknowledgement"
    | "why_this_matters"
    | "gentle_gap_prompt"
    | "help_explanation"
    | "help_examples"
    | "micro_confirm"
    | "transition"
    | "next_step";
  created_at: string;
  visible: boolean;
  payload: {
    content?: string;
    items?: string[];
    options?: MicroConfirmOption[];
    dimension_id?: string;
    allow_free_text?: boolean;
    mode?: "micro_confirm" | "follow_up_select";
    badge_label?: string;
  };
};

type DebugEvent = {
  event_id: string;
  event_type:
    | "understanding_summary"
    | "state_update"
    | "coverage_summary"
    | "gap_notice"
    | "help_explanation"
    | "help_examples"
    | "micro_confirm"
    | "transition_summary"
    | "next_question";
  created_at: string;
  visible: boolean;
  payload: {
    content?: string;
    items?: string[];
    options?: MicroConfirmOption[];
    dimension_id?: string;
    allow_free_text?: boolean;
    mode?: "micro_confirm" | "follow_up_select";
    badge_label?: string;
  };
};

type SummaryResponse = {
  summary_text: string;
  structured_report_json: {
    overview: string;
    confirmed_points: string[];
    open_points: string[];
    next_steps: string[];
  };
  error?: string;
};

type ChatRow = {
  id: string;
  role: "assistant" | "user";
  content: string;
  events?: VisibleEvent[];
  debugEvents?: DebugEvent[];
  responseBlocks?: ResponseBlock[];
  trace?: AgentTraceView;
};

type SummaryDialogState = {
  mode: "progressive" | "final";
  summaryText: string;
  report: SummaryResponse["structured_report_json"] | Record<string, unknown> | null;
} | null;

type SessionNodeRuntimeView = {
  dimension_state?: Record<string, "unanswered" | "answered_unstructured" | "micro_confirm_pending" | "structured_confirmed">;
  dimension_confidence?: Record<string, number>;
  dimension_answered?: Record<string, boolean>;
  dimension_priority_current?: Record<string, "must" | "optional">;
  dimension_priority_downgraded_by_limit?: Record<string, boolean>;
};

function questionStatusLabel(status: "empty" | "partial" | "completed" | "skipped") {
  if (status === "completed") return "已完成";
  if (status === "partial") return "进行中";
  if (status === "skipped") return "已跳过";
  return "待开始";
}

function isSummaryShortcutInput(text: string): boolean {
  return /(summary|summarize|show summary|总结|小结|概括|汇总|看总结|先看总结)/i.test(text);
}

function normalizeDimensionText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function subQuestionStatusInfo(params: {
  dimensionId: string | null;
  nodeRuntime: SessionNodeRuntimeView | undefined;
}) {
  if (!params.dimensionId || !params.nodeRuntime) {
    return { label: "待回答", tone: "todo" as const };
  }
  const state = params.nodeRuntime.dimension_state?.[params.dimensionId];
  if (state === "structured_confirmed") return { label: "已确认", tone: "confirmed" as const };
  if (state === "micro_confirm_pending") return { label: "待确认", tone: "pending" as const };
  if (state === "answered_unstructured") return { label: "已回答", tone: "answered" as const };

  const confidence = Number(params.nodeRuntime.dimension_confidence?.[params.dimensionId] ?? 0);
  if (confidence >= 0.6) return { label: "已确认", tone: "confirmed" as const };
  if (confidence > 0) return { label: "已回答", tone: "answered" as const };
  if (params.nodeRuntime.dimension_answered?.[params.dimensionId]) return { label: "已回答", tone: "answered" as const };
  return { label: "待回答", tone: "todo" as const };
}

function subQuestionPriorityInfo(params: {
  dimensionId: string | null;
  nodeRuntime: SessionNodeRuntimeView | undefined;
  completionCriteria: string[];
}) {
  if (!params.dimensionId) {
    return {
      label: "可选",
      tone: "optional" as const,
      downgradedByLimit: false,
    };
  }
  const runtimePriority = params.nodeRuntime?.dimension_priority_current?.[params.dimensionId];
  const fallbackPriority = params.completionCriteria.includes(params.dimensionId) ? "must" : "optional";
  const priority = runtimePriority ?? fallbackPriority;
  return {
    label: priority === "must" ? "必问" : "可选",
    tone: priority === "must" ? "must" as const : "optional" as const,
    downgradedByLimit: Boolean(params.nodeRuntime?.dimension_priority_downgraded_by_limit?.[params.dimensionId]),
  };
}

function eventsToRenderBlocks(events: VisibleEvent[]): ResponseBlock[] {
  const blocks: ResponseBlock[] = [];
  for (const event of events) {
    if (!event.visible) continue;
    if (
      event.event_type === "understanding"
      || event.event_type === "acknowledgement"
      || event.event_type === "why_this_matters"
      || event.event_type === "help_explanation"
      || event.event_type === "gentle_gap_prompt"
    ) {
      if (event.payload.content) blocks.push({ type: "understanding", content: event.payload.content });
      continue;
    }
    if (event.event_type === "help_examples") {
      if ((event.payload.items ?? []).length > 0) blocks.push({ type: "example_answers", items: event.payload.items });
      continue;
    }
    if (event.event_type === "micro_confirm") {
      if ((event.payload.options ?? []).length > 0) {
        blocks.push({
          type: "micro_confirm_options",
          content: event.payload.content,
          options: event.payload.options,
          dimension_id: event.payload.dimension_id,
          allow_free_text: event.payload.allow_free_text,
          mode: event.payload.mode ?? "micro_confirm",
          badge_label: event.payload.badge_label,
          source_event_id: event.event_id,
        });
      } else if (event.payload.content) {
        blocks.push({ type: "micro_confirmation", content: event.payload.content });
      }
      continue;
    }
    if (event.event_type === "transition") {
      if (event.payload.content) blocks.push({ type: "node_summary", content: event.payload.content });
      continue;
    }
    if (event.event_type === "next_step") {
      if ((event.payload.options ?? []).length > 0) {
        blocks.push({
          type: "micro_confirm_options",
          content: event.payload.content,
          options: event.payload.options,
          dimension_id: event.payload.dimension_id,
          allow_free_text: event.payload.allow_free_text,
          mode: event.payload.mode ?? "follow_up_select",
          badge_label: event.payload.badge_label,
          source_event_id: event.event_id,
        });
      } else if (event.payload.content) {
        blocks.push({ type: "next_question", content: event.payload.content });
      }
    }
  }
  return blocks.slice(0, 4);
}

function composeAssistantTextFromBlocks(blocks: ResponseBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === "example_answers") {
      if ((block.items ?? []).length === 0) continue;
      lines.push("你可以这样回答：");
      for (const item of (block.items ?? []).slice(0, 4)) {
        lines.push(`- ${item}`);
      }
      continue;
    }
    if (block.type === "micro_confirm_options") {
      if (block.content) lines.push(block.content);
      for (const option of (block.options ?? []).slice(0, 4)) {
        lines.push(`- ${option.option_id}. ${option.label}`);
      }
      continue;
    }
    if (block.content?.trim()) lines.push(block.content.trim());
  }
  return lines.join("\n\n").trim();
}

function debugEventTypeLabel(eventType: DebugEvent["event_type"]): string {
  if (eventType === "understanding_summary") return "理解";
  if (eventType === "state_update") return "状态更新";
  if (eventType === "coverage_summary") return "覆盖评估";
  if (eventType === "gap_notice") return "缺口识别";
  if (eventType === "help_explanation") return "帮助解释";
  if (eventType === "help_examples") return "帮助示例";
  if (eventType === "micro_confirm") return "微确认";
  if (eventType === "transition_summary") return "过渡判断";
  if (eventType === "next_question") return "下一动作";
  return eventType;
}

function buildEventActionText(event: DebugEvent): string {
  const content = event.payload.content?.trim();
  if (content) return content;
  if ((event.payload.items ?? []).length > 0) return `示例 ${event.payload.items?.length ?? 0} 条`;
  if ((event.payload.options ?? []).length > 0) return `确认选项 ${(event.payload.options ?? []).length} 个`;
  return "已执行";
}

function buildEventMetaText(event: DebugEvent): string {
  const parts: string[] = [];
  const time = new Date(event.created_at);
  if (!Number.isNaN(time.getTime())) parts.push(`time ${time.toLocaleTimeString("zh-CN", { hour12: false })}`);
  if (event.payload.dimension_id) parts.push(`dimension ${event.payload.dimension_id}`);
  if (event.payload.mode) parts.push(`mode ${event.payload.mode}`);
  if ((event.payload.items ?? []).length > 0) parts.push(`items ${event.payload.items?.length ?? 0}`);
  if ((event.payload.options ?? []).length > 0) parts.push(`options ${(event.payload.options ?? []).length}`);
  return parts.join(" · ");
}

function compactTraceFromTurn(payload: TurnResponse): AgentTraceView {
  const interactionEvent = (payload.events ?? []).find((event) => (event.payload.options ?? []).length > 0);
  const pending = (payload.state.session.pending_commitments ?? []).map((item) => ({
    id: item.id,
    type: item.type,
    status: item.status ?? "pending",
    question_id: item.question_id,
    dimension_id: item.dimension_id ?? null,
  }));
  return {
    routed_intent: payload.routed_intent,
    task_module: payload.state.runtime_meta?.last_task_module,
    transition_reason: payload.state.runtime_meta?.last_transition_reason,
    current_question_id: payload.state.session.current_question_id,
    active_turn_index: payload.state.session.active_turn_index,
    help_obstacle_layer: payload.state.runtime_meta?.last_help_obstacle_layer,
    help_resolution_goal: payload.state.runtime_meta?.last_help_resolution_goal,
    help_reconnect_target: payload.state.runtime_meta?.last_help_reconnect_target,
    interaction_mode: interactionEvent?.payload.mode,
    interaction_badge: interactionEvent?.payload.badge_label,
    pending_commitments: pending,
  };
}

const SESSION_STORAGE_KEY = "askmore_v2_session_id";

const RUNTIME_PHASE_FALLBACK_LABELS: Record<AskmoreV2RuntimePhase, { zh: string; en: string }> = {
  assemble_context: {
    zh: "正在整理你刚刚提供的信息",
    en: "Understanding your latest input",
  },
  route_intent: {
    zh: "正在判断你现在最需要的帮助方式",
    en: "Deciding the best response mode",
  },
  execute_task: {
    zh: "正在执行本轮任务并更新状态",
    en: "Executing this turn task and updating state",
  },
  build_response: {
    zh: "正在组织清晰、自然的回复",
    en: "Composing a clear and natural response",
  },
  persist_and_finalize: {
    zh: "正在保存结果并完成这一轮",
    en: "Saving this turn and finalizing",
  },
};

const PHASE_MIN_RUNNING_MS = 680;
const PHASE_SHRINK_MS = 320;
const PHASE_CHECK_REVEAL_MS = 220;
const PHASE_CHECK_HOLD_MS = 650;
const PHASE_CHECK_HOLD_DONE_MS = 760;
const PHASE_EXIT_MS = 220;
const PHASE_INTER_GAP_MS = 140;

export function AskmoreV2InterviewApp() {
  const [language, setLanguage] = useState<AskmoreV2Language>("zh");
  const [activeFlow, setActiveFlow] = useState<FlowVersion | null>(null);
  const [activeQuestions, setActiveQuestions] = useState<FlowQuestion[]>([]);
  const [activeFlowLoading, setActiveFlowLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [flowVersionId, setFlowVersionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [interviewStatus, setInterviewStatus] = useState<"idle" | "in_progress" | "completed">("idle");
  const [turnCount, setTurnCount] = useState(0);
  const [chatRows, setChatRows] = useState<ChatRow[]>([]);
  const [inputText, setInputText] = useState("");
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryDialog, setSummaryDialog] = useState<SummaryDialogState>(null);
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [sessionList, setSessionList] = useState<SessionListItem[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressPanelSize, setProgressPanelSize] = useState<"compact" | "standard" | "expanded">("standard");
  const [runtimeProgressItems, setRuntimeProgressItems] = useState<RuntimeProgressItem[]>([]);
  const [runtimeFallbackHint, setRuntimeFallbackHint] = useState<string | null>(null);

  const progressQueueRef = useRef<Array<{ phase: RuntimeProgressPhase; label: string }>>([]);
  const activePhaseRef = useRef<RuntimeProgressPhase | null>(null);
  const progressPhaseStartedAtRef = useRef<Partial<Record<RuntimeProgressPhase, number>>>({});
  const progressPhaseDoneRequestedRef = useRef<Partial<Record<RuntimeProgressPhase, boolean>>>({});
  const progressPhaseCompletingRef = useRef<Partial<Record<RuntimeProgressPhase, boolean>>>({});
  const progressTimersRef = useRef<number[]>([]);
  const progressReadyResolversRef = useRef<Array<() => void>>([]);
  const activeTurnAbortRef = useRef<AbortController | null>(null);

  const orderedQuestions = useMemo(() => {
    return activeQuestions;
  }, [activeQuestions]);

  const progressStats = useMemo(() => {
    if (!sessionState || orderedQuestions.length === 0) {
      return {
        completedCount: 0,
        totalCount: orderedQuestions.length,
        progressRatio: 0,
      };
    }

    let completed = 0;
    for (const item of orderedQuestions) {
      const progress = sessionState.question_progress[item.question_id];
      if (progress?.status === "completed") completed += 1;
    }

    return {
      completedCount: completed,
      totalCount: orderedQuestions.length,
      progressRatio: orderedQuestions.length > 0 ? completed / orderedQuestions.length : 0,
    };
  }, [orderedQuestions, sessionState]);

  const structuredKnowledgeRows = useMemo(() => {
    if (!sessionState) return [];
    return Object.entries(sessionState.structured_knowledge)
      .filter(([, value]) => value.value != null && String(value.value).trim().length > 0)
      .sort((a, b) => b[1].confidence - a[1].confidence);
  }, [sessionState]);

  async function loadActiveFlow() {
    setActiveFlowLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/askmore_v2/builder/active-flow");
      const payload = (await response.json()) as ActiveFlowResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load active flow");
      }
      const nextFlow = payload.flow ?? null;
      setActiveFlow(nextFlow);
      if (!sessionId) {
        setActiveQuestions(nextFlow?.flow_jsonb.final_flow_questions ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load active flow");
    } finally {
      setActiveFlowLoading(false);
    }
  }

  const debugEnabled = process.env.NEXT_PUBLIC_ASKMORE_V2_DEBUG === "1";
  const isSessionTransitioning = Boolean(switchingSessionId || deletingSessionId);

  function isAbortError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof DOMException && error.name === "AbortError") return true;
    if (error instanceof Error && error.name === "AbortError") return true;
    return false;
  }

  function resolvePhaseLabel(
    phase: AskmoreV2RuntimePhase,
    providedLabel: string | undefined,
    lang: AskmoreV2Language,
  ): string {
    const trimmed = providedLabel?.trim();
    if (trimmed) return trimmed;
    const fallback = RUNTIME_PHASE_FALLBACK_LABELS[phase];
    return lang === "zh" ? fallback.zh : fallback.en;
  }

  function clearProgressTimers() {
    for (const timer of progressTimersRef.current) {
      window.clearTimeout(timer);
    }
    progressTimersRef.current = [];
  }

  function resolveProgressReadyWaiters() {
    if (activePhaseRef.current) return;
    if (progressQueueRef.current.length > 0) return;
    if (progressReadyResolversRef.current.length === 0) return;
    for (const resolve of progressReadyResolversRef.current) resolve();
    progressReadyResolversRef.current = [];
  }

  function resetRuntimeProgressState() {
    clearProgressTimers();
    progressQueueRef.current = [];
    activePhaseRef.current = null;
    progressPhaseStartedAtRef.current = {};
    progressPhaseDoneRequestedRef.current = {};
    progressPhaseCompletingRef.current = {};
    setRuntimeProgressItems([]);
    resolveProgressReadyWaiters();
  }

  function waitForProgressReady() {
    if (!activePhaseRef.current && progressQueueRef.current.length === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      progressReadyResolversRef.current.push(resolve);
    });
  }

  async function waitForProgressReadyWithTimeout(timeoutMs = 6000) {
    let timeoutHandle: number | null = null;
    let timedOut = false;
    await Promise.race([
      waitForProgressReady(),
      new Promise<void>((resolve) => {
        timeoutHandle = window.setTimeout(() => {
          timedOut = true;
          resolve();
        }, timeoutMs);
      }),
    ]);
    if (timeoutHandle != null) {
      window.clearTimeout(timeoutHandle);
    }
    if (timedOut) {
      if (debugEnabled) {
        console.warn("[askmore_v2_stream] progress_wait_timeout_force_reset", {
          active_phase: activePhaseRef.current,
          queued_phases: progressQueueRef.current.map((item) => item.phase),
        });
      }
      resetRuntimeProgressState();
    }
  }

  function updateCurrentPhaseStatus(status: RuntimeProgressItem["status"]) {
    const current = activePhaseRef.current;
    if (!current) return;
    setRuntimeProgressItems((prev) => {
      if (prev.length === 0) return prev;
      return [{ ...prev[0], status }];
    });
  }

  function maybeStartNextProgressPhase() {
    if (activePhaseRef.current) return;
    const next = progressQueueRef.current.shift();
    if (!next) {
      resolveProgressReadyWaiters();
      return;
    }
    const doneWasAlreadyRequested = Boolean(progressPhaseDoneRequestedRef.current[next.phase]);
    activePhaseRef.current = next.phase;
    progressPhaseStartedAtRef.current[next.phase] = Date.now();
    progressPhaseDoneRequestedRef.current[next.phase] = doneWasAlreadyRequested;
    progressPhaseCompletingRef.current[next.phase] = false;
    setRuntimeProgressItems([{ phase: next.phase, label: next.label, status: "running" }]);

    // `done` may have arrived while this phase was still queued.
    // In that case, complete it immediately after activation.
    if (doneWasAlreadyRequested) {
      const timer = window.setTimeout(() => {
        markProgressDoneAndRemove(next.phase as AskmoreV2RuntimePhase);
      }, 0);
      progressTimersRef.current.push(timer);
    }
  }

  function enqueueProgressPhase(phase: AskmoreV2RuntimePhase, label: string) {
    const existsInQueue = progressQueueRef.current.some((item) => item.phase === phase);
    if (activePhaseRef.current === phase || existsInQueue) return;
    progressQueueRef.current.push({ phase, label });
    maybeStartNextProgressPhase();
  }

  function markProgressDoneAndRemove(phase: AskmoreV2RuntimePhase) {
    progressPhaseDoneRequestedRef.current[phase] = true;
    if (activePhaseRef.current !== phase) return;
    if (progressPhaseCompletingRef.current[phase]) return;
    progressPhaseCompletingRef.current[phase] = true;

    const startedAt = progressPhaseStartedAtRef.current[phase] ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const waitToStartShrink = Math.max(0, PHASE_MIN_RUNNING_MS - elapsed);

    const shrinkTimer = window.setTimeout(() => {
      updateCurrentPhaseStatus("shrinking");

      const checkedTimer = window.setTimeout(() => {
        updateCurrentPhaseStatus("checked");
        const holdMs = phase === "persist_and_finalize" ? PHASE_CHECK_HOLD_DONE_MS : PHASE_CHECK_HOLD_MS;

        const holdTimer = window.setTimeout(() => {
          updateCurrentPhaseStatus("exiting");

          const exitTimer = window.setTimeout(() => {
            setRuntimeProgressItems([]);
            activePhaseRef.current = null;
            delete progressPhaseStartedAtRef.current[phase];
            delete progressPhaseDoneRequestedRef.current[phase];
            delete progressPhaseCompletingRef.current[phase];

            const gapTimer = window.setTimeout(() => {
              maybeStartNextProgressPhase();
            }, PHASE_INTER_GAP_MS);
            progressTimersRef.current.push(gapTimer);
            resolveProgressReadyWaiters();
          }, PHASE_EXIT_MS);
          progressTimersRef.current.push(exitTimer);
        }, PHASE_CHECK_REVEAL_MS + holdMs);
        progressTimersRef.current.push(holdTimer);
      }, PHASE_SHRINK_MS);
      progressTimersRef.current.push(checkedTimer);
    }, waitToStartShrink);
    progressTimersRef.current.push(shrinkTimer);
  }

  function abortActiveTurnIfNeeded() {
    if (!activeTurnAbortRef.current) return;
    activeTurnAbortRef.current.abort();
    activeTurnAbortRef.current = null;
    resetRuntimeProgressState();
  }

  function appendChat(
    role: "assistant" | "user",
    content: string,
    params?: { responseBlocks?: ResponseBlock[]; events?: VisibleEvent[]; debugEvents?: DebugEvent[]; trace?: AgentTraceView },
  ) {
    setChatRows((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        role,
        content,
        responseBlocks: params?.responseBlocks,
        events: params?.events,
        debugEvents: params?.debugEvents,
        trace: params?.trace,
      },
    ]);
  }

  function persistSessionId(nextSessionId: string | null) {
    try {
      if (!nextSessionId) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
    } catch {
      // ignore localStorage errors
    }
  }

  function resetInterviewToIdle() {
    abortActiveTurnIfNeeded();
    setSessionId(null);
    setFlowVersionId(null);
    setSessionState(null);
    setInterviewStatus("idle");
    setTurnCount(0);
    setChatRows([]);
    setInputText("");
    setSummaryDialog(null);
    setSummaryLoading(false);
    setRuntimeFallbackHint(null);
    setActiveQuestions(activeFlow?.flow_jsonb.final_flow_questions ?? []);
    persistSessionId(null);
  }

  async function loadSessionList() {
    setSessionLoading(true);
    try {
      const response = await fetch("/api/askmore_v2/interview/sessions?limit=100");
      const payload = (await response.json()) as { sessions?: SessionListItem[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load sessions");
      }
      setSessionList(payload.sessions ?? []);
    } catch (err) {
      setSessionList([]);
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setSessionLoading(false);
    }
  }

  function mapSessionMessagesToChatRows(messages: SessionMessage[]): ChatRow[] {
    const mapped: ChatRow[] = messages
      .filter((item) => item.role === "user" || item.role === "assistant" || item.role === "system")
      .map((item) => ({
        id: item.id,
        role: item.role === "user" ? "user" : "assistant",
        content: item.message_text,
      }));
    return mapped;
  }

  async function loadSessionById(targetSessionId: string) {
    const response = await fetch(`/api/askmore_v2/interview/sessions/${targetSessionId}`);
    const payload = (await response.json()) as SessionDetailResponse;
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load session");
    }
    if (!payload.session) {
      throw new Error("Session not found");
    }

    setSessionId(payload.session.id);
    setFlowVersionId(payload.session.flow_version_id);
    setSessionState(payload.session.state_jsonb);
    setInterviewStatus(payload.session.status);
    setTurnCount(payload.session.turn_count);
    setChatRows(mapSessionMessagesToChatRows(payload.messages ?? []));
    if (payload.flow_questions?.length) {
      setActiveQuestions(payload.flow_questions);
    } else {
      setActiveQuestions(activeFlow?.flow_jsonb.final_flow_questions ?? []);
    }
    persistSessionId(payload.session.id);
  }

  useEffect(() => {
    void (async () => {
      await loadActiveFlow();
      const savedSessionId = (() => {
        try {
          return window.localStorage.getItem(SESSION_STORAGE_KEY);
        } catch {
          return null;
        }
      })();
      if (!savedSessionId) return;
      try {
        await loadSessionById(savedSessionId);
      } catch {
        persistSessionId(null);
        resetInterviewToIdle();
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      abortActiveTurnIfNeeded();
      clearProgressTimers();
      if (progressReadyResolversRef.current.length > 0) {
        for (const resolve of progressReadyResolversRef.current) resolve();
        progressReadyResolversRef.current = [];
      }
    },
    [],
  );

  async function startInterview() {
    if (isSessionTransitioning) return;
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/askmore_v2/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      const payload = (await response.json()) as StartResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to start interview");
      }

      setSessionId(payload.session_id);
      setFlowVersionId(payload.flow_version_id);
      setSessionState(payload.state);
      setInterviewStatus("in_progress");
      setTurnCount(0);
      setActiveQuestions(activeFlow?.flow_jsonb.final_flow_questions ?? []);
      setChatRows([{ id: `assistant-opening-${payload.session_id}`, role: "assistant", content: payload.opening_turn }]);
      setInputText("");
      persistSessionId(payload.session_id);
      if (showSessionPanel) {
        await loadSessionList();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start interview");
    } finally {
      setStarting(false);
    }
  }

  async function postTurn(payload: {
    session_id: string;
    client_turn_id: string;
    user_message: string;
    language: AskmoreV2Language;
    choice?: {
      dimension_id: string;
      option_id: string;
      option_label: string;
      choice_kind?: "micro_confirm" | "follow_up_select";
      source_event_id?: string;
    };
  }, signal?: AbortSignal) {
    const response = await fetch("/api/askmore_v2/interview/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const data = (await response.json()) as TurnResponse;
    if (!response.ok) {
      throw new Error(data.error ?? "Turn request failed");
    }
    return data;
  }

  async function streamTurn(payload: {
    session_id: string;
    client_turn_id: string;
    user_message: string;
    language: AskmoreV2Language;
    choice?: {
      dimension_id: string;
      option_id: string;
      option_label: string;
      choice_kind?: "micro_confirm" | "follow_up_select";
      source_event_id?: string;
    };
  }, signal?: AbortSignal): Promise<TurnResponse> {
    const response = await fetch("/api/askmore_v2/interview/turn?stream=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error ?? "Turn stream request failed");
    }
    if (!response.body) {
      throw new Error("Streaming is not available");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload: TurnResponse | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: TurnStreamEvent;
        try {
          event = JSON.parse(trimmed) as TurnStreamEvent;
        } catch {
          continue;
        }
        if (event.type === "phase") {
          const label = resolvePhaseLabel(event.phase, event.label, language);
          if (debugEnabled) {
            console.log("[askmore_v2_stream] phase", {
              phase: event.phase,
              status: event.status,
              label,
            });
          }
          if (event.status === "start") {
            enqueueProgressPhase(event.phase, label);
          } else {
            markProgressDoneAndRemove(event.phase);
          }
          continue;
        }
        if (event.type === "final") {
          finalPayload = event.payload;
          if (debugEnabled) {
            console.log("[askmore_v2_stream] final_payload_received", {
              turn_id: finalPayload.turn_id,
              session_id: finalPayload.session_id,
            });
          }
          continue;
        }
        if (event.type === "error") {
          throw new Error(event.error || "Runtime stream failed");
        }
      }
    }

    const tail = buffer.trim();
    if (tail) {
      const event = JSON.parse(tail) as TurnStreamEvent;
      if (event.type === "phase") {
        const label = resolvePhaseLabel(event.phase, event.label, language);
        if (event.status === "start") {
          enqueueProgressPhase(event.phase, label);
        } else {
          markProgressDoneAndRemove(event.phase);
        }
      } else if (event.type === "final") {
        finalPayload = event.payload;
      } else if (event.type === "error") {
        throw new Error(event.error || "Runtime stream failed");
      }
    }

    await waitForProgressReadyWithTimeout();
    if (!finalPayload) {
      throw new Error("Turn stream ended before final payload");
    }
    return finalPayload;
  }

  async function sendTurn(message: string, choice?: {
    dimension_id: string;
    option_id: string;
    option_label: string;
    choice_kind?: "micro_confirm" | "follow_up_select";
    source_event_id?: string;
  }) {
    if (isSessionTransitioning) return;
    if (!sessionId) {
      setError(language === "zh" ? "请先开始访谈。" : "Please start interview first.");
      return;
    }

    setSending(true);
    setError(null);
    setRuntimeFallbackHint(null);
    resetRuntimeProgressState();
    appendChat("user", message);
    const clientTurnId = crypto.randomUUID();
    const requestPayload = {
      session_id: sessionId,
      client_turn_id: clientTurnId,
      user_message: message,
      language,
      choice,
    };
    const controller = new AbortController();
    activeTurnAbortRef.current = controller;

    try {
      if (debugEnabled) {
        console.log("[askmore_v2_debug] turn_request", {
          sessionId,
          message,
          client_turn_id: clientTurnId,
          choice: choice ?? null,
        });
      }
      let payload: TurnResponse;
      try {
        payload = await streamTurn(requestPayload, controller.signal);
      } catch (streamError) {
        if (isAbortError(streamError)) throw streamError;
        const fallbackMessage = language === "zh"
          ? "流式连接波动，已切换稳定模式继续处理…"
          : "Streaming was interrupted, switching to stable mode…";
        setRuntimeFallbackHint(fallbackMessage);
        resetRuntimeProgressState();
        if (debugEnabled) {
          console.warn("[askmore_v2_stream] fallback_to_blocking", {
            reason: streamError instanceof Error ? streamError.message : String(streamError),
          });
        }
        payload = await postTurn(requestPayload, controller.signal);
      }

      setSessionState(payload.state);
      setTurnCount((prev) => payload.state.session.active_turn_index ?? prev + 1);
      setInterviewStatus(payload.state.session.finalized ? "completed" : "in_progress");
      if (debugEnabled) {
        console.log("[askmore_v2_debug] turn_response", payload);
      }
      const renderedBlocks = eventsToRenderBlocks(payload.events ?? []);
      const displayBlocks = renderedBlocks.length > 0 ? renderedBlocks : payload.response_blocks ?? [];
      appendChat("assistant", composeAssistantTextFromBlocks(displayBlocks), {
        responseBlocks: displayBlocks,
        events: payload.events ?? [],
        debugEvents: payload.debug_events ?? [],
        trace: compactTraceFromTurn(payload),
      });
      setInputText("");
    } catch (err) {
      if (isAbortError(err)) {
        if (debugEnabled) {
          console.log("[askmore_v2_stream] turn_aborted");
        }
        return;
      }
      setError(err instanceof Error ? err.message : "Turn request failed");
    } finally {
      if (activeTurnAbortRef.current === controller) {
        activeTurnAbortRef.current = null;
      }
      resetRuntimeProgressState();
      setRuntimeFallbackHint(null);
      setSending(false);
    }
  }

  async function requestSummary(mode: "progressive" | "final") {
    if (isSessionTransitioning) return;
    if (!sessionId) {
      setError(language === "zh" ? "请先开始访谈。" : "Please start interview first.");
      return;
    }

    setSummaryLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/askmore_v2/interview/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          mode,
          language,
        }),
      });
      const payload = (await response.json()) as SummaryResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Summary request failed");
      }

      setSummaryDialog({
        mode,
        summaryText: payload.summary_text,
        report: payload.structured_report_json,
      });
      setSessionState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          session: {
            ...prev.session,
            summary_generated: true,
            finalized: mode === "final" ? true : prev.session.finalized,
          },
          latest_summary_text: payload.summary_text,
          latest_structured_report: payload.structured_report_json,
        };
      });
      if (mode === "final") {
        setInterviewStatus("completed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Summary request failed");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function onOptionSelect(params: {
    dimensionId: string;
    option: MicroConfirmOption;
    choiceKind: "micro_confirm" | "follow_up_select";
    sourceEventId?: string;
  }) {
    if (sending || interviewStatus === "completed" || isSessionTransitioning) return;
    if (!params.dimensionId) return;
    const display = `已选择：${params.option.label}`;
    if (debugEnabled) {
      console.log("[askmore_v2_debug] option_click", params);
    }
    await sendTurn(display, {
      dimension_id: params.dimensionId,
      option_id: params.option.option_id,
      option_label: params.option.label,
      choice_kind: params.choiceKind,
      source_event_id: params.sourceEventId,
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = inputText.trim();
    if (!text || sending || isSessionTransitioning) return;
    if (isSummaryShortcutInput(text)) {
      setInputText("");
      await requestSummary("progressive");
      return;
    }
    await sendTurn(text);
  }

  async function handleNewSession() {
    if (starting || sending || isSessionTransitioning || !activeFlow) return;
    resetInterviewToIdle();
    await startInterview();
  }

  async function handleSwitchSession(targetSessionId: string) {
    if (!targetSessionId || targetSessionId === sessionId || isSessionTransitioning) return;
    if (sending) {
      abortActiveTurnIfNeeded();
    }
    setSwitchingSessionId(targetSessionId);
    setError(null);
    try {
      await loadSessionById(targetSessionId);
      setShowSessionPanel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch session");
    } finally {
      setSwitchingSessionId(null);
    }
  }

  async function handleDeleteSession(targetSessionId: string) {
    if (!targetSessionId || isSessionTransitioning) return;
    if (!confirm(`确定删除会话 ${targetSessionId.slice(0, 8)}... 吗？`)) return;
    if (sending) {
      abortActiveTurnIfNeeded();
    }

    setDeletingSessionId(targetSessionId);
    setError(null);
    try {
      const response = await fetch("/api/askmore_v2/interview/sessions/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: targetSessionId }),
      });
      const payload = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete session");
      }

      if (targetSessionId === sessionId) {
        resetInterviewToIdle();
      }

      await loadSessionList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete session");
    } finally {
      setDeletingSessionId(null);
    }
  }

  return (
    <main className="v2-page">
      <div className="v2-shell">
        <header className="v2-header">
          <div className="v2-title-wrap">
            <span className="v2-badge">v2</span>
            <div>
              <div className="v2-title">AskMore v0.2 · Interview</div>
              <div className="v2-subtitle">单问题最多追问 4 次，支持随时 summary</div>
            </div>
          </div>
          <div className="v2-header-actions">
            <a className="v2-link" href="/askmore_v2/builder">前往 Builder</a>
            <button className="v2-btn ghost" onClick={() => void loadActiveFlow()} disabled={activeFlowLoading}>
              {activeFlowLoading ? "刷新中..." : "刷新 Flow"}
            </button>
          </div>
        </header>

        <section className="v2-meta-card">
          <div className="v2-meta-row">
            <span>发布版本</span>
            <strong>{activeFlow ? `v${activeFlow.version}` : "未发布"}</strong>
          </div>
          <div className="v2-meta-row">
            <span>会话状态</span>
            <strong>{interviewStatus === "idle" ? "未开始" : interviewStatus === "in_progress" ? "进行中" : "已完成"}</strong>
          </div>
              <div className="v2-meta-row">
                <span>轮数</span>
                <strong>{turnCount}</strong>
              </div>
          <div className="v2-meta-row">
            <span>Flow ID</span>
            <strong>{flowVersionId ? flowVersionId.slice(0, 8) : "-"}</strong>
          </div>
        </section>

        <div className="v2-grid">
          <section className="v2-chat-panel">
            <div className="v2-toolbar">
              <div className="v2-toolbar-left">
                <label>语言</label>
                <select
                  value={language}
                  disabled={isSessionTransitioning}
                  onChange={(e) => setLanguage((e.target.value as AskmoreV2Language) || "zh")}
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="v2-toolbar-right">
                <button
                  className="v2-btn ghost"
                  type="button"
                  onClick={() => {
                    const next = !showSessionPanel;
                    setShowSessionPanel(next);
                    if (next) {
                      void loadSessionList();
                    }
                  }}
                  disabled={isSessionTransitioning}
                >
                  Sessions
                </button>
                <button
                  className="v2-btn ghost"
                  type="button"
                  onClick={() => void handleNewSession()}
                  disabled={starting || !activeFlow || isSessionTransitioning}
                >
                  {starting ? "启动中..." : "New Session"}
                </button>
                <button
                  className="v2-btn"
                  type="button"
                  onClick={() => void startInterview()}
                  disabled={starting || interviewStatus === "in_progress" || !activeFlow || isSessionTransitioning}
                >
                  {starting ? "启动中..." : interviewStatus === "in_progress" ? "进行中" : "Start Interview"}
                </button>
                <button
                  className="v2-btn ghost"
                  type="button"
                  onClick={() => void requestSummary("progressive")}
                  disabled={summaryLoading || !sessionId || isSessionTransitioning}
                >
                  {summaryLoading ? "处理中..." : "查看阶段总结"}
                </button>
                <span className={`v2-session-badge ${sessionId ? "active" : ""}`}>
                  {sessionId ? `Session ${sessionId.slice(0, 8)}` : "Session -"}
                </span>
              </div>
            </div>

            {showSessionPanel && (
              <div className="v2-session-panel">
                <div className="v2-session-panel-head">
                  <strong>All Sessions</strong>
                  <button
                    className="v2-panel-close"
                    type="button"
                    onClick={() => setShowSessionPanel(false)}
                    disabled={isSessionTransitioning}
                  >
                    &times;
                  </button>
                </div>
                {sessionLoading ? (
                  <div className="v2-session-empty">会话加载中...</div>
                ) : sessionList.length === 0 ? (
                  <div className="v2-session-empty">还没有会话记录。</div>
                ) : (
                  <div className="v2-session-list">
                    {sessionList.map((item) => {
                      const isCurrent = item.id === sessionId;
                      const dateStr = new Date(item.updated_at || item.created_at).toLocaleString();
                      return (
                        <div key={item.id} className={`v2-session-item ${isCurrent ? "active" : ""}`}>
                          <div className="v2-session-main">
                            <div className="v2-session-idline">
                              <span className="v2-session-id">{item.id.slice(0, 8)}...</span>
                              {isCurrent && <span className="v2-active-tag">Active</span>}
                            </div>
                            <div className="v2-session-meta-line">
                              {dateStr} · {item.status === "in_progress" ? "进行中" : "已完成"} · T{item.turn_count} · {item.current_question_id ?? "-"}
                            </div>
                          </div>
                          {!isCurrent && (
                            <button
                              className="v2-session-switch"
                              type="button"
                              onClick={() => void handleSwitchSession(item.id)}
                              disabled={isSessionTransitioning}
                            >
                              {switchingSessionId === item.id ? "切换中..." : "Switch"}
                            </button>
                          )}
                          <button
                            className="v2-session-delete"
                            type="button"
                            onClick={() => void handleDeleteSession(item.id)}
                            disabled={isSessionTransitioning}
                          >
                            {deletingSessionId === item.id ? "删除中..." : "Delete"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="v2-chat-list">
              {chatRows.length === 0 && (
                <div className="v2-empty-tip">
                  {activeFlow
                    ? "点击 Start Interview 开始。"
                    : "还没有发布的 Flow，请先到 Builder 发布。"}
                </div>
              )}

              {chatRows.map((row) => {
                const renderedBlocks = row.role === "assistant" && Array.isArray(row.events) && row.events.length > 0
                  ? eventsToRenderBlocks(row.events)
                  : row.responseBlocks ?? [];
                return (
                  <article key={row.id} className={`v2-msg ${row.role === "assistant" ? "assistant" : "user"}`}>
                    <div className="v2-msg-role">{row.role === "assistant" ? "AI" : "你"}</div>
                    <div className="v2-msg-content">
                      {row.role === "assistant" && renderedBlocks.length > 0 ? (
                        <div className="v2-block-list">
                          {renderedBlocks.map((block, idx) => (
                            <div key={`${row.id}-${block.type}-${idx}`} className={`v2-block v2-block-${block.type}`}>
                              {block.type === "example_answers" && Array.isArray(block.items) ? (
                                <>
                                  <div className="v2-block-title">你可以这样回答：</div>
                                  <ul className="v2-inline-list">
                                    {block.items.map((item, itemIdx) => (
                                      <li key={`${row.id}-ex-${itemIdx}`}>{item}</li>
                                    ))}
                                  </ul>
                                </>
                              ) : block.type === "micro_confirm_options" && Array.isArray(block.options) ? (
                                <div className={`v2-micro-card ${block.mode === "follow_up_select" ? "followup" : "confirm"}`}>
                                  <div className="v2-micro-head">
                                    <div className="v2-micro-title">
                                      {block.mode === "follow_up_select" ? "普通追问，先选一个最接近的" : "快速确认一下，更接近哪一个？"}
                                    </div>
                                    <span className={`v2-micro-badge ${block.mode === "follow_up_select" ? "followup" : "confirm"}`}>
                                      {block.badge_label ?? (block.mode === "follow_up_select" ? "普通追问" : "快速确认")}
                                    </span>
                                  </div>
                                  {block.content && <div className="v2-micro-context">{block.content}</div>}
                                  <div className="v2-micro-options">
                                    {block.options.map((option) => (
                                      <button
                                        key={`${row.id}-opt-${option.option_id}`}
                                        className={`v2-micro-option ${block.mode === "follow_up_select" ? "followup" : "confirm"}`}
                                        type="button"
                                        disabled={sending || interviewStatus === "completed" || isSessionTransitioning}
                                        onClick={() => void onOptionSelect({
                                          dimensionId: block.dimension_id || "",
                                          option,
                                          choiceKind: block.mode === "follow_up_select" ? "follow_up_select" : "micro_confirm",
                                          sourceEventId: block.source_event_id,
                                        })}
                                      >
                                        <span className={`v2-micro-option-id ${block.mode === "follow_up_select" ? "followup" : "confirm"}`}>
                                          {option.option_id}
                                        </span>
                                        <span>{option.label}</span>
                                      </button>
                                    ))}
                                  </div>
                                  {block.allow_free_text !== false && (
                                    <div className="v2-micro-tip">以上都不对的话，直接输入你的描述也可以。</div>
                                  )}
                                </div>
                              ) : (
                                <div>{block.content}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        row.content
                      )}
                      {row.role === "assistant" && row.trace && (
                        <div className="v2-agent-trace">
                          <div className="v2-agent-trace-head">Agent 过程</div>
                          <div className="v2-agent-trace-meta">
                            <span className="v2-agent-chip">intent: {row.trace.routed_intent.intent}</span>
                            <span className="v2-agent-chip">conf: {row.trace.routed_intent.confidence.toFixed(2)}</span>
                            <span className="v2-agent-chip">module: {row.trace.task_module ?? "-"}</span>
                            <span className="v2-agent-chip">turn: {row.trace.active_turn_index ?? "-"}</span>
                            <span className="v2-agent-chip">q: {row.trace.current_question_id ?? "-"}</span>
                            {row.trace.help_obstacle_layer && (
                              <span className="v2-agent-chip">help_obstacle: {row.trace.help_obstacle_layer}</span>
                            )}
                            {row.trace.help_resolution_goal && (
                              <span className="v2-agent-chip">help_goal: {row.trace.help_resolution_goal}</span>
                            )}
                            {row.trace.help_reconnect_target && (
                              <span className="v2-agent-chip">reconnect_gap: {row.trace.help_reconnect_target}</span>
                            )}
                            {row.trace.interaction_mode && (
                              <span className="v2-agent-chip">interaction_mode: {row.trace.interaction_mode}</span>
                            )}
                            {row.trace.interaction_badge && (
                              <span className="v2-agent-chip">interaction_badge: {row.trace.interaction_badge}</span>
                            )}
                          </div>
                          <div className="v2-agent-trace-reason">
                            决策原因：{row.trace.transition_reason ?? row.trace.routed_intent.rationale ?? "-"}
                          </div>
                          {Array.isArray(row.debugEvents) && row.debugEvents.length > 0 && (
                            <div className="v2-agent-trace-steps">
                              {row.debugEvents.map((event, idx) => (
                                <div key={`${row.id}-event-${event.event_id}`} className="v2-agent-step">
                                  <span className="v2-agent-step-index">{idx + 1}</span>
                                  <span className="v2-agent-step-label">{debugEventTypeLabel(event.event_type)}</span>
                                  <span className="v2-agent-step-text">{buildEventActionText(event)}</span>
                                  <span className="v2-agent-step-meta">{buildEventMetaText(event)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="v2-agent-trace-commitments">
                            <strong>Commitments:</strong>{" "}
                            {row.trace.pending_commitments.length === 0
                              ? "none"
                              : row.trace.pending_commitments
                                  .map((item) => `${item.type}:${item.status}${item.dimension_id ? `(${item.dimension_id})` : ""}`)
                                  .join(" | ")}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              {sending && (
                <article className="v2-msg assistant v2-msg-loading">
                  <div className="v2-msg-role">AI</div>
                  <div className="v2-msg-content">
                    {runtimeFallbackHint && <div className="v2-runtime-fallback-hint">{runtimeFallbackHint}</div>}
                    {runtimeProgressItems.length > 0 ? (
                      <div className="v2-runtime-progress-wrap">
                        <AgentRuntimeProgress items={runtimeProgressItems} />
                      </div>
                    ) : (
                      <div className="v2-runtime-loading-inline">
                        {language === "zh" ? "正在处理这一轮…" : "Processing this turn…"}
                      </div>
                    )}
                  </div>
                </article>
              )}
            </div>

            <form className="v2-input-wrap" onSubmit={onSubmit}>
              <textarea
                rows={3}
                value={inputText}
                disabled={sending || !sessionId || interviewStatus === "completed" || isSessionTransitioning}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  interviewStatus === "completed"
                    ? "访谈已结束，可查看总结"
                    : "输入你的回答，也可以直接输入：先看总结"
                }
              />
              <div className="v2-input-actions">
                <button
                  className="v2-btn ghost"
                  type="button"
                  onClick={() => void requestSummary(interviewStatus === "completed" ? "final" : "progressive")}
                  disabled={summaryLoading || !sessionId || isSessionTransitioning}
                >
                  {summaryLoading ? "处理中..." : "Summary"}
                </button>
                <button
                  className="v2-btn"
                  type="submit"
                  disabled={sending || !inputText.trim() || !sessionId || interviewStatus === "completed" || isSessionTransitioning}
                >
                  {sending ? "发送中..." : "发送"}
                </button>
              </div>
            </form>
          </section>

          <aside className="v2-side-panel">
            <section className="v2-side-block">
              <div className="v2-side-title-row">
                <h3>问题进度</h3>
                <div className="v2-size-switch" role="group" aria-label="问题进度显示大小">
                  <button
                    type="button"
                    className={`v2-size-btn ${progressPanelSize === "compact" ? "active" : ""}`}
                    onClick={() => setProgressPanelSize("compact")}
                  >
                    紧凑
                  </button>
                  <button
                    type="button"
                    className={`v2-size-btn ${progressPanelSize === "standard" ? "active" : ""}`}
                    onClick={() => setProgressPanelSize("standard")}
                  >
                    标准
                  </button>
                  <button
                    type="button"
                    className={`v2-size-btn ${progressPanelSize === "expanded" ? "active" : ""}`}
                    onClick={() => setProgressPanelSize("expanded")}
                  >
                    展开
                  </button>
                </div>
              </div>
              <div className="v2-progress-header">
                <span>{progressStats.completedCount}/{progressStats.totalCount} 已完成</span>
                <span>{Math.round(progressStats.progressRatio * 100)}%</span>
              </div>
              <div className="v2-progress-bar">
                <div style={{ width: `${Math.round(progressStats.progressRatio * 100)}%` }} />
              </div>
              <div className={`v2-question-list ${progressPanelSize}`}>
                {orderedQuestions.length === 0 && <div className="v2-empty-inline">暂无问题流</div>}
                {orderedQuestions.map((item, idx) => {
                  const progress = sessionState?.question_progress[item.question_id];
                  const isActive = sessionState?.session.current_question_id === item.question_id;
                  const node = sessionState?.nodes?.[item.question_id];
                  const nodeRuntime = sessionState?.node_runtime?.[item.question_id];
                  const dimensions = node?.target_dimensions ?? [];
                  const completionCriteria = node?.completion_criteria ?? [];
                  const subQuestionRows = item.sub_questions.map((subQuestion, subIdx) => {
                    const normalizedSubQuestion = normalizeDimensionText(subQuestion);
                    const exact = dimensions.find(
                      (dimension) => normalizeDimensionText(dimension.label) === normalizedSubQuestion,
                    );
                    const fallback = dimensions[subIdx];
                    const dimensionId = exact?.id ?? fallback?.id ?? null;
                    const status = subQuestionStatusInfo({
                      dimensionId,
                      nodeRuntime,
                    });
                    const priority = subQuestionPriorityInfo({
                      dimensionId,
                      nodeRuntime,
                      completionCriteria,
                    });
                    const isMustUnanswered = priority.tone === "must" && status.tone === "todo";
                    return {
                      key: `${item.question_id}-sq-${subIdx}`,
                      text: subQuestion,
                      status,
                      priority,
                      isMustUnanswered,
                    };
                  });
                  return (
                    <div key={item.question_id} className={`v2-question-item ${isActive ? "active" : ""}`}>
                      <div className="v2-question-top">
                        <strong>Q{idx + 1}</strong>
                        <span>{questionStatusLabel(progress?.status ?? "empty")}</span>
                      </div>
                      <div className="v2-question-text">{item.entry_question}</div>
                      <div className="v2-question-meta">
                        追问 {progress?.follow_up_count ?? 0}/4 · 覆盖 {Math.round((progress?.coverage_score ?? 0) * 100)}%
                      </div>
                      {subQuestionRows.length > 0 && (
                        <div className="v2-subquestion-list">
                          {subQuestionRows.map((subRow, subIdx) => (
                            <div key={subRow.key} className={`v2-subquestion-item ${subRow.isMustUnanswered ? "must-unanswered" : ""}`}>
                              <span className="v2-subquestion-text">S{subIdx + 1}. {subRow.text}</span>
                              <div className="v2-subquestion-tags">
                                <span className={`v2-subquestion-priority ${subRow.priority.tone}`}>
                                  {subRow.priority.label}
                                </span>
                                {subRow.priority.downgradedByLimit && (
                                  <span className="v2-subquestion-downgraded">已降级可选</span>
                                )}
                                {subRow.isMustUnanswered && (
                                  <span className="v2-subquestion-alert">必问未答</span>
                                )}
                                <span className={`v2-subquestion-status ${subRow.status.tone}`}>{subRow.status.label}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="v2-side-block">
              <h3>当前理解</h3>
              {structuredKnowledgeRows.length === 0 && (
                <div className="v2-empty-inline">尚无结构化信息</div>
              )}
              <div className="v2-knowledge-list">
                {structuredKnowledgeRows.map(([key, field]) => (
                  <div key={key} className="v2-knowledge-item">
                    <div className="v2-knowledge-key">{key}</div>
                    <div className="v2-knowledge-val">{String(field.value)}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="v2-side-block">
              <h3>还缺的关键点</h3>
              {sessionState?.session.last_missing_points?.length ? (
                <ul className="v2-missing-list">
                  {sessionState.session.last_missing_points.map((point, idx) => (
                    <li key={`${point}-${idx}`}>{point}</li>
                  ))}
                </ul>
              ) : (
                <div className="v2-empty-inline">当前没有明显缺口</div>
              )}
            </section>
          </aside>
        </div>

        {error && <div className="v2-error">{error}</div>}
      </div>

      {summaryDialog && (
        <div className="v2-summary-overlay" role="dialog" aria-modal="true">
          <div className="v2-summary-dialog">
            <div className="v2-summary-head">
              <div className="v2-summary-title">
                {summaryDialog.mode === "final" ? "最终总结" : "阶段总结"}
              </div>
              <button className="v2-btn ghost" onClick={() => setSummaryDialog(null)}>
                关闭
              </button>
            </div>
            <div className="v2-summary-body">
              <div className="v2-summary-text">{summaryDialog.summaryText}</div>
              {summaryDialog.report && (
                <pre className="v2-summary-json">{JSON.stringify(summaryDialog.report, null, 2)}</pre>
              )}
            </div>
            <div className="v2-summary-foot">总结是独立视图，不占用对话轮次。</div>
          </div>
        </div>
      )}

      {(deletingSessionId || switchingSessionId) && (
        <div className="v2-session-busy-overlay" role="status" aria-live="polite">
          <div className="v2-session-busy-card">
            <span className="v2-session-busy-spinner" />
            <div className="v2-session-busy-title">{deletingSessionId ? "正在删除会话..." : "正在切换会话..."}</div>
            <div className="v2-session-busy-hint">
              {deletingSessionId ? "请稍候，删除完成后会自动刷新会话列表。" : "请稍候，正在恢复该会话的对话与状态。"}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .v2-page {
          min-height: 100vh;
          background: var(--color-bg);
          padding: 20px;
        }
        .v2-shell {
          max-width: 1460px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .v2-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .v2-title-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .v2-badge {
          width: 30px;
          height: 30px;
          border-radius: 999px;
          background: var(--color-accent);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 12px;
          flex-shrink: 0;
        }
        .v2-title {
          font-size: 16px;
          font-weight: 700;
        }
        .v2-subtitle {
          font-size: 12px;
          color: var(--color-muted);
        }
        .v2-header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .v2-link {
          text-decoration: none;
          border-radius: 999px;
          padding: 6px 12px;
          background: var(--color-chip);
          color: var(--color-text);
          font-size: 12px;
          font-weight: 600;
        }
        .v2-meta-card {
          background: var(--color-elev);
          border: 1px solid var(--color-line);
          border-radius: var(--radius-m);
          box-shadow: var(--shadow-2);
          padding: 10px 12px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .v2-meta-row {
          display: flex;
          flex-direction: column;
          gap: 3px;
          font-size: 12px;
          color: var(--color-muted);
        }
        .v2-meta-row strong {
          color: var(--color-text);
          font-size: 13px;
          font-weight: 700;
        }
        .v2-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.7fr) minmax(300px, 1fr);
          gap: 12px;
          align-items: start;
        }
        .v2-chat-panel,
        .v2-side-panel {
          background: var(--color-elev);
          border: 1px solid var(--color-line);
          border-radius: var(--radius-l);
          box-shadow: var(--shadow-1);
        }
        .v2-chat-panel {
          display: flex;
          flex-direction: column;
          min-height: 720px;
          overflow: hidden;
        }
        .v2-toolbar {
          border-bottom: 1px solid var(--color-line);
          padding: 12px;
          display: flex;
          justify-content: space-between;
          gap: 8px;
          align-items: center;
        }
        .v2-toolbar-left {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--color-muted);
        }
        .v2-toolbar-left select {
          border: 1px solid var(--color-line);
          border-radius: 10px;
          padding: 6px 8px;
          background: #fff;
          color: var(--color-text);
          font-size: 12px;
        }
        .v2-toolbar-right {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .v2-btn {
          border-radius: 999px;
          padding: 7px 12px;
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          background: var(--color-accent);
        }
        .v2-btn.ghost {
          background: var(--color-chip);
          color: var(--color-text);
          font-weight: 600;
        }
        .v2-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }
        .v2-session-badge {
          border-radius: 999px;
          padding: 5px 11px;
          border: 1px solid var(--color-line);
          background: #fff;
          font-size: 11px;
          font-weight: 600;
          color: var(--color-muted);
        }
        .v2-session-badge.active {
          color: var(--color-accent);
          border-color: rgba(13, 123, 100, 0.34);
          background: rgba(13, 123, 100, 0.08);
        }
        .v2-session-panel {
          border-bottom: 1px solid var(--color-line);
          padding: 10px 12px;
          background: #fffdf8;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .v2-session-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          font-size: 13px;
        }
        .v2-panel-close {
          background: transparent;
          color: var(--color-muted);
          font-size: 20px;
          line-height: 1;
          padding: 0 4px;
        }
        .v2-session-empty {
          font-size: 12px;
          color: var(--color-muted);
          padding: 4px 0 6px;
        }
        .v2-session-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 260px;
          overflow-y: auto;
        }
        .v2-session-item {
          display: flex;
          align-items: center;
          gap: 8px;
          border-radius: 10px;
          border: 1px solid transparent;
          background: var(--color-chip);
          padding: 8px 10px;
        }
        .v2-session-item.active {
          border-color: rgba(13, 123, 100, 0.46);
          background: var(--color-accent-soft);
        }
        .v2-session-main {
          flex: 1;
          min-width: 0;
        }
        .v2-session-idline {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .v2-session-id {
          font-size: 12px;
          font-weight: 700;
          color: var(--color-text);
        }
        .v2-active-tag {
          border-radius: 999px;
          padding: 1px 7px;
          font-size: 10px;
          font-weight: 700;
          color: #fff;
          background: var(--color-accent);
        }
        .v2-session-meta-line {
          margin-top: 2px;
          font-size: 11px;
          color: var(--color-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .v2-session-switch,
        .v2-session-delete {
          border-radius: 999px;
          font-size: 11px;
          padding: 4px 10px;
          font-weight: 600;
          white-space: nowrap;
        }
        .v2-session-switch {
          background: #fff;
          color: var(--color-text);
          border: 1px solid var(--color-line);
        }
        .v2-session-delete {
          background: transparent;
          color: #b91c1c;
          border: 1px solid #fecaca;
        }
        .v2-session-switch:disabled,
        .v2-session-delete:disabled,
        .v2-panel-close:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .v2-chat-list {
          flex: 1;
          overflow-y: auto;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: linear-gradient(180deg, rgba(245, 242, 234, 0.38) 0%, rgba(255, 255, 255, 0.92) 100%);
        }
        .v2-empty-tip {
          border: 1px dashed var(--color-line);
          color: var(--color-muted);
          border-radius: 12px;
          padding: 14px;
          font-size: 12px;
          background: #fff;
        }
        .v2-msg {
          max-width: 92%;
          border-radius: 12px;
          padding: 10px 12px;
          border: 1px solid var(--color-line);
          white-space: pre-wrap;
          line-height: 1.5;
          font-size: 13px;
        }
        .v2-msg.assistant {
          background: #fff;
          align-self: flex-start;
        }
        .v2-msg.user {
          background: var(--color-accent-soft);
          align-self: flex-end;
          border-color: rgba(13, 123, 100, 0.3);
        }
        .v2-msg-role {
          font-size: 10px;
          font-weight: 700;
          color: var(--color-muted);
          margin-bottom: 4px;
          letter-spacing: 0.02em;
        }
        .v2-msg-content {
          color: var(--color-text);
        }
        .v2-msg-loading {
          background: #fff;
          border-style: dashed;
        }
        .v2-runtime-progress-wrap {
          padding-top: 2px;
        }
        .v2-runtime-loading-inline {
          font-size: 12px;
          color: var(--color-muted);
        }
        .v2-runtime-fallback-hint {
          font-size: 11px;
          color: #92400e;
          border-radius: 8px;
          border: 1px solid #fcd34d;
          background: #fffbeb;
          padding: 6px 8px;
          margin-bottom: 8px;
        }
        .v2-block-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .v2-block-title {
          font-weight: 600;
          font-size: 12px;
          color: var(--color-muted);
          margin-bottom: 4px;
        }
        .v2-inline-list {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .v2-micro-card {
          border: 1px solid rgba(13, 123, 100, 0.32);
          background: rgba(13, 123, 100, 0.06);
          border-radius: 10px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .v2-micro-card.followup {
          border: 1px solid rgba(180, 108, 2, 0.34);
          background: rgba(245, 158, 11, 0.08);
        }
        .v2-micro-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .v2-micro-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--color-text);
        }
        .v2-micro-badge {
          font-size: 11px;
          font-weight: 700;
          border-radius: 999px;
          padding: 2px 8px;
          white-space: nowrap;
        }
        .v2-micro-badge.confirm {
          border: 1px solid rgba(13, 123, 100, 0.36);
          color: #065f46;
          background: rgba(13, 123, 100, 0.12);
        }
        .v2-micro-badge.followup {
          border: 1px solid rgba(180, 108, 2, 0.42);
          color: #92400e;
          background: rgba(245, 158, 11, 0.18);
        }
        .v2-micro-options {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .v2-micro-context {
          border-radius: 8px;
          border: 1px solid rgba(13, 123, 100, 0.22);
          background: rgba(255, 255, 255, 0.72);
          padding: 8px 10px;
          font-size: 12px;
          line-height: 1.45;
          color: #1f2937;
        }
        .v2-micro-card.followup .v2-micro-context {
          border: 1px solid rgba(180, 108, 2, 0.28);
        }
        .v2-micro-option {
          border: 1px solid rgba(13, 123, 100, 0.26);
          background: #fff;
          border-radius: 8px;
          padding: 8px 10px;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--color-text);
          font-size: 12px;
        }
        .v2-micro-option.followup {
          border: 1px solid rgba(180, 108, 2, 0.3);
        }
        .v2-micro-option:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .v2-micro-option-id {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: rgba(13, 123, 100, 0.16);
          color: var(--color-accent);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .v2-micro-option-id.followup {
          background: rgba(245, 158, 11, 0.2);
          color: #92400e;
        }
        .v2-micro-tip {
          font-size: 11px;
          color: var(--color-muted);
        }
        .v2-agent-trace {
          margin-top: 10px;
          border: 1px solid rgba(15, 23, 42, 0.12);
          border-radius: 10px;
          padding: 8px;
          background: rgba(248, 250, 252, 0.78);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .v2-agent-trace-head {
          font-size: 11px;
          font-weight: 700;
          color: #334155;
        }
        .v2-agent-trace-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .v2-agent-chip {
          font-size: 11px;
          color: #0f172a;
          border: 1px solid rgba(148, 163, 184, 0.5);
          background: #fff;
          border-radius: 999px;
          padding: 2px 8px;
        }
        .v2-agent-trace-reason {
          font-size: 11px;
          color: #475569;
          line-height: 1.4;
        }
        .v2-agent-trace-steps {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .v2-agent-step {
          display: grid;
          grid-template-columns: 18px 64px 1fr;
          gap: 6px;
          align-items: start;
          font-size: 11px;
          color: #1f2937;
        }
        .v2-agent-step-index {
          color: #64748b;
          font-weight: 700;
        }
        .v2-agent-step-label {
          color: #0f766e;
          font-weight: 600;
        }
        .v2-agent-step-text {
          color: #1e293b;
          word-break: break-word;
        }
        .v2-agent-step-meta {
          grid-column: 3;
          color: #64748b;
          font-size: 10px;
          line-height: 1.35;
        }
        .v2-agent-trace-commitments {
          font-size: 11px;
          color: #475569;
          line-height: 1.4;
        }
        .v2-input-wrap {
          border-top: 1px solid var(--color-line);
          padding: 12px;
          background: #fff;
        }
        .v2-input-actions {
          margin-top: 8px;
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .v2-side-panel {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 720px;
        }
        .v2-side-block {
          border: 1px solid var(--color-line);
          border-radius: 12px;
          padding: 10px;
          background: #fff;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .v2-side-block h3 {
          margin: 0;
          font-size: 13px;
        }
        .v2-side-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .v2-size-switch {
          display: inline-flex;
          border: 1px solid var(--color-line);
          border-radius: 999px;
          padding: 2px;
          background: #fff;
        }
        .v2-size-btn {
          border: 0;
          background: transparent;
          color: var(--color-muted);
          font-size: 10px;
          font-weight: 700;
          border-radius: 999px;
          padding: 3px 8px;
          cursor: pointer;
        }
        .v2-size-btn.active {
          background: rgba(13, 123, 100, 0.14);
          color: #0d7b64;
        }
        .v2-progress-header {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: var(--color-muted);
        }
        .v2-progress-bar {
          width: 100%;
          height: 8px;
          border-radius: 999px;
          background: #f2efe7;
          overflow: hidden;
        }
        .v2-progress-bar > div {
          height: 100%;
          background: linear-gradient(90deg, #0d7b64 0%, #16a085 100%);
        }
        .v2-question-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 360px;
          overflow-y: auto;
        }
        .v2-question-list.compact {
          max-height: 220px;
        }
        .v2-question-list.standard {
          max-height: 360px;
        }
        .v2-question-list.expanded {
          max-height: none;
          overflow-y: visible;
        }
        .v2-question-item {
          border: 1px solid var(--color-line);
          border-radius: 10px;
          padding: 8px;
          background: #fff;
        }
        .v2-question-item.active {
          border-color: rgba(13, 123, 100, 0.5);
          background: var(--color-accent-soft);
        }
        .v2-question-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          color: var(--color-muted);
          margin-bottom: 4px;
        }
        .v2-question-top strong {
          color: var(--color-text);
          font-size: 12px;
        }
        .v2-question-text {
          font-size: 12px;
          color: var(--color-text);
          line-height: 1.4;
        }
        .v2-question-meta {
          margin-top: 4px;
          font-size: 11px;
          color: var(--color-muted);
        }
        .v2-subquestion-list {
          margin-top: 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .v2-subquestion-item {
          border: 1px solid var(--color-line);
          border-radius: 8px;
          background: #fcfcfa;
          padding: 6px 8px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
        }
        .v2-subquestion-item.must-unanswered {
          border-color: #fdba74;
          background: #fff7ed;
        }
        .v2-subquestion-text {
          font-size: 11px;
          color: var(--color-text);
          line-height: 1.35;
          flex: 1;
        }
        .v2-subquestion-tags {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          flex-wrap: wrap;
          gap: 4px;
          flex-shrink: 0;
          max-width: 44%;
        }
        .v2-subquestion-priority,
        .v2-subquestion-downgraded,
        .v2-subquestion-alert {
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 700;
          border: 1px solid transparent;
          white-space: nowrap;
        }
        .v2-subquestion-priority.must {
          color: #7c2d12;
          border-color: #fdba74;
          background: #fff7ed;
        }
        .v2-subquestion-priority.optional {
          color: #475569;
          border-color: #cbd5e1;
          background: #f8fafc;
        }
        .v2-subquestion-downgraded {
          color: #92400e;
          border-color: #fcd34d;
          background: #fffbeb;
        }
        .v2-subquestion-alert {
          color: #b91c1c;
          border-color: #fca5a5;
          background: #fef2f2;
        }
        .v2-subquestion-status {
          flex-shrink: 0;
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 700;
          border: 1px solid transparent;
        }
        .v2-subquestion-status.todo {
          color: #6b7280;
          border-color: #d1d5db;
          background: #f9fafb;
        }
        .v2-subquestion-status.answered {
          color: #92400e;
          border-color: #fcd34d;
          background: #fffbeb;
        }
        .v2-subquestion-status.pending {
          color: #1d4ed8;
          border-color: #93c5fd;
          background: #eff6ff;
        }
        .v2-subquestion-status.confirmed {
          color: #065f46;
          border-color: #6ee7b7;
          background: #ecfdf5;
        }
        .v2-empty-inline {
          font-size: 12px;
          color: var(--color-muted);
        }
        .v2-knowledge-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 180px;
          overflow-y: auto;
        }
        .v2-knowledge-item {
          border: 1px solid var(--color-line);
          border-radius: 10px;
          background: var(--color-code-bg);
          padding: 8px;
        }
        .v2-knowledge-key {
          font-size: 11px;
          color: var(--color-muted);
          text-transform: uppercase;
          margin-bottom: 3px;
        }
        .v2-knowledge-val {
          font-size: 12px;
          color: var(--color-text);
          line-height: 1.4;
          word-break: break-word;
        }
        .v2-missing-list {
          margin: 0;
          padding-left: 16px;
          display: flex;
          flex-direction: column;
          gap: 5px;
          font-size: 12px;
          color: var(--color-text);
        }
        .v2-error {
          border: 1px solid #fca5a5;
          background: #fef2f2;
          color: #991b1b;
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 12px;
        }
        .v2-summary-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 70;
          padding: 20px;
        }
        .v2-summary-dialog {
          width: min(920px, 100%);
          max-height: min(86vh, 920px);
          overflow: auto;
          background: #fffdf3;
          border: 1px solid #facc15;
          border-radius: 16px;
          box-shadow: 0 22px 52px rgba(15, 23, 42, 0.25);
          display: flex;
          flex-direction: column;
        }
        .v2-summary-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid #fde68a;
          background: linear-gradient(180deg, rgba(254, 249, 195, 0.85), rgba(255, 255, 255, 0.96));
          position: sticky;
          top: 0;
        }
        .v2-summary-title {
          font-size: 15px;
          font-weight: 700;
          color: #713f12;
        }
        .v2-summary-body {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .v2-summary-text {
          white-space: pre-wrap;
          line-height: 1.75;
          color: #1f2937;
          font-size: 14px;
        }
        .v2-summary-json {
          margin: 0;
          padding: 10px 12px;
          border-radius: 12px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          color: #0f172a;
          font-size: 12px;
          line-height: 1.6;
          overflow: auto;
        }
        .v2-summary-foot {
          padding: 10px 16px 14px;
          font-size: 12px;
          color: #92400e;
          border-top: 1px solid #fde68a;
        }
        .v2-session-busy-overlay {
          position: fixed;
          inset: 0;
          z-index: 80;
          background: rgba(240, 237, 229, 0.72);
          backdrop-filter: blur(2px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .v2-session-busy-card {
          min-width: 280px;
          max-width: 380px;
          border-radius: 16px;
          border: 1px solid var(--color-line);
          background: #fff;
          box-shadow: var(--shadow-1);
          padding: 20px 22px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .v2-session-busy-spinner {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 2px solid rgba(212, 160, 23, 0.22);
          border-top-color: #d4a017;
          animation: v2-spinner-spin 900ms linear infinite;
        }
        .v2-session-busy-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--color-text);
        }
        .v2-session-busy-hint {
          font-size: 12px;
          text-align: center;
          color: var(--color-muted);
        }
        @keyframes v2-spinner-spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        @media (max-width: 1100px) {
          .v2-meta-card {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .v2-grid {
            grid-template-columns: 1fr;
          }
          .v2-chat-panel,
          .v2-side-panel {
            min-height: auto;
          }
          .v2-side-panel {
            order: 2;
          }
        }
      `}</style>
    </main>
  );
}
