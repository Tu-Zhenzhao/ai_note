export type SuperV1RuntimeErrorCode =
  | "SUPERV1_DATABASE_URL_MISSING"
  | "SUPERV1_DB_UNREACHABLE"
  | "SUPERV1_DB_AUTH_FAILED"
  | "SUPERV1_SCHEMA_MISSING"
  | "SUPERV1_RUNTIME_ERROR";

export class SuperV1RuntimeError extends Error {
  readonly code: SuperV1RuntimeErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: SuperV1RuntimeErrorCode,
    message: string,
    status = 500,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SuperV1RuntimeError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNRESET",
]);

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const direct = readString((error as { code?: unknown }).code);
  if (direct) return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return undefined;
  return readString((cause as { code?: unknown }).code);
}

export function normalizeSuperV1Error(error: unknown): SuperV1RuntimeError {
  if (error instanceof SuperV1RuntimeError) {
    return error;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message || "Unknown SuperV1 runtime error";
  const code = readCode(error);
  const lowered = message.toLowerCase();

  if (
    message.includes("DATABASE_URL not configured") ||
    message.includes("requires DATABASE_URL")
  ) {
    return new SuperV1RuntimeError(
      "SUPERV1_DATABASE_URL_MISSING",
      "SuperV1 requires DATABASE_URL. Configure Postgres and rerun migrations 001 + 002 + 003 + 004.",
      500,
    );
  }

  if (code && NETWORK_ERROR_CODES.has(code)) {
    return new SuperV1RuntimeError(
      "SUPERV1_DB_UNREACHABLE",
      "SuperV1 cannot reach Postgres. Check DATABASE_URL host/network/SSL settings.",
      503,
      { upstream_code: code },
    );
  }

  if (
    lowered.includes("getaddrinfo") ||
    lowered.includes("connection terminated unexpectedly") ||
    lowered.includes("connect econnrefused")
  ) {
    return new SuperV1RuntimeError(
      "SUPERV1_DB_UNREACHABLE",
      "SuperV1 cannot reach Postgres. Check DATABASE_URL host/network/SSL settings.",
      503,
      code ? { upstream_code: code } : undefined,
    );
  }

  if (
    code === "28P01" ||
    code === "28000" ||
    lowered.includes("password authentication failed") ||
    lowered.includes("authentication failed") ||
    lowered.includes("no pg_hba.conf entry")
  ) {
    return new SuperV1RuntimeError(
      "SUPERV1_DB_AUTH_FAILED",
      "SuperV1 Postgres authentication failed. Verify username/password/SSL requirements.",
      503,
      code ? { upstream_code: code } : undefined,
    );
  }

  if (
    code === "42P01" ||
    lowered.includes("relation") && lowered.includes("does not exist")
  ) {
    return new SuperV1RuntimeError(
      "SUPERV1_SCHEMA_MISSING",
      "SuperV1 schema is missing. Apply migrations 001 + 002 + 003 + 004 before starting runtime.",
      500,
      code ? { upstream_code: code } : undefined,
    );
  }

  return new SuperV1RuntimeError(
    "SUPERV1_RUNTIME_ERROR",
    message,
    500,
    code ? { upstream_code: code } : undefined,
  );
}
