"use client";

import type { SuperV1RuntimePhase } from "@/server/superv1/types";
import type { AskmoreV2RuntimePhase } from "@/server/askmore_v2/types";

export type RuntimeProgressPhase = SuperV1RuntimePhase | AskmoreV2RuntimePhase | "done";

export type RuntimeProgressItem = {
  phase: RuntimeProgressPhase;
  label: string;
  status: "running" | "shrinking" | "checked" | "exiting";
};

export function AgentRuntimeProgress({ items }: { items: RuntimeProgressItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="runtime-progress-stack" aria-live="polite" aria-atomic="true">
      {items.map((item) => (
        <div
          key={item.phase}
          className={`runtime-pill ${
            item.status === "running"
              ? "is-running"
              : item.status === "shrinking"
                ? "is-shrinking"
                : item.status === "checked"
                  ? "is-checked"
                  : "is-exiting"
          }`}
        >
          <span className="runtime-pill-icon" aria-hidden="true">
            <span className="runtime-pill-spinner" />
            <span className="runtime-pill-check">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <path
                  d="M5 10.4L8.4 13.6L15 7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </span>
          <span className="runtime-pill-text">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
