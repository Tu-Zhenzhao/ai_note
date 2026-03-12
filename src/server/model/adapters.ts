import { deepseek } from "@ai-sdk/deepseek";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import { z } from "zod";

const DEFAULT_GEMINI = process.env.MODEL_PRIMARY ?? "gemini-3.1-flash-lite-preview";
const DEFAULT_GPT = process.env.MODEL_CO_PRIMARY ?? "gpt-5";
const DEFAULT_FALLBACK = process.env.MODEL_FALLBACK ?? "deepseek-chat";
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 12000);

export type ModelTask =
  | "interview_response"
  | "structured_extraction"
  | "preview_composition"
  | "brief_planning"
  | "content_generation";

interface PromptOptions {
  system: string;
  prompt: string;
  primaryModel?: string;
  fallbackModel?: string;
}

export interface ModelRouteResult {
  modelUsed: string;
  provider: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ContextWindowInfo {
  modelUsed: string;
  provider: string;
  maxContextTokens: number;
  usedTokens: number;
  utilizationPercent: number;
  breakdown: {
    systemPromptTokens: number;
    userPromptTokens: number;
    completionTokens: number;
  };
  estimatedCostUsd: number;
}

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gemini-3.1-flash-lite-preview": 1_048_576,
  "gpt-5": 400_000,
  "deepseek-chat": 64_000,
};

const COST_PER_1K_INPUT: Record<string, number> = {
  "gemini-3.1-flash-lite-preview": 0.000125,
  "gpt-5": 0.005,
  "deepseek-chat": 0.00014,
};

const COST_PER_1K_OUTPUT: Record<string, number> = {
  "gemini-3.1-flash-lite-preview": 0.000375,
  "gpt-5": 0.015,
  "deepseek-chat": 0.00028,
};

let lastRouteResult: ModelRouteResult = { modelUsed: "none", provider: "none" };
let lastTokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
let cumulativeTokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
let lastSystemPromptLength = 0;
let lastUserPromptLength = 0;

export function getLastModelRoute(): ModelRouteResult {
  return lastRouteResult;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const inputRate = COST_PER_1K_INPUT[model] ?? 0.001;
  const outputRate = COST_PER_1K_OUTPUT[model] ?? 0.002;
  return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
}

export function getLastTokenUsage(): TokenUsage {
  return lastTokenUsage;
}

export function getCumulativeTokenUsage(): TokenUsage {
  return { ...cumulativeTokenUsage };
}

export function resetCumulativeTokenUsage(): void {
  cumulativeTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export function getContextWindowInfo(): ContextWindowInfo {
  const model = lastRouteResult.modelUsed;
  const maxTokens = MODEL_CONTEXT_LIMITS[model] ?? 128_000;
  const systemTokens = estimateTokens(" ".repeat(lastSystemPromptLength));
  const userTokens = estimateTokens(" ".repeat(lastUserPromptLength));
  const used = lastTokenUsage.totalTokens || (systemTokens + userTokens + lastTokenUsage.completionTokens);

  return {
    modelUsed: model,
    provider: lastRouteResult.provider,
    maxContextTokens: maxTokens,
    usedTokens: used,
    utilizationPercent: maxTokens > 0 ? Math.round((used / maxTokens) * 10000) / 100 : 0,
    breakdown: {
      systemPromptTokens: lastTokenUsage.promptTokens > 0 ? Math.round(lastTokenUsage.promptTokens * (lastSystemPromptLength / Math.max(lastSystemPromptLength + lastUserPromptLength, 1))) : systemTokens,
      userPromptTokens: lastTokenUsage.promptTokens > 0 ? Math.round(lastTokenUsage.promptTokens * (lastUserPromptLength / Math.max(lastSystemPromptLength + lastUserPromptLength, 1))) : userTokens,
      completionTokens: lastTokenUsage.completionTokens,
    },
    estimatedCostUsd: computeCost(model, lastTokenUsage.promptTokens, lastTokenUsage.completionTokens),
  };
}

function getModelByName(name: string) {
  if (name.startsWith("gpt")) return openai(name);
  if (name.startsWith("gemini")) return google(name);
  return deepseek(name);
}

function providerFor(name: string): string {
  if (name.startsWith("gpt")) return "openai";
  if (name.startsWith("gemini")) return "google";
  return "deepseek";
}

function hasKeyForModel(name: string): boolean {
  if (name.startsWith("gpt")) return !!process.env.OPENAI_API_KEY;
  if (name.startsWith("gemini")) return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  return !!process.env.DEEPSEEK_API_KEY;
}

function selectPrimaryModel(explicit?: string): string {
  if (explicit && hasKeyForModel(explicit)) return explicit;
  if (hasKeyForModel(DEFAULT_GEMINI)) return DEFAULT_GEMINI;
  if (hasKeyForModel(DEFAULT_GPT)) return DEFAULT_GPT;
  return DEFAULT_FALLBACK;
}

async function withFallback<T>(
  opts: PromptOptions,
  run: (modelName: string, abortSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  const primaryName = selectPrimaryModel(opts.primaryModel);
  const fallbackName = opts.fallbackModel ?? DEFAULT_FALLBACK;
  const coPrimary = primaryName.startsWith("gemini") ? DEFAULT_GPT : DEFAULT_GEMINI;

  if (
    !hasKeyForModel(primaryName) &&
    !hasKeyForModel(coPrimary) &&
    !hasKeyForModel(fallbackName)
  ) {
    throw new Error(
      `All model providers failed (primary: ${primaryName}, fallback: ${fallbackName})`,
    );
  }

  const runWithTimeout = async (modelName: string): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
    try {
      return await run(modelName, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const result = await runWithTimeout(primaryName);
    lastRouteResult = { modelUsed: primaryName, provider: providerFor(primaryName) };
    return result;
  } catch {
    if (hasKeyForModel(coPrimary) && coPrimary !== primaryName) {
      try {
        const result = await runWithTimeout(coPrimary);
        lastRouteResult = { modelUsed: coPrimary, provider: providerFor(coPrimary) };
        return result;
      } catch {
        // fall through to deepseek
      }
    }

    if (hasKeyForModel(fallbackName) && fallbackName !== primaryName) {
      const result = await runWithTimeout(fallbackName);
      lastRouteResult = { modelUsed: fallbackName, provider: providerFor(fallbackName) };
      return result;
    }

    throw new Error(`All model providers failed (primary: ${primaryName}, fallback: ${fallbackName})`);
  }
}

function recordTokenUsage(inputTokens: number, outputTokens: number) {
  lastTokenUsage = {
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
  cumulativeTokenUsage.promptTokens += inputTokens;
  cumulativeTokenUsage.completionTokens += outputTokens;
  cumulativeTokenUsage.totalTokens += inputTokens + outputTokens;
}

export async function generateModelText(opts: PromptOptions): Promise<string> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    throw new Error("Model calls disabled in test environment");
  }
  lastSystemPromptLength = opts.system.length;
  lastUserPromptLength = opts.prompt.length;

  return withFallback(opts, async (modelName, abortSignal) => {
    const result = await generateText({
      model: getModelByName(modelName),
      system: opts.system,
      prompt: opts.prompt,
      temperature: 0.3,
      abortSignal,
    });

    const input = result.usage?.inputTokens ?? estimateTokens(opts.system + opts.prompt);
    const output = result.usage?.outputTokens ?? estimateTokens(result.text);
    recordTokenUsage(input, output);

    return result.text;
  });
}

export async function generateModelObject<T extends z.ZodTypeAny>(
  opts: PromptOptions & { schema: T },
): Promise<z.infer<T>> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    throw new Error("Model calls disabled in test environment");
  }
  lastSystemPromptLength = opts.system.length;
  lastUserPromptLength = opts.prompt.length;

  const object = await withFallback(opts, async (modelName, abortSignal) => {
    const result = await generateObject({
      model: getModelByName(modelName),
      schema: opts.schema,
      system: opts.system,
      prompt: opts.prompt,
      temperature: 0.2,
      abortSignal,
    });

    const input = result.usage?.inputTokens ?? estimateTokens(opts.system + opts.prompt);
    const output = result.usage?.outputTokens ?? estimateTokens(JSON.stringify(result.object));
    recordTokenUsage(input, output);

    return result.object as z.infer<T>;
  });
  return object as z.infer<T>;
}

export function modelAvailability() {
  return {
    openai: !!process.env.OPENAI_API_KEY,
    google: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
  };
}
