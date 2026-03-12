import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("@/server/repo/db", () => ({
  getPool: vi.fn(() => ({ query: queryMock })),
}));

describe("superv1 db preflight", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    queryMock.mockReset();
  });

  afterEach(() => {
    process.env.DATABASE_URL = previousDatabaseUrl;
    vi.restoreAllMocks();
  });

  test("throws SUPERV1_DATABASE_URL_MISSING when DATABASE_URL is absent", async () => {
    delete process.env.DATABASE_URL;
    const { ensureSuperV1PostgresReady } = await import("@/server/superv1/db-preflight");

    await expect(ensureSuperV1PostgresReady()).rejects.toMatchObject({
      code: "SUPERV1_DATABASE_URL_MISSING",
    });
  });

  test("maps DNS/network failures to SUPERV1_DB_UNREACHABLE", async () => {
    process.env.DATABASE_URL = "postgres://example";
    const networkError = new Error("getaddrinfo ENOTFOUND host") as Error & { code: string };
    networkError.code = "ENOTFOUND";
    queryMock.mockRejectedValueOnce(networkError);

    const { ensureSuperV1PostgresReady } = await import("@/server/superv1/db-preflight");

    await expect(ensureSuperV1PostgresReady()).rejects.toMatchObject({
      code: "SUPERV1_DB_UNREACHABLE",
      status: 503,
    });
  });

  test("maps auth failures to SUPERV1_DB_AUTH_FAILED", async () => {
    process.env.DATABASE_URL = "postgres://example";
    const authError = new Error("password authentication failed") as Error & { code: string };
    authError.code = "28P01";
    queryMock.mockRejectedValueOnce(authError);

    const { ensureSuperV1PostgresReady } = await import("@/server/superv1/db-preflight");

    await expect(ensureSuperV1PostgresReady()).rejects.toMatchObject({
      code: "SUPERV1_DB_AUTH_FAILED",
      status: 503,
    });
  });

  test("throws SUPERV1_SCHEMA_MISSING when required tables are absent", async () => {
    process.env.DATABASE_URL = "postgres://example";
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [{ table_name: "public.turns" }] });

    const { ensureSuperV1PostgresReady } = await import("@/server/superv1/db-preflight");

    await expect(ensureSuperV1PostgresReady()).rejects.toMatchObject({
      code: "SUPERV1_SCHEMA_MISSING",
      details: {
        missing_tables: ["public.turns"],
      },
    });
  });

  test("passes when connectivity and schema checks succeed", async () => {
    process.env.DATABASE_URL = "postgres://example";
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { ensureSuperV1PostgresReady } = await import("@/server/superv1/db-preflight");

    await expect(ensureSuperV1PostgresReady()).resolves.toBeUndefined();
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
