import { generateModelObject, getLastModelRoute } from "@/server/model/adapters";
import { InsightContextPayload } from "@/server/askmore_v2/insight/context-builder";
import {
  AiThinkingStageAResult,
  AiThinkingStageBDraft1Result,
  composeAiThinkingStageAPrompt,
  composeAiThinkingStageBDraft1Prompt,
  composeAiThinkingStageBDraft2Prompt,
} from "@/server/askmore_v2/insight/prompt-composer";
import {
  aiThinkingStageASchema,
  aiThinkingStageBDraft1Schema,
  aiThinkingStageBSchema,
  evaluateAiThinkingDraft2Style,
  normalizeAiThinkingResult,
} from "@/server/askmore_v2/insight/normalizer";
import {
  AskmoreV2AiThinkingResult,
  AskmoreV2InsightPackTrace,
} from "@/server/askmore_v2/types";

const AI_THINKING_TIMEOUT_MS = (() => {
  const raw = process.env.ASKMORE_V2_AI_THINKING_TIMEOUT_MS ?? "30000";
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30000;
  return Math.max(1000, Math.floor(n));
})();

const AI_THINKING_PRIMARY_MODEL = process.env.ASKMORE_V2_AI_THINKING_PRIMARY_MODEL
  ?? "gemini-3.1-flash-lite-preview";

const AI_THINKING_CO_PRIMARY_MODEL = process.env.ASKMORE_V2_AI_THINKING_CO_PRIMARY_MODEL
  ?? "gemini-3.1-pro-preview";

const AI_THINKING_FALLBACK_MODEL = process.env.ASKMORE_V2_AI_THINKING_FALLBACK_MODEL
  ?? process.env.MODEL_FALLBACK
  ?? "deepseek-chat";

const AI_THINKING_RETRY_LIMIT = 1;

function isRetryableModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = `${error.name} ${error.message}`.toLowerCase();
  return (
    msg.includes("abort")
    || msg.includes("aborted")
    || msg.includes("timeout")
    || msg.includes("timed out")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry<T>(params: {
  sessionId: string;
  system: string;
  prompt: string;
  schema: unknown;
  stage: string;
  logs: AiThinkingGenerationDebug["stage_call_logs"];
  onStageEvent?: (event: {
    stage: string;
    attempt: number;
    status: "start" | "success" | "error";
    model_used?: string;
    provider?: string;
    error?: string;
  }) => void;
}): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= AI_THINKING_RETRY_LIMIT; attempt += 1) {
    const startedAt = new Date();
    params.onStageEvent?.({
      stage: params.stage,
      attempt,
      status: "start",
    });
    try {
      const result = await generateModelObject({
        system: params.system,
        prompt: params.prompt,
        schema: params.schema as never,
        primaryModel: AI_THINKING_PRIMARY_MODEL,
        coPrimaryModel: AI_THINKING_CO_PRIMARY_MODEL,
        fallbackModel: AI_THINKING_FALLBACK_MODEL,
        timeoutMs: AI_THINKING_TIMEOUT_MS,
      }) as T;
      const endedAt = new Date();
      const route = getLastModelRoute();
      const successLog = {
        stage: params.stage,
        attempt,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        duration_ms: endedAt.getTime() - startedAt.getTime(),
        success: true,
        model_used: route.modelUsed,
        provider: route.provider,
      };
      params.logs.push(successLog);
      params.onStageEvent?.({
        stage: params.stage,
        attempt,
        status: "success",
        model_used: route.modelUsed,
        provider: route.provider,
      });
      return result;
    } catch (error) {
      lastError = error;
      const endedAt = new Date();
      const errMsg = error instanceof Error ? error.message : String(error);
      const failLog = {
        stage: params.stage,
        attempt,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        duration_ms: endedAt.getTime() - startedAt.getTime(),
        success: false,
        error: errMsg,
      };
      params.logs.push(failLog);
      params.onStageEvent?.({
        stage: params.stage,
        attempt,
        status: "error",
        error: errMsg,
      });
      const canRetry = attempt < AI_THINKING_RETRY_LIMIT && isRetryableModelError(error);
      if (!canRetry) break;
      await sleep(220 + attempt * 180);
    }
  }
  throw lastError instanceof Error
    ? new Error(`[AI Thinking ${params.stage}] ${lastError.message}`)
    : new Error(`[AI Thinking ${params.stage}] model call failed`);
}

export interface AiThinkingGenerationDebug {
  stage_b_draft1: AiThinkingStageBDraft1Result;
  stage_b_draft2_rewrite_applied: boolean;
  stage_b_draft2_rewrite_reasons: string[];
  stage_call_logs: Array<{
    stage: string;
    attempt: number;
    started_at: string;
    ended_at: string;
    duration_ms: number;
    success: boolean;
    model_used?: string;
    provider?: string;
    error?: string;
  }>;
  stage_b_draft1_skipped?: boolean;
  stage_b_draft1_skip_reason?: string;
}

export async function generateAiThinking(params: {
  context: InsightContextPayload;
  packTrace: AskmoreV2InsightPackTrace;
  onStageEvent?: (event: {
    stage: string;
    attempt: number;
    status: "start" | "success" | "error";
    model_used?: string;
    provider?: string;
    error?: string;
  }) => void;
}): Promise<{
  result: AskmoreV2AiThinkingResult;
  debug: AiThinkingGenerationDebug;
}> {
  const stageCallLogs: AiThinkingGenerationDebug["stage_call_logs"] = [];
  const stageAPrompt = composeAiThinkingStageAPrompt({
    context: params.context,
    packTrace: params.packTrace,
  });

  const stageA = await generateWithRetry<AiThinkingStageAResult>({
    sessionId: params.context.session_id,
    system: stageAPrompt.system,
    prompt: stageAPrompt.prompt,
    stage: "stage_a",
    schema: aiThinkingStageASchema,
    logs: stageCallLogs,
    onStageEvent: params.onStageEvent,
  });

  const stageBDraft1Prompt = composeAiThinkingStageBDraft1Prompt({
    context: params.context,
    packTrace: params.packTrace,
    stageAResult: stageA,
  });

  let stageBDraft1: AiThinkingStageBDraft1Result;
  let stageBDraft1Skipped = false;
  let stageBDraft1SkipReason = "";
  try {
    stageBDraft1 = await generateWithRetry<AiThinkingStageBDraft1Result>({
      sessionId: params.context.session_id,
      system: stageBDraft1Prompt.system,
      prompt: stageBDraft1Prompt.prompt,
      stage: "stage_b_draft1",
      schema: aiThinkingStageBDraft1Schema,
      logs: stageCallLogs,
      onStageEvent: params.onStageEvent,
    });
  } catch (error) {
    if (!isRetryableModelError(error)) throw error;
    stageBDraft1Skipped = true;
    stageBDraft1SkipReason = error instanceof Error ? error.message : String(error);
    stageBDraft1 = {
      draft1_professional_read: stageA.expert_impression,
      draft1_attention_points: stageA.respondent_state_read,
      draft1_practical_guidance: stageA.provider_intent_read,
      observation_anchors: stageA.observed_facts,
      open_questions_or_hypotheses: stageA.claims,
      tone_risks_to_avoid_in_draft2: [],
    };
    params.onStageEvent?.({
      stage: "stage_b_draft1",
      attempt: 0,
      status: "success",
      model_used: "stage_a_fallback",
      provider: "local",
    });
  }

  const stageBDraft2Prompt = composeAiThinkingStageBDraft2Prompt({
    context: params.context,
    packTrace: params.packTrace,
    stageAResult: stageA,
    stageBDraft1Result: stageBDraft1,
  });

  let stageBDraft2Raw = await generateWithRetry<unknown>({
    sessionId: params.context.session_id,
    system: stageBDraft2Prompt.system,
    prompt: stageBDraft2Prompt.prompt,
    stage: "stage_b_draft2",
    schema: aiThinkingStageBSchema,
    logs: stageCallLogs,
    onStageEvent: params.onStageEvent,
  });

  let draft2PromptComposition = stageBDraft2Prompt.promptComposition;
  let draft2Style = evaluateAiThinkingDraft2Style(stageBDraft2Raw);
  let rewriteReasons: string[] = [];

  if (draft2Style.rewrite_needed) {
    rewriteReasons = [
      draft2Style.is_conclusion_first ? "conclusion_first" : "",
      draft2Style.has_observation_anchor ? "" : "missing_observation_anchor",
      draft2Style.has_open_question_or_hypothesis ? "" : "missing_open_question_or_hypothesis",
      draft2Style.too_template_like ? "template_like_tone" : "",
    ].filter(Boolean);

    const rewritePrompt = composeAiThinkingStageBDraft2Prompt({
      context: params.context,
      packTrace: params.packTrace,
      stageAResult: stageA,
      stageBDraft1Result: stageBDraft1,
      previousDraft2Result: stageBDraft2Raw,
      rewriteReasons,
    });
    stageBDraft2Raw = await generateWithRetry<unknown>({
      sessionId: params.context.session_id,
      system: rewritePrompt.system,
      prompt: rewritePrompt.prompt,
      stage: "stage_b_draft2_retry",
      schema: aiThinkingStageBSchema,
      logs: stageCallLogs,
      onStageEvent: params.onStageEvent,
    });
    draft2PromptComposition = rewritePrompt.promptComposition;
    draft2Style = evaluateAiThinkingDraft2Style(stageBDraft2Raw);
  }

  const result = normalizeAiThinkingResult({
    raw: stageBDraft2Raw,
    stageA,
    domain: params.context.domain,
    packTrace: params.packTrace,
    styleSignals: draft2Style,
    promptComposition: [
      ...stageAPrompt.promptComposition,
      ...stageBDraft1Prompt.promptComposition,
      ...draft2PromptComposition,
    ],
  });

  return {
    result,
    debug: {
      stage_b_draft1: stageBDraft1,
      stage_b_draft2_rewrite_applied: rewriteReasons.length > 0,
      stage_b_draft2_rewrite_reasons: rewriteReasons,
      stage_call_logs: stageCallLogs,
      stage_b_draft1_skipped: stageBDraft1Skipped || undefined,
      stage_b_draft1_skip_reason: stageBDraft1SkipReason || undefined,
    },
  };
}
