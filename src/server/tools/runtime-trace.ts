type TracePrimitive = string | number | boolean | null | undefined;
type TraceValue = TracePrimitive | TraceValue[] | { [key: string]: TraceValue };
export type TraceSummary = Record<string, TraceValue>;

export interface TraceContext {
  runtime: string;
  sessionId?: string;
  conversationId?: string;
  turnId?: string;
}

export interface TraceErrorSummary {
  error_name: string;
  error_message: string;
  error_stack: string;
}

function isVerbose() {
  return process.env.AGENT_TRACE_VERBOSE === "true";
}

function toKeyValueSegments(ctx: TraceContext) {
  const base: Record<string, string> = {
    runtime: ctx.runtime,
  };
  if (ctx.sessionId) base.session = ctx.sessionId;
  if (ctx.conversationId) base.conversation = ctx.conversationId;
  if (ctx.turnId) base.turn = ctx.turnId;
  return Object.entries(base).map(([key, value]) => `${key}=${value}`);
}

function truncateValue(value: TraceValue, max = 120): TraceValue {
  if (typeof value === "string") {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}...(${value.length})`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((entry) => truncateValue(entry, max));
  }
  if (value && typeof value === "object") {
    const out: Record<string, TraceValue> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = truncateValue(item as TraceValue, max);
    }
    return out;
  }
  return value;
}

function sanitizeSummary(summary: TraceSummary | undefined): TraceSummary | undefined {
  if (!summary) return undefined;
  const out: TraceSummary = {};
  for (const [key, value] of Object.entries(summary)) {
    out[key] = truncateValue(value as TraceValue);
  }
  return out;
}

function printLine(level: "log" | "warn" | "error", message: string, summary?: TraceSummary) {
  const safe = sanitizeSummary(summary);
  if (safe && Object.keys(safe).length > 0) {
    console[level](`${message} ${JSON.stringify(safe)}`);
  } else {
    console[level](message);
  }
}

function baseLine(ctx: TraceContext, extras: string[]) {
  return `[agent-trace] ${[...toKeyValueSegments(ctx), ...extras].join(" ")}`;
}

export function traceRunStart(ctx: TraceContext, summary?: TraceSummary) {
  printLine("log", baseLine(ctx, ["phase=run", "event=start"]), summary);
}

export function traceRunEnd(
  ctx: TraceContext,
  params: {
    status: "ok" | "fail";
    durationMs: number;
    summary?: TraceSummary;
  },
) {
  printLine(
    params.status === "ok" ? "log" : "error",
    baseLine(ctx, ["phase=run", "event=end", `result=${params.status}`, `duration_ms=${params.durationMs}`]),
    params.summary,
  );
}

export function traceStepStart(ctx: TraceContext, step: string, summary?: TraceSummary) {
  if (!isVerbose()) return;
  printLine("log", baseLine(ctx, ["phase=step", `step=${step}`, "event=start"]), summary);
}

export function traceStepSuccess(
  ctx: TraceContext,
  step: string,
  durationMs: number,
  summary?: TraceSummary,
) {
  if (!isVerbose()) return;
  printLine(
    "log",
    baseLine(ctx, ["phase=step", `step=${step}`, "event=end", "result=ok", `duration_ms=${durationMs}`]),
    summary,
  );
}

export function traceStepSkipped(
  ctx: TraceContext,
  step: string,
  durationMs: number,
  summary?: TraceSummary,
) {
  printLine(
    "warn",
    baseLine(ctx, ["phase=step", `step=${step}`, "event=end", "result=skip", `duration_ms=${durationMs}`]),
    summary,
  );
}

export function traceStepError(
  ctx: TraceContext,
  step: string,
  durationMs: number,
  error: unknown,
  summary?: TraceSummary,
) {
  const err = toErrorSummary(error);
  printLine(
    "error",
    baseLine(ctx, ["phase=step", `step=${step}`, "event=end", "result=fail", `duration_ms=${durationMs}`]),
    {
      ...summary,
      ...err,
    },
  );
}

export function toErrorSummary(error: unknown): TraceErrorSummary {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    error_name: err.name,
    error_message: err.message,
    error_stack: err.stack ?? "",
  };
}

export async function runStep<T>(params: {
  ctx: TraceContext;
  step: string;
  required?: boolean;
  inputSummary?: TraceSummary;
  successSummary?: (value: T) => TraceSummary;
  skipSummary?: TraceSummary;
  fallbackValue?: T;
  fn: () => Promise<T> | T;
}): Promise<T> {
  const required = params.required !== false;
  const startedAt = Date.now();
  traceStepStart(params.ctx, params.step, params.inputSummary);
  try {
    const value = await params.fn();
    const durationMs = Date.now() - startedAt;
    traceStepSuccess(params.ctx, params.step, durationMs, params.successSummary ? params.successSummary(value) : undefined);
    return value;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    traceStepError(params.ctx, params.step, durationMs, error, params.inputSummary);
    if (required) {
      throw error;
    }
    traceStepSkipped(params.ctx, params.step, durationMs, params.skipSummary ?? { reason: "best_effort_step_failed" });
    return params.fallbackValue as T;
  }
}
