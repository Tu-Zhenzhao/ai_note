import { describe, expect, test } from "vitest";
import { withConversationLock } from "@/server/superv1/lock";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("superv1 conversation lock", () => {
  test("serializes concurrent work for the same conversation id", async () => {
    const events: string[] = [];
    let value = 0;

    await Promise.all([
      withConversationLock("lock-conv-1", async () => {
        events.push("a:start");
        const snapshot = value;
        await sleep(20);
        value = snapshot + 1;
        events.push("a:end");
      }),
      withConversationLock("lock-conv-1", async () => {
        events.push("b:start");
        const snapshot = value;
        await sleep(20);
        value = snapshot + 1;
        events.push("b:end");
      }),
    ]);

    expect(value).toBe(2);
    const orderA = events.join(",");
    expect(
      orderA === "a:start,a:end,b:start,b:end" ||
        orderA === "b:start,b:end,a:start,a:end",
    ).toBe(true);
  });
});

