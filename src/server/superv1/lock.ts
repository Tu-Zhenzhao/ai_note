import { getPool } from "@/server/repo/db";

const memoryLocks = new Map<string, Promise<void>>();

async function withMemoryConversationLock<T>(
  conversationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = memoryLocks.get(conversationId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => gate);
  memoryLocks.set(conversationId, next);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (memoryLocks.get(conversationId) === next) {
      memoryLocks.delete(conversationId);
    }
  }
}

export async function withConversationLock<T>(
  conversationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const pool = getPool();
  if (!pool) {
    return withMemoryConversationLock(conversationId, fn);
  }

  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [conversationId]);
    return await fn();
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [conversationId]);
    } catch {
      // If the connection dropped, unlock is no longer possible on this session.
    } finally {
      client.release();
    }
  }
}
