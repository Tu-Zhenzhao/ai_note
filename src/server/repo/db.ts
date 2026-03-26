import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

let pool: Pool | null = null;
const txStorage = new AsyncLocalStorage<PoolClient>();

export function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    const max = Number(process.env.PG_POOL_MAX ?? 10);
    const idleTimeoutMillis = Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000);
    const connectionTimeoutMillis = Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 12_000);
    const queryTimeoutMs = Number(process.env.PG_QUERY_TIMEOUT_MS ?? 120_000);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max,
      idleTimeoutMillis,
      connectionTimeoutMillis,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      query_timeout: queryTimeoutMs,
      statement_timeout: queryTimeoutMs,
    });
    pool.on("error", (error) => {
      console.error("[db-pool] idle client error", error instanceof Error ? error.message : String(error));
    });
  }
  return pool;
}

export function getActiveDbExecutor(): Pool | PoolClient | null {
  const txClient = txStorage.getStore();
  if (txClient) return txClient;
  return getPool();
}

export async function dbQuery<R extends QueryResultRow = any>(
  text: string,
  values?: any[],
): Promise<QueryResult<R>> {
  const executor = getActiveDbExecutor();
  if (!executor) {
    throw new Error("DATABASE_URL not configured");
  }
  return executor.query<R>(text, values);
}

export async function withDbTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const rootPool = getPool();
  if (!rootPool) {
    return fn();
  }

  const active = txStorage.getStore();
  if (active) {
    return fn();
  }

  const client = await rootPool.connect();
  try {
    await client.query("begin");
    const result = await txStorage.run(client, fn);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function resetPool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  try {
    await current.end();
  } catch {
    // Ignore pool teardown errors while recovering from transient connection issues.
  }
}

export function getPoolStats(): { total: number; idle: number; waiting: number } | null {
  if (!pool) return null;
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}
