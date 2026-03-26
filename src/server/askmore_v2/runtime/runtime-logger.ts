function shouldRuntimeLog(): boolean {
  return process.env.ASKMORE_V2_RUNTIME_LOG !== "0";
}

function trimString(value: string): string {
  if (value.length <= 160) return value;
  return `${value.slice(0, 157)}...`;
}

function compact(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[depth_limited]";
  if (typeof value === "string") return trimString(value);
  if (Array.isArray(value)) {
    const sliced = value.slice(0, 8).map((item) => compact(item, depth + 1));
    if (value.length > 8) sliced.push(`[+${value.length - 8} more]`);
    return sliced;
  }
  if (!value || typeof value !== "object") return value;

  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, 20)) {
    out[key] = compact(item, depth + 1);
  }
  if (entries.length > 20) {
    out.__extra_keys__ = entries.length - 20;
  }
  return out;
}

export function logAskmoreRuntime(event: string, payload?: Record<string, unknown>): void {
  if (!shouldRuntimeLog()) return;
  const safePayload = payload ? compact(payload) : {};
  console.log(`[askmore_v2_runtime] event=${event} payload=${JSON.stringify(safePayload)}`);
}
