export type Language = "en" | "zh";

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Page header
    app_title: "AI Content Strategist",

    // Chat panel
    chat_title: "Interview",
    chat_subtitle: "AI Content Strategist",
    chat_live: "Live",
    chat_sender: "AI Strategist",

    // Task badges
    task_answering: "Answering",
    task_helping: "Helping",
    task_exploring: "Exploring",

    // Session management
    btn_sessions: "Sessions",
    btn_new_session: "+ New Session",
    sessions_title: "All Sessions",
    sessions_loading: "Loading...",
    sessions_empty: 'No sessions found. Click "+ New Session" to start one.',
    session_active: "active",
    btn_switch: "Switch",
    btn_delete: "Delete",
    delete_confirm: "Delete session {id}…? This cannot be undone.",
    session_resume: "Resuming your session...",

    // Send
    btn_send: "Send",
    input_placeholder: "Type your answer… (Enter to send, Shift+Enter for new line)",

    // Section names
    section_company_understanding: "Company Understanding",
    section_audience_understanding: "Audience Understanding",
    section_linkedin_content_strategy: "LinkedIn Content Strategy",
    section_evidence_and_proof_assets: "Evidence & Proof Assets",
    section_ai_suggested_content_directions: "AI Suggested Directions",
    section_generation_plan: "Generation Plan",
    section_content_preferences_and_boundaries: "Content Preferences & Boundaries",

    // Section status
    status_confirming: "confirming",
    status_discussing: "discussing",
    status_reviewing: "Reviewing: {section}",
    status_confirming_section: "Confirming: {section}",
    status_discussing_section: "Currently discussing: {section}",
    status_waiting: "Still waiting on: {items}",
    section_empty: "This section will fill in as the conversation progresses.",

    // Verification badges
    badge_confirmed: "Confirmed",
    badge_inferred: "Inferred",
    badge_needs_confirmation: "Needs confirmation",

    // Preview panel
    preview_title: "Content Strategy Preview",
    preview_verified: "verified",

    // Review panel
    review_title: "Section review",
    btn_confirm: "Confirm",
    btn_suggest_change: "Suggest change",
    btn_save_change: "Save change",
    btn_cancel: "Cancel",
    review_saving: "Saving...",
    review_no_content: "No content yet.",
    review_suggest_hint: "Suggest change saves your text directly (no AI rewrite in this step).",
    review_auto_reply: "Looks good — I'm happy with {section}. Let's continue.",

    // Structured choice
    structured_title: "Quick selection",
    btn_submit: "Submit",

    // Context window
    ctx_pending: "Context usage appears after the first message.",
    ctx_tokens: "tokens",
    ctx_total: "tok total",
    ctx_session: "session",
    ctx_turn: "Turn",

    // Initial greeting
    initial_greeting: "Could you briefly describe what your company does?",

    // Row labels (Company Understanding)
    label_summary: "Summary",
    label_brand_story: "Brand story",
    label_main_offering: "Main offering",
    label_problem_solved: "Problem solved",
    label_differentiator: "Differentiator",

    // Row labels (Audience Understanding)
    label_primary_audience: "Primary audience",
    label_core_problems: "Core problems",
    label_desired_outcomes: "Desired outcomes",
    label_linkedin_attraction: "LinkedIn attraction goal",

    // Row labels (LinkedIn Content Strategy)
    label_main_content_goal: "Main content goal",
    label_content_positioning: "Content positioning",
    label_topics_to_emphasize: "Topics to emphasize",
    label_topics_to_avoid: "Topics to avoid",

    // Row labels (Evidence)
    label_narrative_proof: "Narrative proof",
    label_metrics: "Metrics",
    label_supporting_assets: "Supporting assets",
    label_confidence: "Confidence",
    label_missing_proof_areas: "Missing proof areas",

    // Row labels (AI Suggested Directions)
    label_direction: "Direction",
    label_format: "Format",
    label_angle: "Angle",

    // Row labels (Generation Plan)
    label_first_topic: "First topic",
    label_planned_format: "Format",
    label_structure: "Structure",
    label_audience_fit: "Audience fit",
    label_proof_plan: "Proof plan",
    label_main_goal: "Main goal",
    label_positioning: "Positioning",
    label_topics: "Topics",
    label_avoid: "Avoid",
    label_missing: "Missing",

    // Review item hints (Company Understanding)
    hint_company_summary: "Does this clearly represent your company?",
    hint_brand_story: "Is this the right belief/story behind your brand?",
    hint_main_offering: "Is this the best description of your main offering?",
    hint_problem_solved: "Does this capture the core problem you solve?",
    hint_differentiator: "Does this describe what makes you different?",

    // Review item hints (Audience Understanding)
    hint_primary_audience: "Is this the right audience definition?",
    hint_core_problems: "Are these the right pain points?",
    hint_desired_outcomes: "Are these the outcomes they care about?",
    hint_linkedin_attraction: "Is this who you want to attract on LinkedIn?",

    // Review item hints (LinkedIn Content Strategy)
    hint_main_content_goal: "Is this the right content goal?",
    hint_content_positioning: "Is this how you want to be positioned?",
    hint_topics_to_emphasize: "Are these the right topics to focus on?",
    hint_topics_to_avoid: "Are these the topics you want to avoid?",

    // Review item hints (Evidence)
    hint_narrative_proof: "Is this the right proof narrative?",
    hint_metrics: "Are these proof metrics accurate?",
    hint_supporting_assets: "Are these the assets we should use?",
    hint_missing_proof_areas: "Is anything missing here?",

    // Review item hints (Generation Plan)
    hint_first_topic: "Is this the best first topic?",
    hint_planned_format: "Is this the right format to start with?",
    hint_proof_plan: "Does this proof plan work for you?",

    // Edit placeholder
    edit_placeholder: 'Suggest better wording for "{label}"',

    // Language toggle
    lang_toggle: "中文",
  },

  zh: {
    app_title: "AI 内容策略师",

    chat_title: "访谈",
    chat_subtitle: "AI 内容策略师",
    chat_live: "在线",
    chat_sender: "AI 策略师",

    task_answering: "回答中",
    task_helping: "协助中",
    task_exploring: "探索中",

    btn_sessions: "会话列表",
    btn_new_session: "+ 新建会话",
    sessions_title: "全部会话",
    sessions_loading: "加载中...",
    sessions_empty: "暂无会话。点击「+ 新建会话」开始。",
    session_active: "当前",
    btn_switch: "切换",
    btn_delete: "删除",
    delete_confirm: "确认删除会话 {id}…？此操作不可撤销。",
    session_resume: "正在恢复您的会话...",

    btn_send: "发送",
    input_placeholder: "输入您的回答…（回车发送，Shift+回车换行）",

    section_company_understanding: "公司概况",
    section_audience_understanding: "受众洞察",
    section_linkedin_content_strategy: "LinkedIn 内容策略",
    section_evidence_and_proof_assets: "证据与案例资产",
    section_ai_suggested_content_directions: "AI 建议方向",
    section_generation_plan: "内容生成计划",
    section_content_preferences_and_boundaries: "内容偏好与边界",

    status_confirming: "确认中",
    status_discussing: "讨论中",
    status_reviewing: "审核中：{section}",
    status_confirming_section: "确认中：{section}",
    status_discussing_section: "当前讨论：{section}",
    status_waiting: "仍在等待：{items}",
    section_empty: "随着对话进行，此部分将逐步完善。",

    badge_confirmed: "已确认",
    badge_inferred: "AI 推断",
    badge_needs_confirmation: "待确认",

    preview_title: "内容策略预览",
    preview_verified: "已验证",

    review_title: "板块审核",
    btn_confirm: "确认",
    btn_suggest_change: "修改建议",
    btn_save_change: "保存修改",
    btn_cancel: "取消",
    review_saving: "保存中...",
    review_no_content: "暂无内容。",
    review_suggest_hint: "修改建议将直接保存您的文字（此步骤不会进行 AI 改写）。",
    review_auto_reply: "没问题——我对「{section}」很满意，继续吧。",

    structured_title: "快速选择",
    btn_submit: "提交",

    ctx_pending: "发送第一条消息后将显示上下文用量。",
    ctx_tokens: "令牌",
    ctx_total: "总令牌",
    ctx_session: "会话",
    ctx_turn: "轮次",

    initial_greeting: "能简要介绍一下您的公司是做什么的吗？",

    label_summary: "概述",
    label_brand_story: "品牌故事",
    label_main_offering: "核心产品/服务",
    label_problem_solved: "解决的问题",
    label_differentiator: "差异化优势",

    label_primary_audience: "主要受众",
    label_core_problems: "核心痛点",
    label_desired_outcomes: "期望成果",
    label_linkedin_attraction: "LinkedIn 吸引目标",

    label_main_content_goal: "主要内容目标",
    label_content_positioning: "内容定位",
    label_topics_to_emphasize: "重点话题",
    label_topics_to_avoid: "避免话题",

    label_narrative_proof: "叙事证据",
    label_metrics: "数据指标",
    label_supporting_assets: "支撑素材",
    label_confidence: "信心程度",
    label_missing_proof_areas: "缺失的证据领域",

    label_direction: "方向",
    label_format: "格式",
    label_angle: "切入角度",

    label_first_topic: "首选话题",
    label_planned_format: "格式",
    label_structure: "结构",
    label_audience_fit: "受众匹配度",
    label_proof_plan: "证据计划",
    label_main_goal: "主要目标",
    label_positioning: "定位",
    label_topics: "话题",
    label_avoid: "避免",
    label_missing: "缺失",

    hint_company_summary: "这是否清楚地描述了您的公司？",
    hint_brand_story: "这是否准确反映了品牌背后的信念/故事？",
    hint_main_offering: "这是否是对核心产品/服务的最佳描述？",
    hint_problem_solved: "这是否准确地概括了您解决的核心问题？",
    hint_differentiator: "这是否描述了让您与众不同的特质？",

    hint_primary_audience: "这是否是正确的受众定义？",
    hint_core_problems: "这些是否是正确的痛点？",
    hint_desired_outcomes: "这些是否是他们关心的成果？",
    hint_linkedin_attraction: "这是否是您想在 LinkedIn 上吸引的人群？",

    hint_main_content_goal: "这是否是正确的内容目标？",
    hint_content_positioning: "这是否是您希望的内容定位？",
    hint_topics_to_emphasize: "这些是否是应该关注的正确话题？",
    hint_topics_to_avoid: "这些是否是您想要避免的话题？",

    hint_narrative_proof: "这是否是正确的证据叙事？",
    hint_metrics: "这些证据数据指标是否准确？",
    hint_supporting_assets: "这些是否是我们应该使用的素材？",
    hint_missing_proof_areas: "是否有遗漏的内容？",

    hint_first_topic: "这是否是最佳首选话题？",
    hint_planned_format: "这是否是合适的初始格式？",
    hint_proof_plan: "这个证据计划是否可行？",

    edit_placeholder: "为「{label}」建议更好的措辞",

    lang_toggle: "EN",
  },
};

export function t(lang: Language, key: string, params?: Record<string, string>): string {
  let text = translations[lang][key] ?? translations.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

export function getSectionName(lang: Language, sectionId: string): string {
  const key = `section_${sectionId}`;
  return translations[lang][key] ?? translations.en[key] ?? sectionId;
}
