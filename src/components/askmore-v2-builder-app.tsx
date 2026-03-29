"use client";

import { useEffect, useMemo, useState } from "react";

type AskmoreV2Language = "en" | "zh";
type SelectionMode = "use_original" | "use_ai_refined" | "custom_manual";

type QuestionEvaluation = {
  is_too_broad: boolean;
  is_too_abstract: boolean;
  difficulty: "low" | "medium" | "high";
};

type QuestionCandidate = {
  entry_question: string;
  sub_questions: string[];
  example_answer_styles: string[];
  recommended_strategy: string;
};

type QuestionFinalPayload = QuestionCandidate & {
  source_mode: SelectionMode;
};

type QuestionCard = {
  question_id: string;
  original_question: string;
  analysis: {
    evaluation: QuestionEvaluation;
    reason: string;
  };
  ai_candidate: QuestionCandidate;
  selection: {
    mode: SelectionMode;
  };
  final_payload: QuestionFinalPayload;
  review_generation_meta?: {
    used_fallback: boolean;
  };
};

type FlowQuestion = {
  question_id: string;
  original_question: string;
  entry_question: string;
  sub_questions: string[];
  example_answer_styles: string[];
  recommended_strategy: string;
  source_mode: SelectionMode;
};

type ReviewGenerationMeta = {
  used_fallback: boolean;
  fallback_count: number;
};

type BuilderSelectOption = {
  value: string;
  label: string;
};

type ActiveFlowPayload = {
  flow: {
    id: string;
    version: number;
    status: "draft" | "published";
    published_at: string | null;
    flow_jsonb: {
      schema_version?: number;
      scenario: string;
      target_output_type: string;
      language: AskmoreV2Language;
      cards_snapshot: QuestionCard[];
      final_flow_questions: FlowQuestion[];
      review_generation_meta?: ReviewGenerationMeta;
    };
  } | null;
  error?: string;
};

type AuthMePayload = {
  authenticated: boolean;
  auth?: {
    user: {
      email: string;
      display_name: string | null;
      onboarding_completed_at: string | null;
    };
  };
  error?: string;
};

type OnboardingSlide = {
  step: string;
  title: string;
  body: string;
  visualTitle: string;
  visualLines: string[];
  accent: string;
  accentSoft: string;
};

function difficultyColor(difficulty: "low" | "medium" | "high") {
  if (difficulty === "high") return { bg: "#FEE2E2", text: "#991B1B" };
  if (difficulty === "medium") return { bg: "#FEF3C7", text: "#92400E" };
  return { bg: "#DCFCE7", text: "#166534" };
}

function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function deriveFinalPayload(card: QuestionCard, mode: SelectionMode): QuestionFinalPayload {
  if (mode === "use_original") {
    return {
      entry_question: card.original_question.trim() || card.ai_candidate.entry_question,
      sub_questions: [...card.ai_candidate.sub_questions],
      example_answer_styles: [...card.ai_candidate.example_answer_styles],
      recommended_strategy: card.ai_candidate.recommended_strategy || "keep_original_with_ai_support",
      source_mode: "use_original",
    };
  }
  if (mode === "use_ai_refined") {
    return {
      entry_question: card.ai_candidate.entry_question,
      sub_questions: [...card.ai_candidate.sub_questions],
      example_answer_styles: [...card.ai_candidate.example_answer_styles],
      recommended_strategy: card.ai_candidate.recommended_strategy,
      source_mode: "use_ai_refined",
    };
  }
  return {
    entry_question: card.final_payload.entry_question || card.ai_candidate.entry_question,
    sub_questions: card.final_payload.sub_questions.length > 0
      ? [...card.final_payload.sub_questions]
      : [...card.ai_candidate.sub_questions],
    example_answer_styles: card.final_payload.example_answer_styles.length > 0
      ? [...card.final_payload.example_answer_styles]
      : [...card.ai_candidate.example_answer_styles],
    recommended_strategy: card.final_payload.recommended_strategy || card.ai_candidate.recommended_strategy,
    source_mode: "custom_manual",
  };
}

function withSelection(card: QuestionCard, mode: SelectionMode): QuestionCard {
  return {
    ...card,
    selection: { mode },
    final_payload: deriveFinalPayload(card, mode),
  };
}

function sourceModeBadge(mode: SelectionMode): { label: string; bg: string; text: string } {
  if (mode === "use_ai_refined") {
    return {
      label: "AI 改写",
      bg: "#DBEAFE",
      text: "#1D4ED8",
    };
  }
  if (mode === "custom_manual") {
    return {
      label: "人工编辑",
      bg: "#DCFCE7",
      text: "#166534",
    };
  }
  return {
    label: "人工原题",
    bg: "#FEF3C7",
    text: "#92400E",
  };
}

const SELECTION_MODE_META: Record<
  SelectionMode,
  {
    title: string;
    subtitle: string;
  }
> = {
  use_original: {
    title: "用原题",
    subtitle: "保持原问题表达，同时保留 AI 子问题与示例辅助。",
  },
  use_ai_refined: {
    title: "用 AI 改写",
    subtitle: "使用 AI 优化后的入口问题和拆分路径。",
  },
  custom_manual: {
    title: "手动编辑",
    subtitle: "基于 AI 预填结果，自定义入口、子问题与风格。",
  },
};

const SCENARIO_OPTIONS: BuilderSelectOption[] = [
  { value: "咨询 intake", label: "咨询 Intake（初始信息采集）" },
  { value: "心理咨询 intake", label: "心理咨询 Intake" },
  { value: "医疗问诊 intake", label: "医疗问诊 Intake" },
  { value: "客服问题排查", label: "客服问题排查" },
  { value: "售前需求访谈", label: "售前需求访谈" },
];

const TARGET_OUTPUT_OPTIONS: BuilderSelectOption[] = [
  { value: "结构化总结报告", label: "结构化总结报告" },
  { value: "风险分层结论", label: "风险分层结论" },
  { value: "行动建议清单", label: "行动建议清单" },
  { value: "阶段性回访要点", label: "阶段性回访要点" },
];

const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    step: "01 写问题",
    title: "先写下你想问的问题",
    body: "一句话就够，先把真正要搞清楚的事情写进去。",
    visualTitle: "Builder 第一步",
    visualLines: ["输入原始问题", "一次可放多题", "问题越具体越稳"],
    accent: "#0D7B64",
    accentSoft: "#EAF5F2",
  },
  {
    step: "02 AI 审阅",
    title: "点一下 AI Review",
    body: "系统会帮你拆问题、补追问，并给出建议问法。",
    visualTitle: "Builder 第二步",
    visualLines: ["AI 拆分问题", "补足追问路径", "给出建议问法"],
    accent: "#B7791F",
    accentSoft: "#FFF7E3",
  },
  {
    step: "03 发布流程",
    title: "确认后，发布流程",
    body: "检查没问题后点击 Publish Flow。Builder 到这里就完成了。",
    visualTitle: "Builder 第三步",
    visualLines: ["检查结果", "确认采用方式", "发布正式流程"],
    accent: "#7C3AED",
    accentSoft: "#F3E8FF",
  },
  {
    step: "04 开始访谈",
    title: "去 Interview 开始访谈",
    body: "进入访谈页，点击开始访谈，系统会按流程一步步提问。",
    visualTitle: "下一步去哪里",
    visualLines: ["进入 Interview", "点击开始访谈", "按流程完成访谈"],
    accent: "#C2410C",
    accentSoft: "#FFF1E8",
  },
];

function withCompatibilityOption(options: BuilderSelectOption[], currentValue: string): BuilderSelectOption[] {
  if (!currentValue.trim()) return options;
  if (options.some((item) => item.value === currentValue)) return options;
  return [{ value: currentValue, label: `历史值：${currentValue}` }, ...options];
}

export function AskmoreV2BuilderApp() {
  const [rawQuestions, setRawQuestions] = useState<string[]>([
    "乱尿 / 标记：一周几次？只尿猫砂盆外、还是也尿床 / 衣物？应激后才发生还是常年？",
    "躲人应激 / 胆小不出门：来人就钻角落 1 小时以上吗？会不会呼吸急促、拉稀掉毛？日常能否正常吃饭？",
    "过度舔毛 / 秃小块Follow‑up：局部小块秃、还是大片对称掉毛？是否伴随皮屑红点瘙痒？持续超过 3 周吗？",
  ]);
  const [scenario, setScenario] = useState("咨询 intake");
  const [targetOutputType, setTargetOutputType] = useState("结构化总结报告");
  const [language, setLanguage] = useState<AskmoreV2Language>("zh");

  const [cards, setCards] = useState<QuestionCard[]>([]);
  const [reviewMeta, setReviewMeta] = useState<ReviewGenerationMeta | null>(null);
  const [activeFlow, setActiveFlow] = useState<ActiveFlowPayload["flow"]>(null);

  const [loadingReview, setLoadingReview] = useState(false);
  const [loadingPublish, setLoadingPublish] = useState(false);
  const [showPublishSuccess, setShowPublishSuccess] = useState(false);
  const [publishVersion, setPublishVersion] = useState<number | null>(null);
  const [interviewHintActive, setInterviewHintActive] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountDisplayName, setAccountDisplayName] = useState("");
  const [deletePanelOpen, setDeletePanelOpen] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [loadingActive, setLoadingActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const cleanedQuestions = useMemo(
    () => rawQuestions.map((q) => q.trim()).filter(Boolean),
    [rawQuestions],
  );
  const scenarioOptions = useMemo(
    () => withCompatibilityOption(SCENARIO_OPTIONS, scenario),
    [scenario],
  );
  const targetOutputOptions = useMemo(
    () => withCompatibilityOption(TARGET_OUTPUT_OPTIONS, targetOutputType),
    [targetOutputType],
  );
  const currentOnboardingSlide = ONBOARDING_SLIDES[onboardingIndex];
  const isLastOnboardingSlide = onboardingIndex === ONBOARDING_SLIDES.length - 1;

  async function loadActiveFlow() {
    setLoadingActive(true);
    setError(null);
    try {
      const response = await fetch("/api/askmore_v2/builder/active-flow");
      const payload = (await response.json()) as ActiveFlowPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load active flow");
      }
      setActiveFlow(payload.flow ?? null);

      if (payload.flow?.flow_jsonb.cards_snapshot?.length) {
        setCards(payload.flow.flow_jsonb.cards_snapshot);
        setReviewMeta(payload.flow.flow_jsonb.review_generation_meta ?? null);
        setScenario(payload.flow.flow_jsonb.scenario ?? scenario);
        setTargetOutputType(payload.flow.flow_jsonb.target_output_type ?? targetOutputType);
        setLanguage(payload.flow.flow_jsonb.language ?? "zh");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load active flow");
    } finally {
      setLoadingActive(false);
    }
  }

  async function loadAuthMe() {
    try {
      const response = await fetch("/api/auth/me");
      const payload = (await response.json()) as AuthMePayload;
      if (!response.ok || !payload.authenticated || !payload.auth) return;
      setAccountEmail(payload.auth.user.email || "");
      setAccountDisplayName(payload.auth.user.display_name || "");
      setShowOnboarding(!payload.auth.user.onboarding_completed_at);
    } catch {
      // ignore me fetch failures in builder view
    }
  }

  async function completeOnboarding() {
    setSavingOnboarding(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/onboarding", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save onboarding status");
      }
      setShowOnboarding(false);
      setOnboardingIndex(0);
      setNotice("欢迎使用 AskMore。先写问题，再 AI Review，最后发布流程。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save onboarding status");
    } finally {
      setSavingOnboarding(false);
    }
  }

  useEffect(() => {
    void loadActiveFlow();
    void loadAuthMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateQuestion(index: number, value: string) {
    setRawQuestions((prev) => prev.map((item, idx) => (idx === index ? value : item)));
  }

  function addQuestionRow() {
    setRawQuestions((prev) => [...prev, ""]);
  }

  function removeQuestionRow(index: number) {
    setRawQuestions((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, idx) => idx !== index);
    });
  }

  function moveQuestionRow(index: number, direction: "up" | "down") {
    setRawQuestions((prev) => {
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copied = [...prev];
      const current = copied[index];
      copied[index] = copied[nextIndex];
      copied[nextIndex] = current;
      return copied;
    });
  }

  function updateCardMode(questionId: string, mode: SelectionMode) {
    setCards((prev) =>
      prev.map((card) => {
        if (card.question_id !== questionId) return card;
        return withSelection(card, mode);
      }),
    );
  }

  function updateManualField(questionId: string, field: keyof QuestionFinalPayload, value: string | string[]) {
    setCards((prev) =>
      prev.map((card) => {
        if (card.question_id !== questionId) return card;
        if (card.selection.mode !== "custom_manual") return card;
        const next: QuestionCard = {
          ...card,
          final_payload: {
            ...card.final_payload,
            source_mode: "custom_manual",
            [field]: value,
          },
        };
        return next;
      }),
    );
  }

  function validateCardsBeforePublish(): string | null {
    if (cards.length === 0) return "请先执行 AI review。";
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i];
      if (!card.selection?.mode) return `第 ${i + 1} 题缺少选择模式。`;
      if (card.selection.mode === "custom_manual") {
        const entry = card.final_payload.entry_question.trim();
        const strategy = card.final_payload.recommended_strategy.trim();
        const subCount = card.final_payload.sub_questions.map((item) => item.trim()).filter(Boolean).length;
        const styleCount = card.final_payload.example_answer_styles.map((item) => item.trim()).filter(Boolean).length;
        if (!entry || !strategy || subCount === 0 || styleCount === 0) {
          return `第 ${i + 1} 题手动模式需要完整填写入口问题、子问题、示例风格和策略。`;
        }
      }
    }
    return null;
  }

  async function runReview() {
    if (cleanedQuestions.length === 0) {
      setError("请至少输入一个问题。");
      return;
    }

    setError(null);
    setNotice(null);
    setLoadingReview(true);
    try {
      const response = await fetch("/api/askmore_v2/builder/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_questions: cleanedQuestions,
          scenario,
          target_output_type: targetOutputType,
          language,
        }),
      });
      const payload = (await response.json()) as {
        cards?: QuestionCard[];
        review_generation_meta?: ReviewGenerationMeta;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(`[${response.status}] ${payload.error ?? "AI review failed"}`);
      }
      setCards(payload.cards ?? []);
      setReviewMeta(payload.review_generation_meta ?? null);
      setNotice("AI review 已生成。请逐题选择最终采用方式后发布。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI review failed");
    } finally {
      setLoadingReview(false);
    }
  }

  async function publishFlow() {
    const validationError = validateCardsBeforePublish();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setNotice(null);
    setLoadingPublish(true);
    try {
      const response = await fetch("/api/askmore_v2/builder/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards,
          raw_questions: cleanedQuestions,
          scenario,
          target_output_type: targetOutputType,
          language,
        }),
      });
      const payload = (await response.json()) as { flow_version_id?: string; version?: number; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Publish failed");
      }
      setPublishVersion(payload.version ?? null);
      setShowPublishSuccess(true);
      setInterviewHintActive(true);
      setNotice(`发布成功：v${payload.version ?? "?"}`);
      await loadActiveFlow();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setLoadingPublish(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  async function deleteAccount() {
    const text = deleteConfirmInput.trim();
    if (!text) {
      setError("请输入邮箱或账户名以确认注销。");
      return;
    }
    setError(null);
    setDeletingAccount(true);
    try {
      const response = await fetch("/api/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_input: text }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Delete account failed");
      }
      window.location.href = "/register";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete account failed");
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", padding: 20, background: "var(--color-bg)" }}>
      <div style={{ maxWidth: 1460, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "var(--color-accent-soft)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-accent)",
              fontWeight: 700,
              fontSize: 16,
            }}
          >
            🎙️
          </div>
          <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 16 }}>
            AskMore v0.3 · Question Builder
          </div>
          <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <a
              href="/askmore_v2/interview"
              className={interviewHintActive ? "v2-btn-breathing-accent" : ""}
              onClick={() => setInterviewHintActive(false)}
              style={{
                textDecoration: "none",
                borderRadius: 999,
                padding: "6px 18px",
                background: interviewHintActive ? "var(--color-accent)" : "var(--color-chip)",
                color: interviewHintActive ? "#fff" : "var(--color-text)",
                fontSize: 12,
                fontWeight: 700,
                transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                boxShadow: interviewHintActive ? "0 0 24px rgba(13, 123, 100, 0.4)" : "none",
              }}
            >
              进入 Interview
            </a>
            <button
              type="button"
              onClick={() => void logout()}
              style={{
                borderRadius: 999,
                padding: "6px 14px",
                background: "var(--color-chip)",
                color: "var(--color-text)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              退出
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 12,
              borderRadius: 12,
              padding: "10px 12px",
              background: "#FEF2F2",
              border: "1px solid #FCA5A5",
              color: "#991B1B",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            background: "var(--color-elev)",
            borderRadius: "var(--radius-l)",
            boxShadow: "var(--shadow-1)",
            border: "1px solid var(--color-line)",
            padding: 14,
            marginBottom: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--color-muted)" }}>测试账号</span>
            <strong style={{ fontSize: 12, color: "var(--color-text)" }}>
              {accountDisplayName || accountEmail || "-"}
            </strong>
            {accountEmail && (
              <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{accountEmail}</span>
            )}
            <button
              type="button"
              onClick={() => setDeletePanelOpen((prev) => !prev)}
              style={{
                marginLeft: "auto",
                borderRadius: 999,
                padding: "6px 12px",
                background: deletePanelOpen ? "#FEE2E2" : "var(--color-chip)",
                color: deletePanelOpen ? "#991B1B" : "var(--color-text)",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {deletePanelOpen ? "取消注销" : "注销账户"}
            </button>
          </div>
          {deletePanelOpen && (
            <div
              style={{
                borderRadius: 10,
                border: "1px solid #FCA5A5",
                background: "#FEF2F2",
                padding: 12,
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                alignItems: "center",
              }}
            >
              <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#7F1D1D", lineHeight: 1.6 }}>
                注销后会删除该测试账号及其工作区下的问卷/访谈/AI 思考数据。请输入“邮箱或账户名”确认。
              </div>
              <input
                type="text"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                placeholder="输入邮箱或账户名确认"
                style={{
                  border: "1px solid #FCA5A5",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontSize: 12,
                  width: "100%",
                  background: "#fff",
                }}
              />
              <button
                type="button"
                onClick={() => void deleteAccount()}
                disabled={deletingAccount}
                style={{
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  background: "#B91C1C",
                  color: "#fff",
                  opacity: deletingAccount ? 0.7 : 1,
                }}
              >
                {deletingAccount ? "注销中..." : "确认注销"}
              </button>
            </div>
          )}
        </div>

        <div
          style={{
            background: "var(--color-elev)",
            borderRadius: "var(--radius-l)",
            boxShadow: "var(--shadow-1)",
            border: "1px solid var(--color-line)",
            padding: 14,
            marginBottom: 12,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--color-muted)" }}>当前发布：</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>
            {loadingActive ? "加载中..." : activeFlow ? `v${activeFlow.version}` : "尚未发布"}
          </span>
          {activeFlow?.published_at && (
            <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
              发布于 {new Date(activeFlow.published_at).toLocaleString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadActiveFlow()}
            style={{
              marginLeft: "auto",
              background: "var(--color-chip)",
              color: "var(--color-text)",
              borderRadius: 999,
              padding: "6px 10px",
              fontSize: 11,
            }}
          >
            刷新发布版
          </button>
        </div>

        <div
          style={{
            background: "var(--color-elev)",
            borderRadius: "var(--radius-l)",
            boxShadow: "var(--shadow-1)",
            border: "1px solid var(--color-line)",
            padding: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            gap: 14,
          }}
        >
          <section
            style={{
              border: "1px solid var(--color-line)",
              borderRadius: "var(--radius-m)",
              background: "var(--color-code-bg)",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--color-text)" }}>原始问题表</div>
            <div
              style={{
                border: "1px dashed var(--color-line)",
                borderRadius: 10,
                background: "#fff",
                padding: 10,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 10,
              }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>场景描述</span>
                  <span className="v2-help-tooltip-wrap">
                    <span className="v2-help-icon" aria-hidden="true">?</span>
                    <span className="v2-help-tooltip">告诉 AI 这套问题用于什么场景，能让追问更贴合实际使用语境。</span>
                  </span>
                </div>
                <select
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  style={{
                    border: "1px solid var(--color-line)",
                    borderRadius: 10,
                    padding: "8px 10px",
                    background: "#fff",
                    fontSize: 12,
                    color: "var(--color-text)",
                  }}
                >
                  {scenarioOptions.map((option) => (
                    <option key={`scenario-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>目标输出类型</span>
                  <span className="v2-help-tooltip-wrap">
                    <span className="v2-help-icon" aria-hidden="true">?</span>
                    <span className="v2-help-tooltip">告诉 AI 最终要产出什么形式，能让提问与总结结构更一致。</span>
                  </span>
                </div>
                <select
                  value={targetOutputType}
                  onChange={(e) => setTargetOutputType(e.target.value)}
                  style={{
                    border: "1px solid var(--color-line)",
                    borderRadius: 10,
                    padding: "8px 10px",
                    background: "#fff",
                    fontSize: 12,
                    color: "var(--color-text)",
                  }}
                >
                  {targetOutputOptions.map((option) => (
                    <option key={`target-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ fontSize: 11, color: "var(--color-muted)" }}>
              先选清楚“场景”和“输出”，AI review 会更稳定，生成的子问题会更贴近你要的最终结果。
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 12, color: "var(--color-muted)" }}>语言</label>
              <select
                value={language}
                onChange={(e) => setLanguage((e.target.value as AskmoreV2Language) || "zh")}
                style={{
                  border: "1px solid var(--color-line)",
                  borderRadius: 10,
                  padding: "6px 8px",
                  background: "#fff",
                }}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 520, overflowY: "auto", paddingRight: 4 }}>
              {rawQuestions.map((question, idx) => (
                <div key={`q-row-${idx}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "var(--color-chip)",
                      color: "var(--color-muted)",
                      fontSize: 11,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 6,
                    }}
                  >
                    {idx + 1}
                  </div>
                  <textarea
                    rows={2}
                    value={question}
                    placeholder="输入原始问题"
                    onChange={(e) => updateQuestion(idx, e.target.value)}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => moveQuestionRow(idx, "up")}
                      disabled={idx === 0}
                      style={{
                        background: "#fff",
                        border: "1px solid var(--color-line)",
                        color: "var(--color-muted)",
                        borderRadius: 999,
                        padding: "5px 8px",
                        fontSize: 11,
                        lineHeight: 1,
                      }}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      onClick={() => moveQuestionRow(idx, "down")}
                      disabled={idx === rawQuestions.length - 1}
                      style={{
                        background: "#fff",
                        border: "1px solid var(--color-line)",
                        color: "var(--color-muted)",
                        borderRadius: 999,
                        padding: "5px 8px",
                        fontSize: 11,
                        lineHeight: 1,
                      }}
                    >
                      下移
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeQuestionRow(idx)}
                    style={{
                      background: "#fff",
                      border: "1px solid #FCA5A5",
                      color: "#B91C1C",
                      borderRadius: 999,
                      padding: "6px 10px",
                      fontSize: 11,
                      flexShrink: 0,
                      marginTop: 4,
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={addQuestionRow}
                style={{
                  background: "var(--color-chip)",
                  color: "var(--color-text)",
                  borderRadius: 999,
                  padding: "7px 12px",
                  fontSize: 12,
                }}
              >
                + 添加问题
              </button>
              <button
                type="button"
                onClick={runReview}
                disabled={loadingReview}
                style={{
                  background: "var(--color-accent)",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "7px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {loadingReview ? "AI Review 中..." : "AI Review"}
              </button>
            </div>
          </section>

          <section
            style={{
              border: "1px solid var(--color-line)",
              borderRadius: "var(--radius-m)",
              background: "#fff",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--color-text)" }}>分析卡与发布选择</div>
              <button
                type="button"
                onClick={publishFlow}
                disabled={loadingPublish || cards.length === 0}
                className={cards.length > 0 && !loadingPublish && !showPublishSuccess ? "v2-btn-breathing" : ""}
                style={{
                  marginLeft: "auto",
                  background: "var(--color-cta)",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "7px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  transition: "all 0.3s ease",
                }}
              >
                {loadingPublish ? "发布中..." : "Publish Flow"}
              </button>
            </div>

            {reviewMeta?.used_fallback && (
              <div
                style={{
                  border: "1px solid #FBBF24",
                  borderRadius: 10,
                  background: "#FFFBEB",
                  color: "#92400E",
                  fontSize: 12,
                  padding: "8px 10px",
                }}
              >
                本次 AI review 包含兜底结果：{reviewMeta.fallback_count} 题。建议重点复核这些卡片。
              </div>
            )}

            <div style={{ maxHeight: 640, overflowY: "auto", paddingRight: 4, display: "flex", flexDirection: "column", gap: 10 }}>
              {cards.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--color-muted)", padding: 10, border: "1px dashed var(--color-line)", borderRadius: 10 }}>
                  右侧将显示每题分析卡，并可选择最终采用方式（原题 / AI 改写 / 手动编辑）。
                </div>
              )}

              {cards.map((card, idx) => {
                const badge = difficultyColor(card.analysis.evaluation.difficulty);
                const mode = card.selection.mode;
                const sourceBadge = sourceModeBadge(card.final_payload.source_mode);
                return (
                  <div
                    key={card.question_id}
                    style={{
                      border: "1px solid var(--color-line)",
                      borderRadius: 12,
                      padding: 10,
                      background: "#fff",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <strong style={{ fontSize: 13, color: "var(--color-text)" }}>Q{idx + 1}</strong>
                      <span
                        style={{
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 10,
                          fontWeight: 700,
                          background: badge.bg,
                          color: badge.text,
                          textTransform: "uppercase",
                        }}
                      >
                        {card.analysis.evaluation.difficulty}
                      </span>
                      {card.review_generation_meta?.used_fallback && (
                        <span
                          style={{
                            borderRadius: 999,
                            padding: "2px 8px",
                            fontSize: 10,
                            fontWeight: 700,
                            background: "#FEF3C7",
                            color: "#92400E",
                          }}
                        >
                          FALLBACK
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 12, color: "var(--color-text)", marginBottom: 6 }}>
                      <strong>原问题：</strong>{card.original_question}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text)", marginBottom: 6 }}>
                      <strong>评估：</strong>
                      {card.analysis.evaluation.is_too_broad ? "过宽 " : ""}
                      {card.analysis.evaluation.is_too_abstract ? "抽象 " : ""}
                      {!card.analysis.evaluation.is_too_broad && !card.analysis.evaluation.is_too_abstract ? "可直接问" : ""}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 6 }}>
                      原因：{card.analysis.reason}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text)", marginBottom: 6 }}>
                      <strong>AI建议问法：</strong>{card.ai_candidate.entry_question}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text)", marginBottom: 6 }}>
                      <strong>AI建议追问：</strong>
                      <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                        {card.ai_candidate.sub_questions.map((sub, subIdx) => (
                          <li key={`${card.question_id}-sub-${subIdx}`}>{sub}</li>
                        ))}
                      </ul>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text)", marginBottom: 8 }}>
                      <strong>AI建议回答风格：</strong>{card.ai_candidate.example_answer_styles.join(" / ")}
                    </div>

                    <div
                      style={{
                        borderTop: "1px dashed var(--color-line)",
                        paddingTop: 8,
                        marginTop: 8,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 12, color: "var(--color-text)", fontWeight: 700 }}>最终采用方式</div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {(["use_original", "use_ai_refined", "custom_manual"] as const).map((optionMode) => {
                          const selected = mode === optionMode;
                          const meta = SELECTION_MODE_META[optionMode];
                          return (
                            <button
                              key={`${card.question_id}-${optionMode}`}
                              type="button"
                              onClick={() => updateCardMode(card.question_id, optionMode)}
                              aria-pressed={selected}
                              style={{
                                border: selected ? "1.5px solid var(--color-accent)" : "1px solid var(--color-line)",
                                borderRadius: 10,
                                background: selected ? "var(--color-accent-soft)" : "#fff",
                                textAlign: "left",
                                padding: "8px 9px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                                cursor: "pointer",
                                minHeight: 86,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <span
                                  style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: "50%",
                                    border: selected ? "1px solid var(--color-accent)" : "1px solid #CBD5E1",
                                    background: selected ? "var(--color-accent)" : "#fff",
                                    color: "#fff",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 10,
                                    fontWeight: 800,
                                    lineHeight: 1,
                                    flexShrink: 0,
                                  }}
                                >
                                  {selected ? "✓" : ""}
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{meta.title}</span>
                              </div>
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "var(--color-muted)",
                                  lineHeight: 1.45,
                                  wordBreak: "break-word",
                                }}
                              >
                                {meta.subtitle}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {mode === "custom_manual" && (
                        <div
                          style={{
                            border: "1px solid var(--color-line)",
                            borderRadius: 10,
                            background: "var(--color-code-bg)",
                            padding: 8,
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <div style={{ fontSize: 11, color: "var(--color-muted)" }}>
                            主问题（用于本题开场提问）
                          </div>
                          <input
                            value={card.final_payload.entry_question}
                            onChange={(e) => updateManualField(card.question_id, "entry_question", e.target.value)}
                            placeholder="例如：先说说你现在最核心在做的业务是什么？"
                          />
                          <div style={{ fontSize: 11, color: "var(--color-muted)" }}>
                            子问题（每行一条，按追问顺序）
                          </div>
                          <textarea
                            rows={3}
                            value={card.final_payload.sub_questions.join("\n")}
                            onChange={(e) => updateManualField(card.question_id, "sub_questions", toLines(e.target.value))}
                            placeholder="手动子问题（每行一条）"
                          />
                        </div>
                      )}

                      <div
                        style={{
                          border: "1px solid #F59E0B",
                          borderRadius: 10,
                          background: "linear-gradient(180deg, #FFFBEB 0%, #FFF7D6 100%)",
                          padding: 8,
                          boxShadow: "0 0 0 1px rgba(245, 158, 11, 0.16), 0 8px 18px rgba(245, 158, 11, 0.2)",
                          animation: "v2PreviewPulse 2.3s ease-in-out infinite",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: "#F59E0B",
                              boxShadow: "0 0 0 4px rgba(245, 158, 11, 0.18)",
                              flexShrink: 0,
                            }}
                          />
                          发布预览（最终生效）
                        </div>
                        <div style={{ fontSize: 12, color: "var(--color-text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                          <strong>来源：</strong>
                          <span
                            style={{
                              borderRadius: 999,
                              padding: "2px 8px",
                              fontSize: 10,
                              fontWeight: 700,
                              background: sourceBadge.bg,
                              color: sourceBadge.text,
                            }}
                          >
                            {sourceBadge.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--color-text)", marginBottom: 4 }}>
                          <strong>主问题：</strong>{card.final_payload.entry_question}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--color-text)" }}>
                          <strong>子问题列表：</strong>
                          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                            {card.final_payload.sub_questions.map((sub, subIdx) => (
                              <li key={`${card.question_id}-final-sub-${subIdx}`}>{sub}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {notice && (
          <div
            style={{
              marginTop: 10,
              borderRadius: 12,
              padding: "10px 12px",
              background: "#ECFDF5",
              border: "1px solid #86EFAC",
              color: "#065F46",
              fontSize: 12,
            }}
          >
            {notice}
          </div>
        )}
      </div>

      {showOnboarding && currentOnboardingSlide && (
        <div className="v2-overlay v2-onboarding-overlay">
          <div className="v2-onboarding-card">
            <div className="v2-onboarding-copy">
              <div
                className="v2-onboarding-step"
                style={{
                  color: currentOnboardingSlide.accent,
                  background: currentOnboardingSlide.accentSoft,
                }}
              >
                {currentOnboardingSlide.step}
              </div>
              <div className="v2-onboarding-title">第一次用 AskMore，就记这 4 步</div>
              <div className="v2-onboarding-headline">{currentOnboardingSlide.title}</div>
              <div className="v2-onboarding-body">{currentOnboardingSlide.body}</div>
              <div className="v2-onboarding-dots">
                {ONBOARDING_SLIDES.map((slide, idx) => (
                  <button
                    key={slide.step}
                    type="button"
                    className={`v2-onboarding-dot ${idx === onboardingIndex ? "is-active" : ""}`}
                    onClick={() => setOnboardingIndex(idx)}
                    aria-label={`查看第 ${idx + 1} 步`}
                  />
                ))}
              </div>
            </div>

            <div
              className="v2-onboarding-visual"
              style={{
                background: currentOnboardingSlide.accentSoft,
                borderColor: `${currentOnboardingSlide.accent}33`,
              }}
            >
              <div className="v2-onboarding-visual-label" style={{ color: currentOnboardingSlide.accent }}>
                {currentOnboardingSlide.visualTitle}
              </div>
              <div className="v2-onboarding-visual-stack">
                {currentOnboardingSlide.visualLines.map((line, idx) => (
                  <div key={line} className="v2-onboarding-visual-line">
                    <span
                      className="v2-onboarding-visual-index"
                      style={{
                        color: currentOnboardingSlide.accent,
                        background: "#fff",
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
              <div className="v2-onboarding-flow">
                <span>写问题</span>
                <span>AI Review</span>
                <span>Publish</span>
                <span>Interview</span>
              </div>
            </div>

            <div className="v2-onboarding-footer">
              <button
                type="button"
                className="v2-onboarding-secondary"
                onClick={() => setOnboardingIndex((current) => Math.max(current - 1, 0))}
                disabled={onboardingIndex === 0}
              >
                上一步
              </button>
              <button
                type="button"
                className="v2-onboarding-primary"
                onClick={() => {
                  if (isLastOnboardingSlide) {
                    void completeOnboarding();
                    return;
                  }
                  setOnboardingIndex((current) => Math.min(current + 1, ONBOARDING_SLIDES.length - 1));
                }}
                disabled={savingOnboarding}
              >
                {isLastOnboardingSlide ? (savingOnboarding ? "保存中..." : "开始使用") : "下一步"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loadingPublish && (
        <div className="v2-overlay">
          <div className="v2-busy-card">
            <span className="v2-busy-spinner" />
            <div className="v2-busy-title">正在发布流程...</div>
            <div className="v2-busy-hint">请稍候，我们正在将您的修改同步到正式访谈环境中。</div>
          </div>
        </div>
      )}

      {showPublishSuccess && (
        <div className="v2-overlay">
          <div className="v2-success-card">
            <div className="v2-fireworks-wrap">
              <div className="v2-firework" style={{ "--delay": "0s", "--left": "20%", "--top": "30%" } as React.CSSProperties} />
              <div className="v2-firework" style={{ "--delay": "0.4s", "--left": "80%", "--top": "20%" } as React.CSSProperties} />
              <div className="v2-firework" style={{ "--delay": "0.8s", "--left": "50%", "--top": "50%" } as React.CSSProperties} />
              <div className="v2-firework" style={{ "--delay": "1.2s", "--left": "30%", "--top": "70%" } as React.CSSProperties} />
              <div className="v2-firework" style={{ "--delay": "1.6s", "--left": "70%", "--top": "60%" } as React.CSSProperties} />
              <div className="v2-firework" style={{ "--delay": "2.0s", "--left": "15%", "--top": "45%" } as React.CSSProperties} />
            </div>
            <div className="v2-success-icon">✨</div>
            <div className="v2-success-title">发布成功！</div>
            <div className="v2-success-version">当前版本：v{publishVersion}</div>
            <div className="v2-success-hint">
              新流程已生效。点击右上角的 “进入 Interview” 按钮即可查看您的最新修改。
            </div>
            <button
              className="v2-success-btn v2-btn-breathing-accent"
              onClick={() => setShowPublishSuccess(false)}
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .v2-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(45, 43, 41, 0.45);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: v2-fade-in 0.3s ease;
        }
        @keyframes v2-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .v2-onboarding-overlay {
          z-index: 130;
          background: rgba(24, 24, 23, 0.34);
          backdrop-filter: blur(8px);
        }
        .v2-onboarding-card {
          width: min(920px, 100%);
          background: linear-gradient(180deg, #fffdfa 0%, #ffffff 100%);
          border-radius: 30px;
          border: 1px solid rgba(45, 43, 41, 0.08);
          box-shadow: 0 28px 70px rgba(45, 43, 41, 0.18);
          padding: 28px;
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
          gap: 22px;
        }
        .v2-onboarding-copy {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 14px;
        }
        .v2-onboarding-step {
          align-self: flex-start;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.04em;
        }
        .v2-onboarding-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--color-muted);
        }
        .v2-onboarding-headline {
          font-size: clamp(28px, 4vw, 40px);
          line-height: 1.08;
          font-weight: 900;
          color: #1f1d1b;
          max-width: 12ch;
        }
        .v2-onboarding-body {
          font-size: 15px;
          line-height: 1.8;
          color: #57534e;
          max-width: 30ch;
        }
        .v2-onboarding-dots {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          margin-top: 6px;
        }
        .v2-onboarding-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          border: none;
          padding: 0;
          background: rgba(120, 117, 110, 0.28);
          cursor: pointer;
          transition: transform 0.18s ease, background 0.18s ease;
        }
        .v2-onboarding-dot.is-active {
          background: var(--color-accent);
          transform: scale(1.28);
        }
        .v2-onboarding-visual {
          border-radius: 24px;
          border: 1px solid;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          justify-content: space-between;
          min-height: 360px;
        }
        .v2-onboarding-visual-label {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .v2-onboarding-visual-stack {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .v2-onboarding-visual-line {
          display: flex;
          align-items: center;
          gap: 12px;
          background: rgba(255, 255, 255, 0.82);
          border-radius: 18px;
          padding: 14px 16px;
          color: #1f1d1b;
          font-size: 14px;
          font-weight: 700;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.65);
        }
        .v2-onboarding-visual-index {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 800;
          flex-shrink: 0;
        }
        .v2-onboarding-flow {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        .v2-onboarding-flow span {
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.9);
          padding: 9px 10px;
          text-align: center;
          font-size: 11px;
          font-weight: 800;
          color: #44403c;
          box-shadow: inset 0 0 0 1px rgba(45,43,41,0.06);
        }
        .v2-onboarding-footer {
          grid-column: 1 / -1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .v2-onboarding-secondary,
        .v2-onboarding-primary {
          border-radius: 999px;
          padding: 10px 18px;
          font-size: 13px;
          font-weight: 800;
          transition: transform 0.18s ease, opacity 0.18s ease, background 0.18s ease;
        }
        .v2-onboarding-secondary {
          background: #f5f5f4;
          color: #57534e;
        }
        .v2-onboarding-primary {
          background: #1f1d1b;
          color: #fff;
          min-width: 104px;
        }
        .v2-onboarding-secondary:disabled,
        .v2-onboarding-primary:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .v2-busy-card, .v2-success-card {
          min-width: 320px;
          max-width: 420px;
          background: #fff;
          border-radius: 24px;
          padding: 32px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.15);
          text-align: center;
          position: relative;
          overflow: hidden;
        }
        .v2-busy-spinner {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 3px solid rgba(13, 123, 100, 0.1);
          border-top-color: var(--color-accent);
          animation: v2-spin 1s linear infinite;
        }
        @keyframes v2-spin {
          to { transform: rotate(360deg); }
        }
        .v2-busy-title, .v2-success-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--color-text);
        }
        .v2-busy-hint, .v2-success-hint {
          font-size: 13px;
          color: var(--color-muted);
          line-height: 1.6;
        }
        .v2-success-icon {
          font-size: 48px;
          line-height: 1;
        }
        .v2-success-version {
          font-size: 14px;
          font-weight: 700;
          color: var(--color-accent);
          background: var(--color-accent-soft);
          padding: 4px 12px;
          border-radius: 999px;
        }
        .v2-success-btn {
          margin-top: 8px;
          background: var(--color-accent);
          color: #fff;
          border-radius: 999px;
          padding: 10px 24px;
          font-weight: 700;
          font-size: 14px;
          border: none;
          cursor: pointer;
        }

        /* Elegant Golden Sparkle Fireworks */
        .v2-fireworks-wrap {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .v2-firework {
          position: absolute;
          left: var(--left, 50%);
          top: var(--top, 50%);
          width: 6px;
          height: 6px;
          border-radius: 50%;
          opacity: 0;
          box-shadow: 
            0 0 #d4a017, 0 0 #fde68a, 
            0 0 #fff, 0 0 #facc15, 
            0 0 #eab308, 0 0 #fef3c7;
          animation: v2-firework-burst 2.8s 1 ease-out forwards;
          animation-delay: var(--delay, 0s);
        }
        @keyframes v2-firework-burst {
          0% { transform: scale(0.1); opacity: 0; }
          5% { opacity: 1; }
          40% { opacity: 1; }
          100% { 
            transform: scale(45); opacity: 0; 
            box-shadow: 
              -15px -20px #d4a017, 20px -15px #fde68a, 12px 20px #fff, 
              -20px 12px #facc15, 8px -25px #eab308, -12px -22px #fef3c7,
              18px 18px #d4a017, -25px -5px #fde68a, 5px 28px #fff;
          }
        }

        /* High-Visibility Breathing Effects */
        .v2-btn-breathing {
          animation: v2-breath 2s infinite ease-in-out;
        }
        .v2-btn-breathing-accent {
          animation: v2-breath-accent 2s infinite ease-in-out;
        }
        @keyframes v2-breath {
          0%, 100% { box-shadow: 0 0 0 0 rgba(45, 43, 41, 0.4); transform: scale(1); }
          50% { box-shadow: 0 0 0 8px rgba(45, 43, 41, 0); transform: scale(1.03); }
        }
        @keyframes v2-breath-accent {
          0%, 100% { 
            box-shadow: 0 0 0 0 rgba(13, 123, 100, 0.6), 0 0 15px rgba(13, 123, 100, 0.3); 
            transform: scale(1); 
          }
          50% { 
            box-shadow: 0 0 0 15px rgba(13, 123, 100, 0), 0 0 30px rgba(13, 123, 100, 0.5); 
            transform: scale(1.06); 
          }
        }

        .v2-help-tooltip-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .v2-help-icon {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #dbeafe;
          color: #1d4ed8;
          font-size: 11px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: help;
          line-height: 1;
        }
        .v2-help-tooltip {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          min-width: 220px;
          max-width: 320px;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          color: #1e3a8a;
          font-size: 11px;
          line-height: 1.4;
          box-shadow: 0 8px 18px rgba(30, 64, 175, 0.14);
          opacity: 0;
          pointer-events: none;
          transform: translateY(-2px);
          transition: opacity 0.15s ease, transform 0.15s ease;
          z-index: 8;
        }
        .v2-help-tooltip-wrap:hover .v2-help-tooltip {
          opacity: 1;
          transform: translateY(0);
        }
        @media (max-width: 860px) {
          .v2-help-tooltip {
            left: auto;
            right: 0;
          }
          .v2-onboarding-card {
            padding: 22px;
            grid-template-columns: 1fr;
          }
          .v2-onboarding-headline,
          .v2-onboarding-body {
            max-width: none;
          }
          .v2-onboarding-visual {
            min-height: auto;
          }
          .v2-onboarding-flow {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .v2-onboarding-footer {
            flex-direction: column-reverse;
          }
          .v2-onboarding-secondary,
          .v2-onboarding-primary {
            width: 100%;
          }
        }
        @keyframes v2PreviewPulse {
          0% {
            box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.16), 0 8px 18px rgba(245, 158, 11, 0.18);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.26), 0 10px 24px rgba(245, 158, 11, 0.32);
          }
          100% {
            box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.16), 0 8px 18px rgba(245, 158, 11, 0.18);
          }
        }
      `}</style>
    </main>
  );
}
