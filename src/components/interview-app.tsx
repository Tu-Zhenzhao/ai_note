"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ReviewSectionId,
} from "@/components/interview-review-state";
import { useLanguage } from "@/lib/language-context";
import { buildPreviewFromSuperV1State, SuperV1AnswerView } from "@/lib/superv1-preview";

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
  pending_interaction_module?: "confirm_section" | "select_help_option" | "none" | null;
  transition_allowed?: boolean;
  required_open_slot_ids?: string[];
  last_transition_reason?: string | null;
};

type StructuredChoicePayload = {
  slot_id: string;
  prompt: string;
  options: Array<{ id: string; label: string; value: string }>;
  allow_other: boolean;
  other_placeholder?: string;
};

type SuperV1StatePayload = {
  conversationId: string;
  status: "active" | "completed";
  activeSectionId: string;
  currentQuestionId: string | null;
  sections: Array<{
    section_id: string;
    open_required_question_ids: string[];
  }>;
  completion: {
    ratio: number;
    total: number;
    filled: number;
    confirmed: number;
    needs_clarification: number;
  };
  answers: SuperV1AnswerView[];
};

type SuperV1TurnPayload = {
  conversationId: string;
  reply: string;
  state: SuperV1StatePayload;
  next_question: {
    question_id: string | null;
    question_text: string | null;
  };
  intent: {
    intent: "answer_question" | "ask_for_help" | "other_discussion";
    confidence: number;
    reason: string;
  };
  planner_result: {
    active_section_id: string;
    unresolved_required_question_ids: string[];
  };
};

type SuperV1ConversationEntry = {
  id: string;
  status: "active" | "completed";
  active_section_id: string;
  current_question_id: string | null;
  created_at: string;
  updated_at: string;
};

type SuperV1TurnRecord = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  message_text: string;
  created_at: string;
};

function getReviewItems(t: (key: string, params?: Record<string, string>) => string): Record<ReviewSectionId, ReviewItemConfig[]> {
  return {
    company_understanding: [
      { fieldKey: "company_summary", label: t("label_summary"), hint: t("hint_company_summary") },
      { fieldKey: "short_brand_story", label: t("label_brand_story"), hint: t("hint_brand_story") },
      { fieldKey: "main_offering", label: t("label_main_offering"), hint: t("hint_main_offering") },
      { fieldKey: "problem_solved", label: t("label_problem_solved"), hint: t("hint_problem_solved") },
      { fieldKey: "differentiator", label: t("label_differentiator"), hint: t("hint_differentiator") },
    ],
    audience_understanding: [
      { fieldKey: "primary_audience", label: t("label_primary_audience"), hint: t("hint_primary_audience") },
      { fieldKey: "core_problems", label: t("label_core_problems"), hint: t("hint_core_problems") },
      { fieldKey: "desired_outcomes", label: t("label_desired_outcomes"), hint: t("hint_desired_outcomes") },
      { fieldKey: "who_to_attract_on_linkedin", label: t("label_linkedin_attraction"), hint: t("hint_linkedin_attraction") },
    ],
    linkedin_content_strategy: [
      { fieldKey: "main_content_goal", label: t("label_main_content_goal"), hint: t("hint_main_content_goal") },
      { fieldKey: "content_positioning", label: t("label_content_positioning"), hint: t("hint_content_positioning") },
      { fieldKey: "topics_to_emphasize", label: t("label_topics_to_emphasize"), hint: t("hint_topics_to_emphasize") },
      { fieldKey: "topics_to_avoid", label: t("label_topics_to_avoid"), hint: t("hint_topics_to_avoid") },
    ],
    evidence_and_proof_assets: [
      { fieldKey: "narrative_proof", label: t("label_narrative_proof"), hint: t("hint_narrative_proof") },
      { fieldKey: "metrics_proof_points", label: t("label_metrics"), hint: t("hint_metrics") },
      { fieldKey: "supporting_assets", label: t("label_supporting_assets"), hint: t("hint_supporting_assets") },
      { fieldKey: "missing_proof_areas", label: t("label_missing_proof_areas"), hint: t("hint_missing_proof_areas") },
    ],
    generation_plan: [
      { fieldKey: "planned_first_topic", label: t("label_first_topic"), hint: t("hint_first_topic") },
      { fieldKey: "planned_format", label: t("label_planned_format"), hint: t("hint_planned_format") },
      { fieldKey: "proof_plan", label: t("label_proof_plan"), hint: t("hint_proof_plan") },
    ],
  };
}

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

function VerificationBadge({ indicator, t }: { indicator: VerificationIndicator; t: (key: string, params?: Record<string, string>) => string }) {
  const map: Record<string, { bg: string; text: string; dot: string; label: string }> = {
    confirmed_by_user: {
      bg: "#EAF5F2",
      text: "#0D7B64",
      dot: "#0D7B64",
      label: t("badge_confirmed"),
    },
    inferred_from_conversation: {
      bg: "#FDF3DC",
      text: "#8a6200",
      dot: "#d4a017",
      label: t("badge_inferred"),
    },
    needs_confirmation: {
      bg: "#FDECEA",
      text: "#9b2c2c",
      dot: "#e53e3e",
      label: t("badge_needs_confirmation"),
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

function getSectionConfigs(t: (key: string, params?: Record<string, string>) => string): SectionConfig[] {
  return [
    {
      key: "company_understanding",
      number: 1,
      title: t("section_company_understanding"),
      getSummary: (d: unknown) => {
        const data = d as Record<string, string>;
        return data?.company_summary || data?.main_offering || "—";
      },
      renderDetails: (d: unknown) => {
        const data = d as Record<string, string>;
        return (
          <>
            {data.company_summary && <Row label={t("label_summary")} value={data.company_summary} />}
            {data.short_brand_story && <Row label={t("label_brand_story")} value={data.short_brand_story} />}
            {data.main_offering && <Row label={t("label_main_offering")} value={data.main_offering} />}
            {data.problem_solved && <Row label={t("label_problem_solved")} value={data.problem_solved} />}
            {data.differentiator && <Row label={t("label_differentiator")} value={data.differentiator} />}
          </>
        );
      },
    },
    {
      key: "audience_understanding",
      number: 2,
      title: t("section_audience_understanding"),
      getSummary: (d: unknown) => {
        const data = d as Record<string, unknown>;
        return (data?.primary_audience as string) || "—";
      },
      renderDetails: (d: unknown) => {
        const data = d as Record<string, unknown>;
        return (
          <>
            {data.primary_audience && <Row label={t("label_primary_audience")} value={data.primary_audience as string} />}
            {(data.core_problems as string[])?.length > 0 && (
              <Row label={t("label_core_problems")} value={(data.core_problems as string[]).join(", ")} />
            )}
            {(data.desired_outcomes as string[])?.length > 0 && (
              <Row label={t("label_desired_outcomes")} value={(data.desired_outcomes as string[]).join(", ")} />
            )}
            {data.who_to_attract_on_linkedin && (
              <Row label={t("label_linkedin_attraction")} value={data.who_to_attract_on_linkedin as string} />
            )}
          </>
        );
      },
    },
    {
      key: "linkedin_content_strategy",
      number: 3,
      title: t("section_linkedin_content_strategy"),
      getSummary: (d: unknown) => {
        const data = d as Record<string, string>;
        return data?.main_content_goal || data?.content_positioning || "—";
      },
      renderDetails: (d: unknown) => {
        const data = d as Record<string, unknown>;
        return (
          <>
            {data.main_content_goal && <Row label={t("label_main_goal")} value={data.main_content_goal as string} />}
            {data.content_positioning && <Row label={t("label_positioning")} value={data.content_positioning as string} />}
            {(data.topics_to_emphasize as string[])?.length > 0 && (
              <Row label={t("label_topics")} value={(data.topics_to_emphasize as string[]).join(", ")} />
            )}
            {(data.topics_to_avoid as string[])?.length > 0 && (
              <Row label={t("label_avoid")} value={(data.topics_to_avoid as string[]).join(", ")} />
            )}
          </>
        );
      },
    },
    {
      key: "evidence_and_proof_assets",
      number: 4,
      title: t("section_evidence_and_proof_assets"),
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
              <Row label={t("label_narrative_proof")} value={(data.narrative_proof as string[]).join(", ")} />
            )}
            {(data.metrics_proof_points as string[])?.length > 0 && (
              <Row label={t("label_metrics")} value={(data.metrics_proof_points as string[]).join(", ")} />
            )}
            {(data.supporting_assets as string[])?.length > 0 && (
              <Row label={t("label_supporting_assets")} value={(data.supporting_assets as string[]).join(", ")} />
            )}
            {data.evidence_confidence_level && (
              <Row label={t("label_confidence")} value={data.evidence_confidence_level as string} />
            )}
            {(data.missing_proof_areas as string[])?.length > 0 && (
              <Row label={t("label_missing")} value={(data.missing_proof_areas as string[]).join(", ")} />
            )}
          </>
        );
      },
    },
    {
      key: "ai_suggested_content_directions",
      number: 5,
      title: t("section_ai_suggested_content_directions"),
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
                  {t("label_direction")} {i + 1}: {dir.topic}
                </div>
                <div style={{ color: "var(--color-muted)", fontSize: 12, marginTop: 2 }}>
                  {t("label_format")}: {dir.format} · {t("label_angle")}: {dir.angle}
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
      title: t("section_generation_plan"),
      getSummary: (d: unknown) => {
        const data = d as Record<string, string>;
        return data?.planned_first_topic || data?.planned_format || "—";
      },
      renderDetails: (d: unknown) => {
        const data = d as Record<string, unknown>;
        return (
          <>
            {data.planned_first_topic && (
              <Row label={t("label_first_topic")} value={data.planned_first_topic as string} />
            )}
            {data.planned_format && <Row label={t("label_planned_format")} value={data.planned_format as string} />}
            {(data.intended_structure as string[])?.length > 0 && (
              <Row
                label={t("label_structure")}
                value={(data.intended_structure as string[]).join(" → ")}
              />
            )}
            {data.audience_fit && <Row label={t("label_audience_fit")} value={data.audience_fit as string} />}
            {data.proof_plan && <Row label={t("label_proof_plan")} value={data.proof_plan as string} />}
          </>
        );
      },
    },
  ];
}

// ─── Accordion Section ────────────────────────────────────────────────────────

function AccordionSection({
  config,
  data,
  verifications,
  isActive,
  isConfirming,
  isExpanded,
  onToggle,
  t,
}: {
  config: SectionConfig;
  data: unknown;
  verifications?: VerificationIndicator[];
  isActive: boolean;
  isConfirming: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  t: (key: string, params?: Record<string, string>) => string;
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
                {t("status_confirming")}
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
                {t("status_discussing")}
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
                    <VerificationBadge key={i} indicator={v} t={t} />
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
              {t("section_empty")}
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
  t,
}: {
  contextWindow: ContextWindowData | null;
  cumulativeTokens: CumulativeTokenData | null;
  turnCount: number;
  t: (key: string, params?: Record<string, string>) => string;
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
        {t("ctx_pending")}
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
        /{fmtTokens(contextWindow.maxContextTokens)} {t("ctx_tokens")} · {t("ctx_turn")} #{turnCount}
        {cumulativeTokens && (
          <>
            {" · "}
            <span style={{ fontWeight: 500, color: "var(--color-text)" }}>
              {fmtTokens(cumulativeTokens.totalTokens)}
            </span>{" "}
            {t("ctx_total")}
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
          {totalCost.toFixed(4)} {t("ctx_session")}
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
  t,
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
  t: (key: string, params?: Record<string, string>) => string;
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
          {t("review_title")}
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
        {displayValue || t("review_no_content")}
      </div>

      {isEditing ? (
        <div style={{ marginTop: 10 }}>
          <textarea
            rows={3}
            value={draftValue}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={t("edit_placeholder", { label: item.label })}
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
              {submitting ? t("review_saving") : t("btn_save_change")}
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
              {t("btn_cancel")}
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
              {submitting ? t("review_saving") : t("btn_confirm")}
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
              {t("btn_suggest_change")}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--color-muted)" }}>
            {t("review_suggest_hint")}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export function InterviewApp() {
  const { lang, setLang, t, getSectionName } = useLanguage();
  const REVIEW_ITEMS = getReviewItems(t);
  const SECTION_CONFIGS = getSectionConfigs(t);

  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [completionState, setCompletionState] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [currentSectionName, setCurrentSectionName] = useState("");
  const [activeSectionId, setActiveSectionId] = useState("company_understanding");
  const [contextWindow, setContextWindow] = useState<ContextWindowData | null>(null);
  const [cumulativeTokens, setCumulativeTokens] = useState<CumulativeTokenData | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [expandedSection, setExpandedSection] = useState(0);
  const [reviewState, setReviewState] = useState<ReviewState | null>(null);
  const [reviewedSections, setReviewedSections] = useState<Record<string, boolean>>({});
  const [confirmingSectionId, setConfirmingSectionId] = useState<ReviewSectionId | null>(null);
  const [workflowState, setWorkflowState] = useState<WorkflowStatePayload | null>(null);
  const [structuredChoice, setStructuredChoice] = useState<StructuredChoicePayload | null>(null);
  const [structuredOtherDraft, setStructuredOtherDraft] = useState("");
  const [taskType, setTaskType] = useState<string | null>(null);
  const [superV1ConversationId, setSuperV1ConversationId] = useState<string | null>(null);
  const [conversationList, setConversationList] = useState<SuperV1ConversationEntry[]>([]);
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Set initial greeting based on language
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ role: "assistant", content: t("initial_greeting") }]);
    }
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set initial section name based on language
  useEffect(() => {
    if (!currentSectionName) {
      setCurrentSectionName(t("section_company_understanding"));
    }
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createSuperV1Conversation(): Promise<string> {
    const response = await fetch("/api/conversations/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error((data.error as string) ?? "Failed to create conversation");
    }
    const id = String(data.conversationId ?? "");
    if (!id) throw new Error("Missing conversation ID");
    return id;
  }

  function applySuperV1State(state: SuperV1StatePayload, reason?: string) {
    setActiveSectionId(state.activeSectionId);
    setCurrentSectionName(getSectionName(state.activeSectionId));
    const nextIndex = state.sections.findIndex(
      (section) => section.section_id === state.activeSectionId,
    );
    if (nextIndex >= 0) {
      setCurrentSectionIndex(nextIndex);
    }
    setWorkflowState({
      phase: "interviewing",
      active_section_id: state.activeSectionId,
      required_open_slot_ids:
        state.sections.find((section) => section.section_id === state.activeSectionId)
          ?.open_required_question_ids ?? [],
      transition_allowed: false,
      last_transition_reason: reason ?? null,
      pending_interaction_module: "none",
      pending_review_section_id: null,
    });
    setCompletionState({
      completion_level: state.status,
      completion_score: Math.round(state.completion.ratio * 100),
    });
    setPreview(buildPreviewFromSuperV1State(state));
  }

  async function loadSuperV1Conversation(conversationId: string) {
    const [stateResponse, turnsResponse] = await Promise.all([
      fetch(`/api/conversations/${conversationId}/state`),
      fetch(`/api/conversations/${conversationId}/turns`),
    ]);
    const statePayload = (await stateResponse.json()) as { state?: SuperV1StatePayload; error?: string };
    const turnsPayload = (await turnsResponse.json()) as { turns?: SuperV1TurnRecord[]; error?: string };

    if (!stateResponse.ok) {
      throw new Error(statePayload.error ?? "Failed to load conversation state");
    }
    if (!turnsResponse.ok) {
      throw new Error(turnsPayload.error ?? "Failed to load conversation turns");
    }

    const turns = turnsPayload.turns ?? [];
    const mappedMessages: ChatMessage[] = turns
      .filter((turn) => turn.role === "user" || turn.role === "assistant" || turn.role === "system")
      .map((turn) => ({
        role: turn.role === "user" ? "user" : "assistant",
        content: turn.message_text,
      }));

    setMessages(mappedMessages.length > 0 ? mappedMessages : [{ role: "assistant", content: t("initial_greeting") }]);
    setStructuredChoice(null);
    setStructuredOtherDraft("");
    setTaskType(null);
    setContextWindow(null);
    setCumulativeTokens(null);
    setTurnCount(turns.length);
    applySuperV1State(statePayload.state as SuperV1StatePayload);
  }

  async function fetchConversationList() {
    setSessionLoading(true);
    try {
      const response = await fetch("/api/conversations");
      const payload = (await response.json()) as {
        conversations?: SuperV1ConversationEntry[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load sessions");
      }
      setConversationList(payload.conversations ?? []);
    } catch {
      setConversationList([]);
    } finally {
      setSessionLoading(false);
    }
  }

  // Session / conversation ID
  useEffect(() => {
    const key = "superv1_conversation_id";
    const init = async () => {
      try {
        const stored = window.localStorage.getItem(key);
        if (stored) {
          setSessionId(stored);
          setSuperV1ConversationId(stored);
          try {
            await loadSuperV1Conversation(stored);
            return;
          } catch {
            try {
              window.localStorage.removeItem(key);
            } catch {
              // ignore localStorage errors
            }
          }
        }
      } catch {
        // ignore localStorage errors
      }
      try {
        const newId = await createSuperV1Conversation();
        try {
          window.localStorage.setItem(key, newId);
        } catch {
          // ignore localStorage errors
        }
        setSessionId(newId);
        setSuperV1ConversationId(newId);
        await fetchConversationList();
      } catch {
        setError("Failed to initialize SuperV1 conversation");
        return;
      }
    };

    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-expand the section currently being discussed
  useEffect(() => {
    const sectionIdIndexMap: Record<string, number> = {
      company_understanding: 0,
      audience_understanding: 1,
      linkedin_content_strategy: 2,
      evidence_and_proof_assets: 3,
      generation_plan: 5,
    };
    const targetId = confirmingSectionId ?? activeSectionId;
    const nextIndex = sectionIdIndexMap[targetId];
    if (typeof nextIndex === "number") {
      setExpandedSection(nextIndex);
    }
  }, [currentSectionIndex, activeSectionId, confirmingSectionId]);

  // Auto-scroll chat to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(event?: FormEvent, overrideInput?: string) {
    event?.preventDefault();
    const userText = (overrideInput ?? input).trim();
    if (!sessionId || !userText || loading) return;

    setLoading(true);
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setInput("");

    try {
      let conversationId = superV1ConversationId;
      if (!conversationId) {
        conversationId = await createSuperV1Conversation();
        setSuperV1ConversationId(conversationId);
        setSessionId(conversationId);
        try {
          window.localStorage.setItem("superv1_conversation_id", conversationId);
        } catch {
          // ignore localStorage errors
        }
      }
      const response = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          userMessage: userText,
          language: lang,
        }),
      });
      const data = (await response.json()) as SuperV1TurnPayload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Request failed");

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setStructuredChoice(null);
      setStructuredOtherDraft("");
      setTaskType(data.intent.intent);
      applySuperV1State(data.state, data.intent.reason);
      setTurnCount((prev) => prev + 1);
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

  async function handleNewSession() {
    let newConversationId: string | null = null;
    try {
      const newId = await createSuperV1Conversation();
      newConversationId = newId;
      try {
        window.localStorage.setItem("superv1_conversation_id", newId);
      } catch {
        // ignore localStorage errors
      }
      setSessionId(newId);
      setSuperV1ConversationId(newId);
    } catch {
      setError("Failed to start a new SuperV1 conversation");
    }

    setMessages([
      { role: "assistant", content: t("initial_greeting") },
    ]);
    setPreview(null);
    setCompletionState(null);
    setCurrentSectionIndex(0);
    setActiveSectionId("company_understanding");
    setCurrentSectionName(t("section_company_understanding"));
    setContextWindow(null);
    setCumulativeTokens(null);
    setTurnCount(0);
    setExpandedSection(0);
    setReviewState(null);
    setReviewedSections({});
    setConfirmingSectionId(null);
    setWorkflowState(null);
    setStructuredChoice(null);
    setStructuredOtherDraft("");
    setTaskType(null);
    setError(null);
    if (showSessionPanel) {
      await fetchConversationList();
    }
    if (newConversationId) {
      setSessionId(newConversationId);
      setSuperV1ConversationId(newConversationId);
    }
  }

  async function handleSwitchSession(targetId: string) {
    try {
      setLoading(true);
      setError(null);
      try {
        window.localStorage.setItem("superv1_conversation_id", targetId);
      } catch {
        // ignore localStorage errors
      }
      setSessionId(targetId);
      setSuperV1ConversationId(targetId);
      await loadSuperV1Conversation(targetId);
      setShowSessionPanel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch session");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteSession(targetId: string) {
    if (!confirm(t("delete_confirm", { id: targetId.slice(0, 8) }))) return;
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/conversations/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: targetId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete session");
      }

      if (targetId === sessionId) {
        await handleNewSession();
      } else {
        await fetchConversationList();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete session");
    } finally {
      setLoading(false);
    }
  }

  const sections = preview?.sections as Record<string, unknown> | undefined;
  const workflowBlockers = (() => {
    const internal = preview?.internal_preview as Record<string, unknown> | undefined;
    const slots = internal?.preview_slots as Array<Record<string, unknown>> | undefined;
    const openSlotIds = workflowState?.required_open_slot_ids ?? [];
    if (!Array.isArray(slots) || openSlotIds.length === 0) return [];
    return openSlotIds
      .map((slotId) => {
        const slot = slots.find((candidate) => candidate.id === slotId);
        return (
          (slot?.question_label as string | undefined) ??
          (slot?.label as string | undefined) ??
          slotId
        );
      })
      .filter(Boolean);
  })();
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
  const activePreviewKey = confirmingSectionId || activeSectionId;
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
        if (wf.active_section_id) {
          setActiveSectionId(wf.active_section_id);
          setCurrentSectionName(
            getSectionName(wf.active_section_id),
          );
        }
      }
      setStructuredChoice(null);
      setStructuredOtherDraft("");

      setReviewedSections((prev) => ({ ...prev, [reviewState.sectionId]: true }));
      setConfirmingSectionId(null);
      setReviewState(null);

      const sectionLabel = getSectionName(reviewState.sectionId);
      const autoReply = t("review_auto_reply", { section: sectionLabel });
      sendMessage(undefined, autoReply);
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
      setStructuredChoice(null);
      setStructuredOtherDraft("");

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
            {t("app_title")}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              onClick={() => setLang(lang === "en" ? "zh" : "en")}
              style={{
                background: "var(--color-chip)",
                color: "var(--color-text)",
                borderRadius: 999,
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 600,
                minWidth: 48,
              }}
              type="button"
            >
              {t("lang_toggle")}
            </button>
            <button
              onClick={() => {
                const next = !showSessionPanel;
                setShowSessionPanel(next);
                if (next) {
                  fetchConversationList();
                }
              }}
              style={{
                background: "var(--color-chip)",
                color: "var(--color-text)",
                borderRadius: 999,
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 500,
              }}
              type="button"
            >
              {t("btn_sessions")}
            </button>
            <button
              onClick={handleNewSession}
              style={{
                background: "var(--color-accent)",
                color: "#fff",
                borderRadius: 999,
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 500,
              }}
              type="button"
            >
              {t("btn_new_session")}
            </button>
          </div>
        </div>

        {showSessionPanel && (
          <div
            style={{
              background: "var(--color-elev)",
              borderRadius: "var(--radius-m)",
              boxShadow: "var(--shadow-2)",
              padding: 16,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--color-text)" }}>
                {t("sessions_title")}
              </span>
              <button
                onClick={() => setShowSessionPanel(false)}
                style={{
                  background: "transparent",
                  color: "var(--color-muted)",
                  fontSize: 18,
                  padding: "0 4px",
                  lineHeight: 1,
                }}
                type="button"
              >
                &times;
              </button>
            </div>
            {sessionLoading ? (
              <div style={{ fontSize: 12, color: "var(--color-muted)", padding: "8px 0" }}>{t("sessions_loading")}</div>
            ) : conversationList.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--color-muted)", padding: "8px 0" }}>
                {t("sessions_empty")}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {conversationList.map((entry) => {
                  const isCurrent = entry.id === sessionId;
                  const dateStr = new Date(entry.updated_at || entry.created_at).toLocaleString();
                  return (
                    <div
                      key={entry.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 12px",
                        borderRadius: "var(--radius-s)",
                        background: isCurrent ? "var(--color-accent-soft)" : "var(--color-chip)",
                        border: isCurrent ? "1px solid var(--color-accent)" : "1px solid transparent",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>
                          {entry.id.slice(0, 8)}...
                          {isCurrent && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                fontWeight: 500,
                                background: "var(--color-accent)",
                                color: "#fff",
                                borderRadius: 999,
                                padding: "1px 6px",
                              }}
                            >
                              {t("session_active")}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>
                          {dateStr} &middot; {entry.status} &middot; {getSectionName(entry.active_section_id)}
                        </div>
                      </div>
                      {!isCurrent && (
                        <button
                          onClick={() => handleSwitchSession(entry.id)}
                          style={{
                            background: "var(--color-elev)",
                            color: "var(--color-text)",
                            borderRadius: 999,
                            padding: "3px 10px",
                            fontSize: 11,
                            fontWeight: 500,
                            border: "1px solid var(--color-line)",
                          }}
                          type="button"
                        >
                          {t("btn_switch")}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteSession(entry.id)}
                        style={{
                          background: "transparent",
                          color: "#c53030",
                          borderRadius: 999,
                          padding: "3px 10px",
                          fontSize: 11,
                          fontWeight: 500,
                          border: "1px solid #fed7d7",
                        }}
                        type="button"
                      >
                        {t("btn_delete")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

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
                {t("chat_title")}
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
                {t("chat_subtitle")}
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
                {t("chat_live")}
              </span>
            </div>

            {/* Section status header */}
            <div
              style={{
                padding: "8px 24px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderBottom: "1px solid var(--color-border, #eee)",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: confirmingSectionId
                    ? "#D4A017"
                    : "#0D7B64",
                  display: "inline-block",
                  animation: confirmingSectionId
                    ? "review-breathe 1.8s ease-in-out infinite"
                    : "none",
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: confirmingSectionId
                    ? "#8a6200"
                    : "var(--color-text)",
                }}
              >
                {confirmingSectionId
                  ? t("status_reviewing", { section: getSectionName(confirmingSectionId) })
                  : currentSectionName}
              </span>
              {taskType && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    fontWeight: 500,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background:
                      taskType === "answer_question"
                        ? "#EAF5F2"
                        : taskType === "ask_for_help"
                          ? "#EDE9FE"
                          : "#F0F4FF",
                    color:
                      taskType === "answer_question"
                        ? "#0D7B64"
                        : taskType === "ask_for_help"
                          ? "#6D28D9"
                          : "#3B6FCF",
                  }}
                >
                  {taskType === "answer_question"
                    ? t("task_answering")
                    : taskType === "ask_for_help"
                      ? t("task_helping")
                      : t("task_exploring")}
                </span>
              )}
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
                      {t("chat_sender")}
                    </div>
                  )}
                  <div
                    className={msg.role === "assistant" ? "chat-markdown" : ""}
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
                    }}
                  >
                    {msg.role === "assistant" ? (
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    ) : (
                      <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                    )}
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
                    {t("chat_sender")}
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
                  sectionName={getSectionName(reviewState.sectionId)}
                  t={t}
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
              {!reviewState && structuredChoice && (
                <div
                  style={{
                    border: "1px solid rgba(212,160,23,0.45)",
                    borderRadius: "var(--radius-m)",
                    background: "#FFFCF4",
                    boxShadow: "var(--shadow-2)",
                    padding: 12,
                    marginBottom: 10,
                    animation: "review-step-in 220ms ease",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#8a6200", marginBottom: 8 }}>
                    {t("structured_title")}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--color-text)", marginBottom: 10 }}>
                    {structuredChoice.prompt}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                    {structuredChoice.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => sendMessage(undefined, option.value)}
                        disabled={loading}
                        style={{
                          background: "var(--color-chip)",
                          color: "var(--color-text)",
                          borderRadius: 999,
                          padding: "7px 12px",
                          fontSize: 12,
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {structuredChoice.allow_other && (
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <textarea
                        rows={2}
                        value={structuredOtherDraft}
                        onChange={(e) => setStructuredOtherDraft(e.target.value)}
                        placeholder={structuredChoice.other_placeholder || "Other..."}
                      />
                      <button
                        type="button"
                        onClick={() => sendMessage(undefined, structuredOtherDraft)}
                        disabled={loading || !structuredOtherDraft.trim()}
                        style={{
                          background: "var(--color-cta)",
                          color: "#fff",
                          borderRadius: 999,
                          padding: "7px 12px",
                          fontSize: 12,
                          height: 40,
                        }}
                      >
                        {t("btn_submit")}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <form
                onSubmit={sendMessage}
                style={{ display: "flex", gap: 10, alignItems: "flex-end" }}
              >
                <textarea
                  rows={2}
                  placeholder={t("input_placeholder")}
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
                  {t("btn_send")}
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
                  {t("preview_title")}
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
                  {verCoverage}% {t("preview_verified")}
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
                  ? t("status_confirming_section", { section: getSectionName(confirmingSectionId) })
                  : t("status_discussing_section", { section: currentSectionName })}
              </div>
              {!confirmingSectionId && workflowBlockers.length > 0 && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    color: "#8a6200",
                  }}
                >
                  {t("status_waiting", { items: workflowBlockers.slice(0, 2).join(" · ") })}
                </div>
              )}
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
                const isStructuredHelp = workflowState?.phase === "structured_help_selection";
                const visualState = {
                  isConfirming: confirmingSectionId === config.key,
                  isActive: !confirmingSectionId && !isStructuredHelp && activeSectionId === config.key,
                };
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
                    t={t}
                  />
                );
              })}
            </div>

            {/* Compact context window strip */}
            <ContextWindowCompact
              contextWindow={contextWindow}
              cumulativeTokens={cumulativeTokens}
              turnCount={turnCount}
              t={t}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
