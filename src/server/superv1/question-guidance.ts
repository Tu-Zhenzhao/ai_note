type SupportedLanguage = "en" | "zh";

export interface SuperV1QuestionGuidance {
  question_id: string;
  help_focus_en: string;
  help_focus_zh: string;
  canonical_options_en: string[];
  canonical_options_zh: string[];
  answer_examples_en: string[];
  answer_examples_zh: string[];
  answer_signal_tokens: string[];
}

export interface SuperV1LocalizedQuestionGuidance {
  question_id: string;
  help_focus: string;
  canonical_options: string[];
  answer_examples: string[];
}

const QUESTION_GUIDANCE_BY_ID: Record<string, SuperV1QuestionGuidance> = {
  cp_category: {
    question_id: "cp_category",
    help_focus_en:
      "Identify the closest product/service category so later strategy and messaging are positioned correctly.",
    help_focus_zh: "确定最贴近的产品/服务类别，便于后续定位和策略建议更准确。",
    canonical_options_en: [
      "Enterprise knowledge management tool",
      "AI search and indexing infrastructure",
      "Document automation platform",
      "Developer API service tool",
      "SaaS software service",
      "Other",
    ],
    canonical_options_zh: [
      "企业知识管理工具",
      "AI 搜索与索引基础设施",
      "文档自动化处理平台",
      "开发者 API 服务工具",
      "SaaS 软件服务",
      "其他类型",
    ],
    answer_examples_en: [
      "We are mainly a developer API service tool for enterprise engineering teams.",
      "It is closer to AI search and indexing infrastructure for enterprise document retrieval.",
      "We fit SaaS software services and target enterprise users.",
    ],
    answer_examples_zh: [
      "我们更偏开发者 API 服务工具，主要服务企业技术团队。",
      "更接近 AI 搜索与索引基础设施，面向企业文档检索场景。",
      "属于 SaaS 软件服务，目标用户是企业客户。",
    ],
    answer_signal_tokens: [
      "api",
      "api服务",
      "saas",
      "软件服务",
      "开发者",
      "企业",
      "企业用户",
      "b2b",
      "to b",
      "知识管理",
      "ai 搜索",
      "索引",
      "文档自动化",
      "类别",
      "属于",
      "针对",
      "面向",
    ],
  },
  ma_primary_audience: {
    question_id: "ma_primary_audience",
    help_focus_en:
      "Identify the primary user/customer segment most likely to use or pay for this product.",
    help_focus_zh: "明确最核心的目标用户/客户群体，即最可能直接使用或付费的人群。",
    canonical_options_en: [
      "Enterprise knowledge-management teams (IT/operations/knowledge base owners)",
      "AI application development teams needing retrieval/RAG capabilities",
      "Document-intensive professional organizations (legal/research/consulting)",
      "SaaS product teams building intelligent office or support workflows",
      "Other enterprise user segment",
    ],
    canonical_options_zh: [
      "企业知识管理团队（IT/运营/知识库负责人）",
      "需要检索或 RAG 能力的 AI 应用开发团队",
      "文档密集型专业机构（法务/科研/咨询）",
      "构建智能办公或客服流程的 SaaS 产品团队",
      "其他企业用户群体",
    ],
    answer_examples_en: [
      "Our main users are enterprise IT and knowledge-base operations teams.",
      "We primarily target AI product teams that need reliable document retrieval APIs.",
      "Most paying customers are legal and consulting firms handling large document sets.",
    ],
    answer_examples_zh: [
      "我们的核心用户是企业 IT 与知识库运营团队。",
      "我们主要面向需要文档检索 API 的 AI 产品开发团队。",
      "我们的付费客户主要是法务与咨询类文档密集机构。",
    ],
    answer_signal_tokens: [
      "用户群体",
      "目标用户",
      "核心用户",
      "主要用户",
      "企业用户",
      "客户群体",
      "付费客户",
      "企业客户",
      "it 团队",
      "知识库",
      "开发团队",
      "开发者",
      "法务",
      "科研",
      "咨询",
      "saas",
      "b2b",
      "to b",
      "面向",
      "针对",
    ],
  },
};

export function getQuestionGuidance(questionId: string | null): SuperV1QuestionGuidance | null {
  if (!questionId) return null;
  return QUESTION_GUIDANCE_BY_ID[questionId] ?? null;
}

export function getLocalizedQuestionGuidance(
  questionId: string | null,
  language: SupportedLanguage,
): SuperV1LocalizedQuestionGuidance | null {
  const guidance = getQuestionGuidance(questionId);
  if (!guidance) return null;
  if (language === "zh") {
    return {
      question_id: guidance.question_id,
      help_focus: guidance.help_focus_zh,
      canonical_options: guidance.canonical_options_zh,
      answer_examples: guidance.answer_examples_zh,
    };
  }
  return {
    question_id: guidance.question_id,
    help_focus: guidance.help_focus_en,
    canonical_options: guidance.canonical_options_en,
    answer_examples: guidance.answer_examples_en,
  };
}

export function detectQuestionAlignedAnswer(params: {
  questionId: string | null;
  message: string;
}): boolean {
  const guidance = getQuestionGuidance(params.questionId);
  if (!guidance) return false;
  const normalized = params.message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/[?？]$/.test(normalized)) return false;
  if (
    /(不明白|不懂|没太懂|解释|什么意思|什么叫|can you explain|help me|don't understand|如何分类|怎么分类|怎么分|有哪些)/i.test(
      normalized,
    )
  ) {
    return false;
  }
  return guidance.answer_signal_tokens.some((token) => normalized.includes(token));
}
