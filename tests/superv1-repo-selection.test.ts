import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("superv1 repository selection", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.DATABASE_URL = previousDatabaseUrl;
    process.env.NODE_ENV = previousNodeEnv;
    vi.restoreAllMocks();
  });

  test("throws when DATABASE_URL is missing outside test mode", async () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "production";

    const { getSuperV1Repository } = await import("@/server/superv1/repo");

    expect(() => getSuperV1Repository()).toThrowError(/DATABASE_URL/i);
    expect(() => getSuperV1Repository()).toThrowError(/migrations 001 \+ 002/i);
  });

  test("uses memory repo in test mode when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "test";

    const { getSuperV1Repository } = await import("@/server/superv1/repo");
    const { MemorySuperV1Repository } = await import("@/server/superv1/repo/memory-repo");

    const repo = getSuperV1Repository();

    expect(repo).toBeInstanceOf(MemorySuperV1Repository);
  });

  test("uses Postgres repo when DATABASE_URL is configured", async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/interviewer";

    const { getSuperV1Repository } = await import("@/server/superv1/repo");
    const { PostgresSuperV1Repository } = await import("@/server/superv1/repo/postgres-repo");

    const repo = getSuperV1Repository();

    expect(repo).toBeInstanceOf(PostgresSuperV1Repository);
  });
});
