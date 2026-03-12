"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  getSectionVisualState,
  getPreviewFocusKey,
  REVIEW_SECTION_BY_INDEX,
  ReviewSectionId,
  SECTION_NAME_BY_ID,
} from "@/components/interview-review-state";

// ─── Types ────────────────────────────────────────────────────────────────────

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type VerificationIndicator = {
  label: string;
  state:
    | "confirmed_by_user"
    | "inferred_from_conversation"
    | "needs_confirmation";
};

type ContextWindowData = {
  modelUsed: string;
  provider: string;
  maxContextTokens: number;
  usedTokens: number;
  utilizationPercent: number;
  breakdown: {
    systemPromptTokens: number;
    userPromptTokens: number;
    completionTokens: number;
  };
  estimatedCostUsd: number;
};

type CumulativeTokenData = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type ReviewItemConfig = {
  fieldKey: string;
  label: string;
  hint: string;
};

type ReviewState = {
  sectionId: ReviewSectionId;
  stepIndex: number;
  isEditing: boolean;
  draftValue: string;
  submitting: boolean;
};

type WorkflowStatePayload = {
  phase?: string;
  active_section_id?: string;
  pending_review_section_id?: string | null;
  transition_allowed?: boolean;
};

const REVIEW_ITEMS: Record<ReviewSectionId, ReviewItemConfig[]> = {
  company_understanding: [
    { fieldKey: "company_summary", label: "Summary", hint: "Does this clearly represent your company?" },
    { fieldKey: "short_brand_story", label: "Brand story", hint: "Is this the right belief/story behind your brand?" },
    { fieldKey: "main_offering", label: "Main offering", hint: "Is this the best description of your main offering?" },
    { fieldKey: "problem_solved", label: "Problem solved", hint: "Does this capture the core problem you solve?" },
    { fieldKey: "differentiator", label: "Differentiator", hint: "Does this describe what makes you different?" },
  ],
  audience_understanding: [
    { fieldKey: "primary_audience", label: "Primary audience", hint: "Is this the right audience definition?" },
    { fieldKey: "core_problems", label: "Core problems", hint: "Are these the right pain points?" },
    { fieldKey: "desired_outcomes", label: "Desired outcomes", hint: "Are these the outcomes they care about?" },
    { fieldKey: "who_to_attract_on_linkedin", label: "LinkedIn attraction goal", hint: "Is this who you want to attract on LinkedIn?" },
  ],
  linkedin_content_strategy: [
    { fieldKey: "main_content_goal", label: "Main content goal", hint: "Is this the right content goal?" },
    { fieldKey: "content_positioning", label: "Content positioning", hint: "Is this how you want to be positioned?" },
    { fieldKey: "topics_to_emphasize", label: "Topics to emphasize", hint: "Are these the right topics to focus on?" },
    { fieldKey: "topics_to_avoid", label: "Topics to avoid", hint: "Are these the topics you want to avoid?" },
  ],
  evidence_and_proof_assets: [
    { fieldKey: "narrative_proof", label: "Narrative proof", hint: "Is this the right proof narrative?" },
    { fieldKey: "metrics_proof_points", label: "Metrics", hint: "Are these proof metrics accurate?" },
    { fieldKey: "supporting_assets", label: "Supporting assets", hint: "Are these the assets we should use?" },
    { fieldKey: "missing_proof_areas", label: "Missing proof areas", hint: "Is anything missing here?" },
  ],
  generation_plan: [
    { fieldKey: "planned_first_topic", label: "First topic", hint: "Is this the best first topic?" },
    { fieldKey: "planned_format", label: "Format", hint: "Is this the right format to start with?" },
    { fieldKey: "proof_plan", label: "Proof plan", hint: "Does this proof plan work for you?" },
  ],
};

function getSectionDataForReview(
  preview: Record<string, unknown> | null,
  sectionId: ReviewSectionId,
): Record<string, unknown> | null {
  const sections = preview?.sections as Record<string, unknown> | undefined;
  if (!sections) return null;
  const sectionData = sections[sectionId];
  return sectionData && typeof sectionData === "object"
    ? (sectionData as Record<string, unknown>)
    : null;
}

function valueToDisplay(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function isSectionCompleteInPreview(
  preview: Record<string, unknown> | null,
  sectionId: ReviewSectionId,
): boolean {
  const internal = preview?.internal_preview as Record<string, unknown> | undefined;
  const slots = internal?.preview_slots as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(slots)) return false;

  const required = slots.filter(
    (slot) =>
      slot.section === sectionId &&
      slot.required_for_section_completion === true,
  );
  if (required.length === 0) return false;

  return required.every(
    (slot) => slot.status !== "missing" && slot.status !== "weak",
  );
}

function buildEditPayload(
  sectionId: ReviewSectionId,
  fieldKey: string,
  draftValue: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { [fieldKey]: draftValue };
  if (sectionId === "evidence_and_proof_assets") {
    payload.proof_points = [draftValue];
  }
  return payload;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 5 }}>
      <span
        style={{
          fontWeight: 500,
          color: "var(--color-muted)",
          fontSize: 12,
          marginRight: 4,
        }}
      >
        {label}:
      </span>
      <span style={{ color: "var(--color-text)", fontSize: 13 }}>{value}</span>
    </div>
  );
}

// ─── Section Status Icon ──────────────────────────────────────────────────────

function SectionStatusIcon({
  hasData,
  verifications,
  isActive,
  isConfirming,
}: {
  hasData: boolean;
  verifications?: VerificationIndicator[];
  isActive: boolean;
  isConfirming: boolean;
}) {
  if (isConfirming) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        style={{ flexShrink: 0 }}
      >
        <circle cx="12" cy="12" r="8" stroke="#d4a017" strokeWidth="2" />
        <circle cx="12" cy="12" r="4" fill="#d4a017" />
      </svg>
    );
  }
  if (isActive) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        style={{ flexShrink: 0 }}
      >
        <circle cx="12" cy="12" r="8" stroke="#0D7B64" strokeWidth="2" />
        <circle cx="12" cy="12" r="4" fill="#0D7B64" />
      </svg>
    );
  }
  if (hasData && verifications?.every((v) => v.state === "confirmed_by_user")) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        style={{ flexShrink: 0 }}
      >
        <circle cx="12" cy="12" r="9" fill="#0D7B64" opacity="0.12" />
        <path
          d="M7.5 12l3.5 3.5 6-7"
          stroke="#0D7B64"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (hasData) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        style={{ flexShrink: 0 }}
      >
        <circle cx="12" cy="12" r="8" stroke="#C2BFB6" strokeWidth="1.5" />
        <path d="M12 4a8 8 0 0 1 0 16z" fill="#C2BFB6" />
      </svg>
    );
  }
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="8" stroke="#E5E2DA" strokeWidth="1.5" />
    </svg>
  );
}

// ─── Verification Badge ───────────────────────────────────────────────────────

function VerificationBadge({ indicator }: { indicator: VerificationIndicator }) {
  const map: Record<string, { bg: string; text: string; dot: string; label: string }> = {
    confirmed_by_user: {
      bg: "#EAF5F2",
      text: "#0D7B64",
      dot: "#0D7B64",
      label: "Confirmed",
    },
    inferred_from_conversation: {
      bg: "#FDF3DC",
      text: "#8a6200",
      dot: "#d4a017",
      label: "Inferred",
    },
    needs_confirmation: {
      bg: "#FDECEA",
      text: "#9b2c2c",
      dot: "#e53e3e",
      label: "Needs confirmation",
    },
  };
  const s = map[indicator.state] ?? map.needs_confirmation;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        background: s.bg,
        color: s.text,
        marginRight: 4,
        marginBottom: 4,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: s.dot,
          flexShrink: 0,
        }}
      />
      {indicator.label}: {s.label}
    </span>
  );
}

// ─── Section Config ───────────────────────────────────────────────────────────

interface SectionConfig {
  key: string;
  number: number;
  title: string;
  getSummary: (data: unknown) => string;
  renderDetails: (data: unknown) => React.ReactNode;
}

const SECTION_CONFIGS: SectionConfig[] = [
  {
    key: "company_understanding",
    number: 1,
    title: "Company Understanding",
    getSummary: (d: unknown) => {
      const data = d as Record<string, string>;
      return data?.company_summary || data?.main_offering || "—";
    },
    renderDetails: (d: unknown) => {
      const data = d as Record<string, string>;
      return (
        <>
          {data.company_summary && <Row label="Summary" value={data.company_summary} />}
          {data.short_brand_story && <Row label="Brand story" value={data.short_brand_story} />}
          {data.main_offering && <Row label="Main offering" value={data.main_offering} />}
          {data.problem_solved && <Row label="Problem solved" value={data.problem_solved} />}
          {data.differentiator && <Row label="Differentiator" value={data.differentiator} />}
        </>
      );
    },
  },
  {
    key: "audience_understanding",
    number: 2,
    title: "Audience Understanding",
    getSummary: (d: unknown) => {
      const data = d as Record<string, unknown>;
      return (data?.primary_audience as string) || "—";
    },
    renderDetails: (d: unknown) => {
      const data = d as Record<string, unknown>;
      return (
        <>
          {data.primary_audience && <Row label="Primary audience" value={data.primary_audience as string} />}
          {(data.core_problems as string[])?.length > 0 && (
            <Row label="Core problems" value={(data.core_problems as string[]).join(", ")} />
          )}
          {(data.desired_outcomes as string[])?.length > 0 && (
            <Row label="Desired outcomes" value={(data.desired_outcomes as string[]).join(", ")} />
          )}
          {data.who_to_attract_on_linkedin && (
            <Row label="LinkedIn attraction" value={data.who_to_attract_on_linkedin as string} />
          )}
        </>
      );
    },
  },
  {
    key: "linkedin_content_strategy",
    number: 3,
    title: "LinkedIn Content Strategy",
    getSummary: (d: unknown) => {
      const data = d as Record<string, string>;
      return data?.main_content_goal || data?.content_positioning || "—";
    },
    renderDetails: (d: unknown) => {
      const data = d as Record<string, unknown>;
      return (
        <>
          {data.main_content_goal && <Row label="Main goal" value={data.main_content_goal as string} />}
          {data.content_positioning && <Row label="Positioning" value={data.content_positioning as string} />}
          {(data.topics_to_emphasize as string[])?.length > 0 && (
            <Row label="Topics" value={(data.topics_to_emphasize as string[]).join(", ")} />
          )}
          {(data.topics_to_avoid as string[])?.length > 0 && (
            <Row label="Avoid" value={(data.topics_to_avoid as string[]).join(", ")} />
          )}
        </>
      );
    },
  },
  {
    key: "evidence_and_proof_assets",
    number: 4,
    title: "Evidence & Proof Assets",
    getSummary: (d: unknown) => {
      const data = d as Record<string, unknown>;
      return (
        (data?.evidence_confidence_level as string) ||
        (data?.narrative_proof as string[])?.[0] ||
        "—"
      );
    },
    renderDetails: (d: unknown) => {
      const data = d as Record<string, unknown>;
      return (
        <>
          {(data.narrative_proof as string[])?.length > 0 && (
            <Row label="Narrative proof" value={(data.narrative_proof as string[]).join(", ")} />
          )}
          {(data.metrics_proof_points as string[])?.length > 0 && (
            <Row label="Metrics" value={(data.metrics_proof_points as string[]).join(", ")} />
          )}
          {(data.supporting_assets as string[])?.length > 0 && (
            <Row label="Assets" value={(data.supporting_assets as string[]).join(", ")} />
          )}
          {data.evidence_confidence_level && (
            <Row label="Confidence" value={data.evidence_confidence_level as string} />
          )}
          {(data.missing_proof_areas as string[])?.length > 0 && (
            <Row label="Missing" value={(data.missing_proof_areas as string[]).join(", ")} />
          )}
        </>
      );
    },
  },
  {
    key: "ai_suggested_content_directions",
    number: 5,
    title: "AI Suggested Directions",
    getSummary: (d: unknown) => {
      const arr = d as Array<{ topic: string }>;
      return Array.isArray(arr) && arr[0] ? arr[0].topic : "—";
    },
    renderDetails: (d: unknown) => {
      const dirs = (Array.isArray(d) ? d : []) as Array<{
        topic: string;
        format: string;
        angle: string;
        why_it_fits: string;
      }>;
      return (
        <>
          {dirs.map((dir, i) => (
            <div
              key={i}
              style={{
                marginBottom: i < dirs.length - 1 ? 10 : 0,
                paddingBottom: i < dirs.length - 1 ? 10 : 0,
                borderBottom:
                  i < dirs.length - 1 ? "1px solid var(--color-line)" : "none",
              }}
            >
              <div style={{ fontWeight: 500, fontSize: 13 }}>
                Direction {i + 1}: {dir.topic}
              </div>
              <div style={{ color: "var(--color-muted)", fontSize: 12, marginTop: 2 }}>
                Format: {dir.format} · Angle: {dir.angle}
              </div>
              {dir.why_it_fits && (
                <div
                  style={{
                    color: "var(--color-muted)",
                    fontStyle: "italic",
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  {dir.why_it_fits}
                </div>
              )}
            </div>
          ))}
        </>
      );
    },
  },
  {
    key: "generation_plan",
    number: 6,
    title: "Generation Plan",
    getSummary: (d: unknown) => {
      const data = d as Record<string, string>;
      return data?.planned_first_topic || data?.planned_format || "—";
    },
    renderDetails: (d: unknown) => {
      const data = d as Record<string, unknown>;
      return (
        <>
          {data.planned_first_topic && (
            <Row label="First topic" value={data.planned_first_topic as string} />
          )}
          {data.planned_format && <Row label="Format" value={data.planned_format as string} />}
          {(data.intended_structure as string[])?.length > 0 && (
            <Row
              label="Structure"
              value={(data.intended_structure as string[]).join(" → ")}
            />
          )}
          {data.audience_fit && <Row label="Audience fit" value={data.audience_fit as string} />}
          {data.proof_plan && <Row label="Proof plan" value={data.proof_plan as string} />}
        </>
      );
    },
  },
];

// ─── Accordion Section ────────────────────────────────────────────────────────

function AccordionSection({
  config,
  data,
  verifications,
  isActive,
  isConfirming,
  isExpanded,
  onToggle,
}: {
  config: SectionConfig;
  data: unknown;
  verifications?: VerificationIndicator[];
  isActive: boolean;
  isConfirming: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hasData = Array.isArray(data) ? data.length > 0 : !!data;
  const summary = hasData ? config.getSummary(data) : null;

  return (
    <div
      style={{
        borderRadius: "var(--radius-m)",
        background: isConfirming
          ? "#FDF3DC"
          : isActive
            ? "#EAF5F2"
            : isExpanded
              ? "#FAFAF8"
              : "transparent",
        border: isConfirming
          ? "1.5px solid #d4a017"
          : isActive
            ? "1.5px solid #0D7B64"
            : "1px solid var(--color-line)",
        marginBottom: 8,
        overflow: "hidden",
        transition: "background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
        boxShadow: isConfirming
          ? "0 0 0 1px rgba(212,160,23,0.15), 0 0 20px rgba(212,160,23,0.18)"
          : "none",
        animation: isConfirming ? "review-breathe 1.8s ease-in-out infinite" : "none",
      }}
    >
      {/* Header row — always visible */}
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 14px",
          background: "transparent",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ marginTop: 2 }}>
          <SectionStatusIcon
            hasData={hasData}
            verifications={verifications}
            isActive={isActive}
            isConfirming={isConfirming}
          />
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-text)",
              }}
            >
              {config.number}. {config.title}
            </span>
            {isConfirming && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  background: "#d4a017",
                  color: "#fff",
                  padding: "2px 7px",
                  borderRadius: 999,
                }}
              >
                confirming
              </span>
            )}
            {isActive && !isConfirming && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  background: "#0D7B64",
                  color: "white",
                  padding: "2px 7px",
                  borderRadius: 999,
                }}
              >
                discussing
              </span>
            )}
          </div>
          {!isExpanded && summary && (
            <div
              style={{
                fontSize: 12,
                color: "var(--color-muted)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {summary}
            </div>
          )}
        </div>

        {/* Chevron */}
        <span
          style={{
            flexShrink: 0,
            marginTop: 3,
            color: "var(--color-muted)",
            transition: "transform 0.2s ease",
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            display: "flex",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {/* Expanded detail area */}
      {isExpanded && (
        <div style={{ padding: "0 14px 14px 40px" }}>
          <div
            style={{
              height: 1,
              background: "var(--color-line)",
              marginBottom: 10,
            }}
          />
          {hasData ? (
            <>
              {config.renderDetails(data)}
              {verifications && verifications.length > 0 && (
                <div
                  style={{ display: "flex", flexWrap: "wrap", marginTop: 10 }}
                >
                  {verifications.map((v, i) => (
                    <VerificationBadge key={i} indicator={v} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <p
              style={{
                fontSize: 13,
                color: "var(--color-muted)",
                margin: 0,
                fontStyle: "italic",
              }}
            >
              This section will fill in as the conversation progresses.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Compact Context Window ───────────────────────────────────────────────────

function ContextWindowCompact({
  contextWindow,
  cumulativeTokens,
  turnCount,
}: {
  contextWindow: ContextWindowData | null;
  cumulativeTokens: CumulativeTokenData | null;
  turnCount: number;
}) {
  const baseStyle: React.CSSProperties = {
    padding: "10px 16px",
    borderTop: "1px solid var(--color-line)",
    background: "var(--color-code-bg)",
    borderRadius: "0 0 var(--radius-l) 0",
    flexShrink: 0,
  };

  if (!contextWindow) {
    return (
      <div
        style={{
          ...baseStyle,
          fontSize: 12,
          color: "var(--color-muted)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 8v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="currentColor" />
        </svg>
        Context usage appears after the first message.
      </div>
    );
  }

  const pct = contextWindow.utilizationPercent;
  const r = 16, sw = 3;
  const nr = r - sw / 2;
  const circ = nr * 2 * Math.PI;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const ringColor = pct < 50 ? "#0D7B64" : pct < 80 ? "#d4a017" : "#c0392b";

  const totalCost = cumulativeTokens
    ? contextWindow.estimatedCostUsd *
      (cumulativeTokens.totalTokens / Math.max(contextWindow.usedTokens, 1))
    : contextWindow.estimatedCostUsd;

  return (
    <div
      style={{
        ...baseStyle,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      {/* Mini ring */}
      <div
        style={{
          position: "relative",
          width: r * 2,
          height: r * 2,
          flexShrink: 0,
        }}
      >
        <svg height={r * 2} width={r * 2}>
          <circle
            stroke="#E5E2DA"
            fill="transparent"
            strokeWidth={sw}
            r={nr}
            cx={r}
            cy={r}
          />
          <circle
            stroke={ringColor}
            fill="transparent"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${circ} ${circ}`}
            style={{
              strokeDashoffset: offset,
              transform: "rotate(-90deg)",
              transformOrigin: "50% 50%",
              transition: "stroke-dashoffset 0.4s ease",
            }}
            r={nr}
            cx={r}
            cy={r}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 8, fontWeight: 700, color: ringColor }}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>

      {/* Stats */}
      <div
        style={{
          flex: 1,
          fontSize: 11,
          color: "var(--color-muted)",
          lineHeight: 1.6,
        }}
      >
        <span style={{ fontWeight: 500, color: "var(--color-text)" }}>
          {fmtTokens(contextWindow.usedTokens)}
        </span>
        /{fmtTokens(contextWindow.maxContextTokens)} tokens · Turn #{turnCount}
        {cumulativeTokens && (
          <>
            {" · "}
            <span style={{ fontWeight: 500, color: "var(--color-text)" }}>
              {fmtTokens(cumulativeTokens.totalTokens)}
            </span>{" "}
            tok total
          </>
        )}
      </div>

      {/* Model + cost */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 2,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            background: "var(--color-chip)",
            borderRadius: 999,
            padding: "2px 8px",
            fontSize: 10,
            color: "var(--color-muted)",
            fontWeight: 500,
          }}
        >
          {contextWindow.modelUsed}
        </span>
        <span style={{ fontSize: 10, color: "var(--color-muted)" }}>
          ${contextWindow.estimatedCostUsd.toFixed(4)} · $
          {totalCost.toFixed(4)} session
        </span>
      </div>
    </div>
  );
}

function SectionReviewPanel({
  sectionName,
  item,
  displayValue,
  step,
  total,
  isEditing,
  draftValue,
  submitting,
  onDraftChange,
  onConfirm,
  onSuggestChange,
  onSaveChange,
  onCancelEdit,
}: {
  sectionName: string;
  item: ReviewItemConfig;
  displayValue: string;
  step: number;
  total: number;
  isEditing: boolean;
  draftValue: string;
  submitting: boolean;
  onDraftChange: (value: string) => void;
  onConfirm: () => void;
  onSuggestChange: () => void;
  onSaveChange: () => void;
  onCancelEdit: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(212,160,23,0.5)",
        borderRadius: "var(--radius-m)",
        background: "#FFFCF4",
        boxShadow: "0 0 0 1px rgba(212,160,23,0.12), var(--shadow-2)",
        padding: 12,
        marginBottom: 10,
        animation: "review-step-in 220ms ease, review-breathe 1.8s ease-in-out infinite",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--color-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Section review
        </span>
        <span
          style={{
            marginLeft: "auto",
            background: "var(--color-chip)",
            borderRadius: 999,
            padding: "2px 8px",
            fontSize: 11,
            color: "var(--color-muted)",
            fontWeight: 600,
          }}
        >
          {step}/{total}
        </span>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
        {sectionName} · {item.label}
      </div>
      <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>
        {item.hint}
      </div>

      <div
        style={{
          marginTop: 10,
          borderRadius: "var(--radius-m)",
          border: "1px solid var(--color-line)",
          background: "var(--color-code-bg)",
          padding: 10,
          minHeight: 56,
          fontSize: 13,
          color: "var(--color-text)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {displayValue || "No content yet."}
      </div>

      {isEditing ? (
        <div style={{ marginTop: 10 }}>
          <textarea
            rows={3}
            value={draftValue}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={`Suggest better wording for "${item.label}"`}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              onClick={onSaveChange}
              disabled={submitting || !draftValue.trim()}
              style={{
                background: "var(--color-cta)",
                color: "#fff",
                borderRadius: 999,
                padding: "7px 14px",
                fontSize: 12,
              }}
              type="button"
            >
              {submitting ? "Saving..." : "Save change"}
            </button>
            <button
              onClick={onCancelEdit}
              disabled={submitting}
              style={{
                background: "var(--color-chip)",
                color: "var(--color-text)",
                borderRadius: 999,
                padding: "7px 14px",
                fontSize: 12,
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onConfirm}
              disabled={submitting}
              style={{
                background: "var(--color-cta)",
                color: "#fff",
                borderRadius: 999,
                padding: "7px 14px",
                fontSize: 12,
              }}
              type="button"
            >
              {submitting ? "Saving..." : "Confirm"}
            </button>
            <button
              onClick={onSuggestChange}
              disabled={submitting}
              style={{
                background: "var(--color-chip)",
                color: "var(--color-text)",
                borderRadius: 999,
                padding: "7px 14px",
                fontSize: 12,
              }}
              type="button"
            >
              Suggest change
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--color-muted)" }}>
            Suggest change saves your text directly (no AI rewrite in this step).
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export function InterviewApp() {
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Could you briefly describe what your company does?",
    },
  ]);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [completionState, setCompletionState] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [currentSectionName, setCurrentSectionName] = useState("Company Understanding");
  const [contextWindow, setContextWindow] = useState<ContextWindowData | null>(null);
  const [cumulativeTokens, setCumulativeTokens] = useState<CumulativeTokenData | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [expandedSection, setExpandedSection] = useState(0);
  const [reviewState, setReviewState] = useState<ReviewState | null>(null);
  const [reviewedSections, setReviewedSections] = useState<Record<string, boolean>>({});
  const [confirmingSectionId, setConfirmingSectionId] = useState<ReviewSectionId | null>(null);
  const [workflowState, setWorkflowState] = useState<WorkflowStatePayload | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Session ID
  useEffect(() => {
    const key = "interviewer_session_id";
    const generate = () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `session_${Date.now()}`;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        setSessionId(stored);
        return;
      }
      const id = generate();
      window.localStorage.setItem(key, id);
      setSessionId(id);
    } catch {
      setSessionId(generate());
    }
  }, []);

  // Auto-expand the section currently being discussed
  useEffect(() => {
    const visibleSectionIndexMap: Record<string, number> = {
      "Company Understanding": 0,
      "Audience Understanding": 1,
      "LinkedIn Content Strategy": 2,
      "Evidence & Proof Assets": 3,
      "Generation Plan": 5,
    };
    const sectionName = confirmingSectionId
      ? SECTION_NAME_BY_ID[confirmingSectionId]
      : currentSectionName;
    const nextIndex = visibleSectionIndexMap[sectionName];
    if (typeof nextIndex === "number") {
      setExpandedSection(nextIndex);
    }
  }, [currentSectionIndex, currentSectionName, confirmingSectionId]);

  // Auto-scroll chat to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function maybeOpenSectionReview(
    payload: Record<string, unknown>,
    updatedPreview: Record<string, unknown> | null,
    workflow?: WorkflowStatePayload | null,
  ) {
    if (workflow?.phase) {
      const pending = workflow.pending_review_section_id;
      const isReviewablePending =
        !!pending && pending in REVIEW_ITEMS;
      if (workflow.phase === "confirming_section" && isReviewablePending) {
        const sectionId = pending as ReviewSectionId;
        setConfirmingSectionId(sectionId);
        if (!reviewState || reviewState.sectionId !== sectionId) {
          setReviewState({
            sectionId,
            stepIndex: 0,
            isEditing: false,
            draftValue: "",
            submitting: false,
          });
        }
        return;
      }
      if (workflow.phase !== "confirming_section") {
        setConfirmingSectionId(null);
        if (reviewState) {
          setReviewState(null);
        }
      }
      return;
    }

    if (!updatedPreview || reviewState) return;

    const currentIndex =
      typeof payload.current_section_index === "number"
        ? payload.current_section_index
        : currentSectionIndex;

    let candidate: ReviewSectionId | null = null;
    if (payload.section_advanced === true && currentIndex > 0) {
      candidate = REVIEW_SECTION_BY_INDEX[currentIndex - 1] ?? null;
    }

    if (!candidate && currentIndex > 0) {
      for (let i = 0; i < currentIndex; i += 1) {
        const sectionId = REVIEW_SECTION_BY_INDEX[i];
        if (
          sectionId &&
          !reviewedSections[sectionId] &&
          REVIEW_ITEMS[sectionId] &&
          isSectionCompleteInPreview(updatedPreview, sectionId)
        ) {
          candidate = sectionId;
          break;
        }
      }
    }

    if (!candidate) {
      const currentId = REVIEW_SECTION_BY_INDEX[currentIndex];
      if (
        currentId &&
        !reviewedSections[currentId] &&
        REVIEW_ITEMS[currentId] &&
        isSectionCompleteInPreview(updatedPreview, currentId)
      ) {
        candidate = currentId;
      }
    }

    if (
      candidate &&
      !reviewedSections[candidate] &&
      REVIEW_ITEMS[candidate]?.length > 0 &&
      isSectionCompleteInPreview(updatedPreview, candidate)
    ) {
      setConfirmingSectionId(candidate);
      setReviewState({
        sectionId: candidate,
        stepIndex: 0,
        isEditing: false,
        draftValue: "",
        submitting: false,
      });
    }
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const userText = input.trim();
    if (!sessionId || !userText || loading) return;

    setLoading(true);
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setInput("");

    try {
      const response = await fetch("/api/interview/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, user_message: userText }),
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error((data.error as string) ?? "Request failed");

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.assistant_message as string },
      ]);
      const updatedPreview = data.updated_preview as Record<string, unknown> | null;
      const receivedWorkflow = (data.workflow_state as WorkflowStatePayload | undefined) ?? null;
      setWorkflowState(receivedWorkflow);
      setPreview(updatedPreview);
      setCompletionState(data.completion_state as Record<string, unknown>);
      if (typeof data.current_section_index === "number") {
        setCurrentSectionIndex(data.current_section_index);
      }
      if (typeof data.current_section_name === "string") {
        setCurrentSectionName(data.current_section_name);
      }
      const sectionNameByWorkflow: Record<string, string> = {
        company_understanding: "Company Understanding",
        audience_understanding: "Audience Understanding",
        linkedin_content_strategy: "LinkedIn Content Strategy",
        evidence_and_proof_assets: "Evidence & Proof Assets",
        content_preferences_and_boundaries: "Content Preferences & Boundaries",
        generation_plan: "Generation Plan",
      };
      if (receivedWorkflow?.active_section_id) {
        setCurrentSectionName(
          sectionNameByWorkflow[receivedWorkflow.active_section_id] ??
            currentSectionName,
        );
      }
      if (data.context_window) setContextWindow(data.context_window as ContextWindowData);
      if (data.cumulative_tokens) setCumulativeTokens(data.cumulative_tokens as CumulativeTokenData);
      setTurnCount((prev) => prev + 1);
      maybeOpenSectionReview(data, updatedPreview, receivedWorkflow);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const sections = preview?.sections as Record<string, unknown> | undefined;
  const score = (completionState?.completion_score as number) ?? 0;
  const level = (completionState?.completion_level as string) ?? "incomplete";
  const verCoverage = Math.round(((completionState?.verification_coverage as number) ?? 0) * 100);

  const levelBadge: Record<string, { bg: string; text: string }> = {
    incomplete: { bg: "var(--color-chip)", text: "var(--color-muted)" },
    partial: { bg: "#FDF3DC", text: "#8a6200" },
    sufficient: { bg: "#EAF5F2", text: "#0D7B64" },
    complete: { bg: "#0D7B64", text: "#fff" },
  };
  const levelStyle = levelBadge[level] ?? levelBadge.incomplete;
  const scoreColor = score > 70 ? "#0D7B64" : score > 40 ? "#d4a017" : "#C2BFB6";
  const activePreviewKey = getPreviewFocusKey(
    currentSectionName,
    confirmingSectionId,
  );
  const activeReviewItems = reviewState ? REVIEW_ITEMS[reviewState.sectionId] : [];
  const activeReviewItem = reviewState ? activeReviewItems[reviewState.stepIndex] : null;
  const activeReviewData = reviewState
    ? getSectionDataForReview(preview, reviewState.sectionId)
    : null;
  const activeReviewValue = activeReviewItem && activeReviewData
    ? valueToDisplay(activeReviewData[activeReviewItem.fieldKey])
    : "";

  async function handleConfirmReviewStep() {
    if (!reviewState || !activeReviewItem) return;
    const total = activeReviewItems.length;
    const atLastStep = reviewState.stepIndex >= total - 1;

    if (!atLastStep) {
      setReviewState((prev) =>
        prev
          ? {
              ...prev,
              stepIndex: prev.stepIndex + 1,
              isEditing: false,
              draftValue: "",
            }
          : prev,
      );
      return;
    }

    setReviewState((prev) => (prev ? { ...prev, submitting: true } : prev));
    try {
      const response = await fetch("/api/interview/preview/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          approved_sections: [reviewState.sectionId],
        }),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error((data.error as string) ?? "Approve failed");
      }

      if (data.updated_preview) {
        setPreview(data.updated_preview as Record<string, unknown>);
      }
      if (data.completion_state) {
        setCompletionState(data.completion_state as Record<string, unknown>);
      }
      if (typeof data.current_section_index === "number") {
        setCurrentSectionIndex(data.current_section_index);
      }
      if (data.workflow_state) {
        const wf = data.workflow_state as WorkflowStatePayload;
        setWorkflowState(wf);
        const sectionNameByWorkflow: Record<string, string> = {
          company_understanding: "Company Understanding",
          audience_understanding: "Audience Understanding",
          linkedin_content_strategy: "LinkedIn Content Strategy",
          evidence_and_proof_assets: "Evidence & Proof Assets",
          content_preferences_and_boundaries: "Content Preferences & Boundaries",
          generation_plan: "Generation Plan",
        };
        if (wf.active_section_id) {
          setCurrentSectionName(
            sectionNameByWorkflow[wf.active_section_id] ?? currentSectionName,
          );
        }
      }

      setReviewedSections((prev) => ({ ...prev, [reviewState.sectionId]: true }));
      setConfirmingSectionId(null);
      setReviewState(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown review error");
      setReviewState((prev) => (prev ? { ...prev, submitting: false } : prev));
    }
  }

  async function handleSaveReviewEdit() {
    if (!reviewState || !activeReviewItem) return;
    const draft = reviewState.draftValue.trim();
    if (!draft) return;

    setReviewState((prev) => (prev ? { ...prev, submitting: true } : prev));
    try {
      const response = await fetch("/api/interview/preview/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          section_id: reviewState.sectionId,
          edited_content: buildEditPayload(
            reviewState.sectionId,
            activeReviewItem.fieldKey,
            draft,
          ),
        }),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error((data.error as string) ?? "Edit failed");
      }

      if (data.updated_preview) {
        setPreview(data.updated_preview as Record<string, unknown>);
      }
      if (data.completion_state) {
        setCompletionState(data.completion_state as Record<string, unknown>);
      }
      if (typeof data.current_section_index === "number") {
        setCurrentSectionIndex(data.current_section_index);
      }
      if (data.workflow_state) {
        const wf = data.workflow_state as WorkflowStatePayload;
        setWorkflowState(wf);
      }

      const total = activeReviewItems.length;
      const atLastStep = reviewState.stepIndex >= total - 1;
      if (atLastStep) {
        setReviewedSections((prev) => ({ ...prev, [reviewState.sectionId]: true }));
        setConfirmingSectionId(null);
        setReviewState(null);
      } else {
        setReviewState((prev) =>
          prev
            ? {
                ...prev,
                stepIndex: prev.stepIndex + 1,
                isEditing: false,
                draftValue: "",
                submitting: false,
              }
            : prev,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown review edit error");
      setReviewState((prev) => (prev ? { ...prev, submitting: false } : prev));
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "20px",
        background: "var(--color-bg)",
      }}
    >
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        {/* ── Page header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
            paddingLeft: 4,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "var(--color-accent)",
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="5" fill="white" />
            </svg>
          </span>
          <span
            style={{
              fontWeight: 600,
              fontSize: 15,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
            }}
          >
            AI Content Strategist
          </span>
        </div>

        {/* ── Main slab ── */}
        <div
          className="interview-slab"
          style={{
            background: "var(--color-elev)",
            borderRadius: "var(--radius-l)",
            boxShadow: "var(--shadow-1)",
            display: "flex",
            height: "calc(100vh - 88px)",
            overflow: "hidden",
          }}
        >
          {/* ── Left: Chat panel (55%) ── */}
          <div
            className="chat-side"
            style={{
              width: "55%",
              display: "flex",
              flexDirection: "column",
              borderRight: "1px solid var(--color-line)",
            }}
          >
            {/* Chat header */}
            <div
              style={{
                padding: "18px 24px",
                borderBottom: "1px solid var(--color-line)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexShrink: 0,
              }}
            >
              <h1
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  color: "var(--color-text)",
                }}
              >
                Interview
              </h1>
              <span
                style={{
                  background: "var(--color-chip)",
                  borderRadius: 999,
                  padding: "3px 10px",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--color-muted)",
                }}
              >
                AI Content Strategist
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: "var(--color-muted)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#0D7B64",
                    display: "inline-block",
                  }}
                />
                Live
              </span>
            </div>

            {/* Messages area */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {messages.map((msg, idx) => (
                <div
                  key={`${msg.role}-${idx}`}
                  style={{
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                  }}
                >
                  {msg.role === "assistant" && (
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--color-muted)",
                        marginBottom: 4,
                        paddingLeft: 2,
                      }}
                    >
                      AI Strategist
                    </div>
                  )}
                  <div
                    style={{
                      borderRadius:
                        msg.role === "user"
                          ? "16px 16px 4px 16px"
                          : "16px 16px 16px 4px",
                      padding: "10px 14px",
                      background:
                        msg.role === "user"
                          ? "var(--color-cta)"
                          : "var(--color-chip)",
                      color:
                        msg.role === "user" ? "#fff" : "var(--color-text)",
                      fontSize: 14,
                      lineHeight: 1.65,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {loading && (
                <div
                  style={{ alignSelf: "flex-start", maxWidth: "85%" }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--color-muted)",
                      marginBottom: 4,
                      paddingLeft: 2,
                    }}
                  >
                    AI Strategist
                  </div>
                  <div
                    style={{
                      borderRadius: "16px 16px 16px 4px",
                      padding: "12px 16px",
                      background: "var(--color-chip)",
                      display: "flex",
                      gap: 5,
                      alignItems: "center",
                    }}
                  >
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--color-muted)",
                          display: "inline-block",
                          animation: `dot-bounce 1.2s ease-in-out ${i * 0.18}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div
              style={{
                padding: "14px 20px",
                borderTop: "1px solid var(--color-line)",
                background: "var(--color-code-bg)",
                borderRadius: "0 0 0 var(--radius-l)",
                flexShrink: 0,
              }}
            >
              {reviewState && activeReviewItem && (
                <SectionReviewPanel
                  sectionName={SECTION_NAME_BY_ID[reviewState.sectionId]}
                  item={activeReviewItem}
                  displayValue={activeReviewValue}
                  step={reviewState.stepIndex + 1}
                  total={activeReviewItems.length}
                  isEditing={reviewState.isEditing}
                  draftValue={reviewState.draftValue}
                  submitting={reviewState.submitting}
                  onDraftChange={(value) =>
                    setReviewState((prev) =>
                      prev ? { ...prev, draftValue: value } : prev,
                    )
                  }
                  onConfirm={handleConfirmReviewStep}
                  onSuggestChange={() =>
                    setReviewState((prev) =>
                      prev
                        ? {
                            ...prev,
                            isEditing: true,
                            draftValue: activeReviewValue,
                          }
                        : prev,
                    )
                  }
                  onSaveChange={handleSaveReviewEdit}
                  onCancelEdit={() =>
                    setReviewState((prev) =>
                      prev
                        ? {
                            ...prev,
                            isEditing: false,
                            draftValue: "",
                          }
                        : prev,
                    )
                  }
                />
              )}
              <form
                onSubmit={sendMessage}
                style={{ display: "flex", gap: 10, alignItems: "flex-end" }}
              >
                <textarea
                  rows={2}
                  placeholder="Type your answer… (Enter to send, Shift+Enter for new line)"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  style={{
                    flex: 1,
                    borderRadius: "var(--radius-m)",
                    fontSize: 14,
                  }}
                />
                <button
                  type="submit"
                  disabled={loading || !sessionId || !input.trim()}
                  style={{
                    background: "var(--color-cta)",
                    color: "#fff",
                    borderRadius: "var(--radius-pill)",
                    padding: "0 18px",
                    fontWeight: 500,
                    fontSize: 14,
                    flexShrink: 0,
                    height: 44,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  Send
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </form>
              {error && (
                <p
                  style={{
                    marginTop: 8,
                    color: "var(--warn)",
                    fontSize: 12,
                    marginBottom: 0,
                  }}
                >
                  {error}
                </p>
              )}
            </div>
          </div>

          {/* ── Right: Preview panel (45%) ── */}
          <div
            className="preview-side"
            style={{
              width: "45%",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Preview header */}
            <div
              style={{
                padding: "18px 20px 14px",
                borderBottom: "1px solid var(--color-line)",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    color: "var(--color-text)",
                  }}
                >
                  Content Strategy Preview
                </h2>
                <span
                  style={{
                    background: levelStyle.bg,
                    color: levelStyle.text,
                    borderRadius: 999,
                    padding: "2px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "capitalize",
                  }}
                >
                  {level}
                </span>
              </div>

              {/* Progress bar + stats */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    flex: 1,
                    height: 5,
                    borderRadius: 999,
                    background: "var(--color-chip)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${score}%`,
                      background: scoreColor,
                      borderRadius: 999,
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--color-text)",
                    flexShrink: 0,
                  }}
                >
                  {score}/100
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--color-muted)",
                    flexShrink: 0,
                  }}
                >
                  {verCoverage}% verified
                </span>
              </div>
              <div
                style={{
                  marginTop: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: confirmingSectionId ? "#FDF3DC" : "var(--color-chip)",
                  border: confirmingSectionId
                    ? "1px solid rgba(212,160,23,0.5)"
                    : "1px solid transparent",
                  borderRadius: 999,
                  padding: "4px 10px",
                  fontSize: 11,
                  color: confirmingSectionId ? "#8a6200" : "var(--color-muted)",
                  fontWeight: 600,
                  animation: confirmingSectionId
                    ? "review-breathe 1.8s ease-in-out infinite"
                    : "none",
                }}
              >
                {confirmingSectionId
                  ? `Confirming: ${SECTION_NAME_BY_ID[confirmingSectionId]}`
                  : `Currently discussing: ${currentSectionName}`}
              </div>
            </div>

            {/* Accordion sections */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "12px 14px",
              }}
            >
              {SECTION_CONFIGS.map((config, idx) => {
                const sectionData = sections?.[config.key];
                const visualState = getSectionVisualState(
                  config.key,
                  currentSectionName,
                  confirmingSectionId,
                );
                const verifications = Array.isArray(sectionData)
                  ? undefined
                  : (sectionData as Record<string, unknown>)
                      ?.verification as VerificationIndicator[] | undefined;

                return (
                  <AccordionSection
                    key={config.key}
                    config={config}
                    data={sectionData}
                    verifications={verifications}
                    isActive={visualState.isActive}
                    isConfirming={visualState.isConfirming}
                    isExpanded={expandedSection === idx}
                    onToggle={() =>
                      setExpandedSection(expandedSection === idx ? -1 : idx)
                    }
                  />
                );
              })}
            </div>

            {/* Compact context window strip */}
            <ContextWindowCompact
              contextWindow={contextWindow}
              cumulativeTokens={cumulativeTokens}
              turnCount={turnCount}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
