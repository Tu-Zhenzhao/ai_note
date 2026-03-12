import { afterEach, describe, expect, test, vi } from "vitest";
import { runStep } from "@/server/tools/runtime-trace";

describe("runtime trace utility", () => {
  const prevVerbose = process.env.AGENT_TRACE_VERBOSE;

  afterEach(() => {
    process.env.AGENT_TRACE_VERBOSE = prevVerbose;
    vi.restoreAllMocks();
  });

  test("runStep logs start and success when verbose is enabled", async () => {
    process.env.AGENT_TRACE_VERBOSE = "true";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const value = await runStep({
      ctx: { runtime: "test.runtime", sessionId: "s1", turnId: "t1" },
      step: "classify_turn",
      inputSummary: { message_len: 24 },
      successSummary: (result) => ({ value: result }),
      fn: async () => 7,
    });

    expect(value).toBe(7);
    expect(logSpy.mock.calls.some(([line]) => String(line).includes("step=classify_turn") && String(line).includes("event=start"))).toBe(true);
    expect(logSpy.mock.calls.some(([line]) => String(line).includes("step=classify_turn") && String(line).includes("result=ok"))).toBe(true);
  });

  test("required step failure rethrows and logs error", async () => {
    process.env.AGENT_TRACE_VERBOSE = "false";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      runStep({
        ctx: { runtime: "test.runtime", conversationId: "c1", turnId: "t2" },
        step: "validate_extraction",
        fn: async () => {
          throw new Error("forced failure");
        },
      }),
    ).rejects.toThrow("forced failure");

    expect(logSpy.mock.calls.some(([line]) => String(line).includes("step=validate_extraction") && String(line).includes("event=start"))).toBe(false);
    expect(errorSpy.mock.calls.some(([line]) => String(line).includes("step=validate_extraction") && String(line).includes("result=fail"))).toBe(true);
  });

  test("non-required step failure logs skip and returns fallback", async () => {
    process.env.AGENT_TRACE_VERBOSE = "true";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const value = await runStep({
      ctx: { runtime: "test.runtime", conversationId: "c2", turnId: "t3" },
      step: "append_legacy_chatbook",
      required: false,
      fallbackValue: "continued",
      fn: async () => {
        throw new Error("legacy write failed");
      },
    });

    expect(value).toBe("continued");
    expect(errorSpy.mock.calls.some(([line]) => String(line).includes("step=append_legacy_chatbook") && String(line).includes("result=fail"))).toBe(true);
    expect(warnSpy.mock.calls.some(([line]) => String(line).includes("step=append_legacy_chatbook") && String(line).includes("result=skip"))).toBe(true);
  });
});
