import { randomUUID } from "crypto";
import { getAskmoreV2Repository } from "@/server/askmore_v2/repo";
import { toCanonicalFlowDefinition } from "@/server/askmore_v2/flow-definition";
import { buildInsightContext } from "@/server/askmore_v2/insight/context-builder";
import { generateAiThinking } from "@/server/askmore_v2/insight/engine";
import { resolveInsightPacks } from "@/server/askmore_v2/insight/resolver";
import {
  AskmoreV2AiThinkingResult,
  AskmoreV2InsightPackConfig,
  AskmoreV2InsightRunRecord,
  AskmoreV2InsightTrigger,
  AskmoreV2Language,
  AskmoreV2Session,
} from "@/server/askmore_v2/types";

type CreateAiThinkingResult = {
  ai_thinking_result: AskmoreV2AiThinkingResult;
  run_meta: {
    run_id: string;
    trigger: AskmoreV2InsightTrigger;
    pack_trace: AskmoreV2InsightRunRecord["pack_trace_jsonb"];
    created_at: string;
  };
};

type AiThinkingJobStatus = "running" | "succeeded" | "failed";
type AiThinkingJobStage =
  | "queued"
  | "stage_a"
  | "stage_b_draft1"
  | "stage_b_draft2"
  | "stage_b_draft2_retry"
  | "finalizing"
  | "done"
  | "failed";

interface AiThinkingJobProgress {
  stage: AiThinkingJobStage;
  percent: number;
  stages_total: number;
  stages_completed: number;
  updated_at: string;
}

interface AiThinkingJobState {
  job_id: string;
  session_id: string;
  trigger: AskmoreV2InsightTrigger;
  status: AiThinkingJobStatus;
  created_at: string;
  started_at: string;
  finished_at?: string;
  run_meta?: CreateAiThinkingResult["run_meta"];
  error?: string;
  progress: AiThinkingJobProgress;
}
declare global {
  // eslint-disable-next-line no-var
  var __askmoreV2InFlightAiThinkingBySession: Map<string, Promise<CreateAiThinkingResult>> | undefined;
  // eslint-disable-next-line no-var
  var __askmoreV2AiThinkingJobsById: Map<string, AiThinkingJobState> | undefined;
  // eslint-disable-next-line no-var
  var __askmoreV2AiThinkingJobIdBySession: Map<string, string> | undefined;
}
const inFlightAiThinkingBySession =
  globalThis.__askmoreV2InFlightAiThinkingBySession
  ?? (globalThis.__askmoreV2InFlightAiThinkingBySession = new Map<string, Promise<CreateAiThinkingResult>>());
const aiThinkingJobsById =
  globalThis.__askmoreV2AiThinkingJobsById
  ?? (globalThis.__askmoreV2AiThinkingJobsById = new Map<string, AiThinkingJobState>());
const aiThinkingJobIdBySession =
  globalThis.__askmoreV2AiThinkingJobIdBySession
  ?? (globalThis.__askmoreV2AiThinkingJobIdBySession = new Map<string, string>());

class AiThinkingSessionStatusError extends Error {
  code = "ai_thinking_requires_completed_session";
  constructor() {
    super("AI Thinking is only available after session is completed.");
    this.name = "AiThinkingSessionStatusError";
  }
}

function isAiThinkingV2(result: unknown): result is AskmoreV2AiThinkingResult {
  return Boolean(
    result
    && typeof result === "object"
    && (result as { version?: string }).version === "ai_thinking.v2",
  );
}

function isV2Run(record: AskmoreV2InsightRunRecord): boolean {
  if (isAiThinkingV2(record.result_jsonb)) return true;
  const corePack = record.pack_trace_jsonb?.core_pack;
  return corePack === "core.ai_thinking.v2";
}

function hasUsableAiThinking(result: AskmoreV2AiThinkingResult): boolean {
  if (!result.professional_read.trim()) return false;
  if (!result.what_i_would_pay_attention_to.trim()) return false;
  if (!result.practical_guidance.trim()) return false;
  if (result.quality_flags.too_generic) return false;
  return true;
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

const AI_THINKING_STAGE_ORDER: Record<string, number> = {
  stage_a: 1,
  stage_b_draft1: 2,
  stage_b_draft2: 3,
  stage_b_draft2_retry: 4,
};

function updateJobProgress(params: {
  jobId: string;
  stage?: AiThinkingJobStage;
  percent?: number;
  stagesCompleted?: number;
}) {
  const job = aiThinkingJobsById.get(params.jobId);
  if (!job) return;
  job.progress = {
    stage: params.stage ?? job.progress.stage,
    percent: typeof params.percent === "number" ? Math.max(0, Math.min(100, params.percent)) : job.progress.percent,
    stages_total: job.progress.stages_total,
    stages_completed: typeof params.stagesCompleted === "number"
      ? Math.max(job.progress.stages_completed, Math.min(job.progress.stages_total, params.stagesCompleted))
      : job.progress.stages_completed,
    updated_at: new Date().toISOString(),
  };
  aiThinkingJobsById.set(params.jobId, job);
}

async function updateSessionWithRetry(session: AskmoreV2Session): Promise<AskmoreV2Session> {
  const repo = getAskmoreV2Repository();
  try {
    await repo.updateSession(session);
    return session;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ASKMORE_V2_STATE_VERSION_CONFLICT")) {
      throw error;
    }
    const fresh = await repo.getSession(session.id);
    if (!fresh) throw new Error("Session not found during AI Thinking update retry");
    const merged: AskmoreV2Session = {
      ...fresh,
      updated_at: session.updated_at,
      state_jsonb: {
        ...fresh.state_jsonb,
        latest_ai_thinking: session.state_jsonb.latest_ai_thinking ?? null,
        ai_thinking_meta: session.state_jsonb.ai_thinking_meta ?? null,
      },
    };
    await repo.updateSession(merged);
    return merged;
  }
}

export async function createAiThinking(params: {
  sessionId: string;
  language?: AskmoreV2Language;
  trigger: AskmoreV2InsightTrigger;
  forceRegenerate?: boolean;
  packConfig?: AskmoreV2InsightPackConfig;
  onStageEvent?: (event: {
    stage: string;
    attempt: number;
    status: "start" | "success" | "error";
    model_used?: string;
    provider?: string;
    error?: string;
  }) => void;
}): Promise<CreateAiThinkingResult> {
  const existingInFlight = inFlightAiThinkingBySession.get(params.sessionId);
  if (existingInFlight) {
    return existingInFlight;
  }

  const task = createAiThinkingInternal(params);
  inFlightAiThinkingBySession.set(params.sessionId, task);
  try {
    return await task;
  } finally {
    const current = inFlightAiThinkingBySession.get(params.sessionId);
    if (current === task) {
      inFlightAiThinkingBySession.delete(params.sessionId);
    }
  }
}

export async function startAiThinkingJob(params: {
  sessionId: string;
  language?: AskmoreV2Language;
  trigger: AskmoreV2InsightTrigger;
  forceRegenerate?: boolean;
  packConfig?: AskmoreV2InsightPackConfig;
}): Promise<{
  accepted: true;
  job_meta: AiThinkingJobState;
}> {
  const repo = getAskmoreV2Repository();
  const session = await repo.getSession(params.sessionId);
  if (!session) throw new Error("Session not found");
  if (session.status !== "completed") throw new AiThinkingSessionStatusError();

  const currentInFlight = inFlightAiThinkingBySession.get(params.sessionId);
  const currentJobId = aiThinkingJobIdBySession.get(params.sessionId);
  if (currentInFlight && currentJobId) {
    const existingJob = aiThinkingJobsById.get(currentJobId);
    if (existingJob) {
      return {
        accepted: true,
        job_meta: existingJob,
      };
    }
  }

  const now = new Date().toISOString();
  const jobId = randomUUID();
  const job: AiThinkingJobState = {
    job_id: jobId,
    session_id: params.sessionId,
    trigger: params.trigger,
    status: "running",
    created_at: now,
    started_at: now,
    progress: {
      stage: "queued",
      percent: 2,
      stages_total: 4,
      stages_completed: 0,
      updated_at: now,
    },
  };
  aiThinkingJobsById.set(jobId, job);
  aiThinkingJobIdBySession.set(params.sessionId, jobId);

  void createAiThinking({
    ...params,
    onStageEvent: (event) => {
      if (event.stage === "finalizing") {
        updateJobProgress({
          jobId,
          stage: "finalizing",
          percent: 92,
        });
        return;
      }
      if (event.status === "start") {
        const order = AI_THINKING_STAGE_ORDER[event.stage] ?? 1;
        const baseline = Math.round(((order - 1) / 4) * 100);
        updateJobProgress({
          jobId,
          stage: (event.stage as AiThinkingJobStage),
          percent: Math.max(4, baseline + 6),
        });
        return;
      }
      if (event.status === "success") {
        const order = AI_THINKING_STAGE_ORDER[event.stage] ?? 1;
        updateJobProgress({
          jobId,
          stage: (event.stage as AiThinkingJobStage),
          percent: Math.min(95, Math.round((Math.min(order, 4) / 4) * 100)),
          stagesCompleted: order,
        });
        return;
      }
      updateJobProgress({
        jobId,
        stage: (event.stage as AiThinkingJobStage),
      });
    },
  })
    .then((result) => {
      const finishedAt = new Date().toISOString();
      const current = aiThinkingJobsById.get(jobId);
      if (!current) return;
      current.status = "succeeded";
      current.finished_at = finishedAt;
      current.run_meta = result.run_meta;
      current.progress = {
        ...current.progress,
        stage: "done",
        percent: 100,
        stages_completed: current.progress.stages_total,
        updated_at: finishedAt,
      };
      aiThinkingJobsById.set(jobId, current);
    })
    .catch((error) => {
      const finishedAt = new Date().toISOString();
      const current = aiThinkingJobsById.get(jobId);
      if (!current) return;
      current.status = "failed";
      current.finished_at = finishedAt;
      current.error = serializeError(error);
      current.progress = {
        ...current.progress,
        stage: "failed",
        updated_at: finishedAt,
      };
      aiThinkingJobsById.set(jobId, current);
    })
    .finally(() => {
      const currentSessionJobId = aiThinkingJobIdBySession.get(params.sessionId);
      if (currentSessionJobId === jobId) {
        aiThinkingJobIdBySession.delete(params.sessionId);
      }
    });

  return {
    accepted: true,
    job_meta: job,
  };
}

export function getAiThinkingJob(jobId: string): AiThinkingJobState | null {
  return aiThinkingJobsById.get(jobId) ?? null;
}

async function createAiThinkingInternal(params: {
  sessionId: string;
  language?: AskmoreV2Language;
  trigger: AskmoreV2InsightTrigger;
  forceRegenerate?: boolean;
  packConfig?: AskmoreV2InsightPackConfig;
  onStageEvent?: (event: {
    stage: string;
    attempt: number;
    status: "start" | "success" | "error";
    model_used?: string;
    provider?: string;
    error?: string;
  }) => void;
}): Promise<CreateAiThinkingResult> {
  const repo = getAskmoreV2Repository();
  const session = await repo.getSession(params.sessionId);
  if (!session) throw new Error("Session not found");
  if (session.status !== "completed") throw new AiThinkingSessionStatusError();

  if (
    !params.forceRegenerate
    && session.state_jsonb.latest_ai_thinking
    && hasUsableAiThinking(session.state_jsonb.latest_ai_thinking)
  ) {
    const existing = session.state_jsonb.latest_ai_thinking;
    return {
      ai_thinking_result: existing,
      run_meta: {
        run_id: session.state_jsonb.ai_thinking_meta?.latest_run_id ?? "cached",
        trigger: session.state_jsonb.ai_thinking_meta?.latest_trigger ?? params.trigger,
        pack_trace: existing.pack_trace,
        created_at: session.state_jsonb.ai_thinking_meta?.latest_generated_at ?? session.updated_at,
      },
    };
  }

  const flow = await repo.getFlowVersion(session.flow_version_id);
  if (!flow) throw new Error("Flow version not found");
  const canonicalFlow = toCanonicalFlowDefinition(flow.flow_jsonb);
  const selectedLanguage = params.language ?? canonicalFlow.language;
  const messages = await repo.listMessages(params.sessionId, 120);

  const context = buildInsightContext({
    session,
    questions: canonicalFlow.final_flow_questions,
    messages,
    scenario: canonicalFlow.scenario,
    targetOutputType: canonicalFlow.target_output_type,
    language: selectedLanguage,
  });

  const resolved = resolveInsightPacks({
    domain: context.domain,
    subdomain: context.subdomain,
    packConfig: params.packConfig,
  });

  const createdAt = new Date().toISOString();
  const runId = randomUUID();
  try {
    const generated = await generateAiThinking({
      context,
      packTrace: resolved.packTrace,
      onStageEvent: params.onStageEvent,
    });
    params.onStageEvent?.({
      stage: "finalizing",
      attempt: 0,
      status: "start",
    });
    const aiThinkingResult = generated.result;

    const runRecord: AskmoreV2InsightRunRecord = {
      id: runId,
      session_id: params.sessionId,
      trigger_source: params.trigger,
      domain: resolved.domain,
      subdomain: resolved.subdomain,
      language: selectedLanguage,
      pack_trace_jsonb: resolved.packTrace,
      input_snapshot_jsonb: {
        session_id: context.session_id,
        domain: context.domain,
        subdomain: context.subdomain,
        completion_ratio: context.intake_summary.completion_ratio,
        question_count: context.question_sheet.length,
        message_count: context.conversation_history.length,
        ai_thinking_debug: {
          stage_b_draft1: generated.debug.stage_b_draft1,
          stage_b_draft1_skipped: generated.debug.stage_b_draft1_skipped ?? false,
          stage_b_draft1_skip_reason: generated.debug.stage_b_draft1_skip_reason ?? null,
          stage_b_draft2_rewrite_applied: generated.debug.stage_b_draft2_rewrite_applied,
          stage_b_draft2_rewrite_reasons: generated.debug.stage_b_draft2_rewrite_reasons,
          stage_call_logs: generated.debug.stage_call_logs,
        },
      },
      result_jsonb: aiThinkingResult,
      quality_flags_jsonb: aiThinkingResult.quality_flags,
      error_text: null,
      created_at: createdAt,
    };
    await repo.createInsightRun(runRecord);

    session.state_jsonb.latest_ai_thinking = aiThinkingResult;
    session.state_jsonb.ai_thinking_meta = {
      latest_run_id: runId,
      latest_trigger: params.trigger,
      latest_generated_at: createdAt,
      latest_quality_flags: aiThinkingResult.quality_flags,
      latest_error: null,
    };
    session.updated_at = createdAt;
    await updateSessionWithRetry(session);
    return {
      ai_thinking_result: aiThinkingResult,
      run_meta: {
        run_id: runId,
        trigger: params.trigger,
        pack_trace: resolved.packTrace,
        created_at: createdAt,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown AI Thinking generation error";
    await repo.createInsightRun({
      id: runId,
      session_id: params.sessionId,
      trigger_source: params.trigger,
      domain: resolved.domain,
      subdomain: resolved.subdomain,
      language: selectedLanguage,
      pack_trace_jsonb: resolved.packTrace,
      input_snapshot_jsonb: {
        session_id: context.session_id,
        domain: context.domain,
        subdomain: context.subdomain,
      },
      result_jsonb: null,
      quality_flags_jsonb: null,
      error_text: message,
      created_at: createdAt,
    });

    session.state_jsonb.ai_thinking_meta = {
      latest_run_id: runId,
      latest_trigger: params.trigger,
      latest_generated_at: createdAt,
      latest_error: message,
    };
    session.updated_at = createdAt;
    try {
      await updateSessionWithRetry(session);
    } catch {
      // ignore session update errors for error-path bookkeeping
    }
    throw error;
  }
}

export async function listAiThinkingRuns(params: {
  sessionId: string;
  limit?: number;
}): Promise<{
  latest: AskmoreV2InsightRunRecord | null;
  history: AskmoreV2InsightRunRecord[];
}> {
  const repo = getAskmoreV2Repository();
  const history = (await repo.listInsightRuns(params.sessionId, params.limit ?? 20)).filter(isV2Run);
  return {
    latest: history[0] ?? null,
    history,
  };
}

export async function tryAutoGenerateInsightOnCompletion(params: {
  sessionId: string;
  language: AskmoreV2Language;
}): Promise<void> {
  const repo = getAskmoreV2Repository();
  const session = await repo.getSession(params.sessionId);
  if (!session) return;
  if (session.status !== "completed") return;

  try {
    await createAiThinking({
      sessionId: params.sessionId,
      language: params.language,
      trigger: "auto_on_completed",
      forceRegenerate: false,
    });
  } catch {
    // Must never block completion path.
  }
}
