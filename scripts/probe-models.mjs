#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { generateObject, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

function loadEnvFile(filepath) {
  if (!fs.existsSync(filepath)) return;
  const content = fs.readFileSync(filepath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key]) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startedAt) {
  return Date.now() - startedAt;
}

function shortError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 800);
  if (typeof error === "string") return error.slice(0, 800);
  try {
    return JSON.stringify(error).slice(0, 800);
  } catch {
    return String(error).slice(0, 800);
  }
}

async function withTimeout(timeoutMs, fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const cwd = process.cwd();
loadEnvFile(path.join(cwd, ".env.local"));
loadEnvFile(path.join(cwd, ".env"));

const timeoutMs = Number(process.env.MODEL_PROBE_TIMEOUT_MS ?? "30000");
const rounds = Math.max(1, Number(process.env.MODEL_PROBE_ROUNDS ?? "2"));

const strictInsightLikeSchema = z.object({
  professional_read: z.string(),
  what_i_would_pay_attention_to: z.string(),
  practical_guidance: z.string(),
  boundary_notes: z.array(z.string()),
  underlying_drivers_evidence: z.array(z.object({
    hypothesis: z.string(),
    support: z.array(z.string()),
    confidence: z.enum(["low", "medium", "high"]),
  })),
});

const targets = [
  {
    model: "gpt-5",
    provider: "openai",
    keyEnv: "OPENAI_API_KEY",
    buildModel: (name) => openai(name),
  },
  {
    model: process.env.MODEL_PROBE_GEMINI_MODEL ?? "gemini-3.1-pro-preview",
    provider: "google",
    keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    buildModel: (name) => google(name),
  },
];

async function runTextProbe(target, round) {
  const startedAt = Date.now();
  const startedIso = nowIso();
  try {
    const result = await withTimeout(timeoutMs, async (abortSignal) => {
      return generateText({
        model: target.buildModel(target.model),
        system: "Return short plain text only.",
        prompt: "Reply with exactly: model_ok",
        temperature: 0,
        abortSignal,
      });
    });
    return {
      type: "text",
      round,
      started_at: startedIso,
      duration_ms: elapsedMs(startedAt),
      ok: true,
      output_preview: result.text.slice(0, 120),
    };
  } catch (error) {
    return {
      type: "text",
      round,
      started_at: startedIso,
      duration_ms: elapsedMs(startedAt),
      ok: false,
      error: shortError(error),
    };
  }
}

async function runObjectProbe(target, round) {
  const startedAt = Date.now();
  const startedIso = nowIso();
  try {
    const result = await withTimeout(timeoutMs, async (abortSignal) => {
      return generateObject({
        model: target.buildModel(target.model),
        schema: strictInsightLikeSchema,
        system: "Return concise Chinese content.",
        prompt: [
          "Fill all fields with concrete values.",
          "Keep each field brief.",
          "confidence must be one of low|medium|high.",
        ].join("\n"),
        temperature: 0.2,
        abortSignal,
      });
    });
    return {
      type: "object",
      round,
      started_at: startedIso,
      duration_ms: elapsedMs(startedAt),
      ok: true,
      output_preview: JSON.stringify(result.object).slice(0, 220),
    };
  } catch (error) {
    return {
      type: "object",
      round,
      started_at: startedIso,
      duration_ms: elapsedMs(startedAt),
      ok: false,
      error: shortError(error),
    };
  }
}

async function runTarget(target) {
  const hasKey = Boolean(process.env[target.keyEnv]);
  if (!hasKey) {
    return {
      model: target.model,
      provider: target.provider,
      key_env: target.keyEnv,
      key_available: false,
      probes: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
      },
    };
  }

  const probes = [];
  for (let round = 1; round <= rounds; round += 1) {
    probes.push(await runTextProbe(target, round));
    probes.push(await runObjectProbe(target, round));
  }

  const passed = probes.filter((p) => p.ok).length;
  const failed = probes.length - passed;
  return {
    model: target.model,
    provider: target.provider,
    key_env: target.keyEnv,
    key_available: true,
    probes,
    summary: {
      total: probes.length,
      passed,
      failed,
    },
  };
}

async function main() {
  const startedAt = nowIso();
  const report = {
    started_at: startedAt,
    timeout_ms: timeoutMs,
    rounds,
    targets: [],
  };

  for (const target of targets) {
    // Run sequentially to simplify rate-limit/latency interpretation.
    // eslint-disable-next-line no-await-in-loop
    const item = await runTarget(target);
    report.targets.push(item);
  }
  report.finished_at = nowIso();

  const outDir = path.join(cwd, "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(
    outDir,
    `model-probe-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  console.log("\n=== Model Probe Summary ===");
  for (const target of report.targets) {
    const sum = target.summary;
    console.log(
      `${target.model} (${target.provider}) -> key:${target.key_available ? "yes" : "no"}, pass:${sum.passed}/${sum.total}, fail:${sum.failed}`,
    );
    for (const probe of target.probes) {
      console.log(
        `  - round ${probe.round} ${probe.type}: ${probe.ok ? "ok" : "fail"} (${probe.duration_ms}ms)`,
      );
      if (!probe.ok) {
        console.log(`    error: ${probe.error}`);
      }
    }
  }
  console.log(`\nReport saved: ${outFile}`);
}

main().catch((error) => {
  console.error("Model probe failed:", shortError(error));
  process.exit(1);
});

