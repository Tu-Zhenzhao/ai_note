export type Language = "en" | "zh";

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Page header
    app_title: "AI Content Strategist",
    badge_alpha: "ALPHA",
    btn_how_to_use: "How to use it!",

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
    session_none: "No Session",
    session_badge: "Session {id}",
    deleting_title: "Deleting session...",
    deleting_hint: "Please wait. Do not perform other actions.",
    switching_title: "Switching session...",
    switching_hint: "Loading selected session. Please wait.",

    // Send
    btn_send: "Send",
    input_placeholder: "Type your answer… (Enter to send, Shift+Enter for new line)",

    // Legal
    legal_terms_btn: "Terms",
    legal_privacy_btn: "Privacy",
    legal_notice_btn: "Alpha Notice",
    legal_alpha_notice: "Alpha testing version only. Results are not guaranteed.",
    legal_rights: "All rights reserved Ultrafilter AI.",
    legal_terms_title: "Terms of Use",
    legal_terms_body:
      "This product is provided for internal alpha testing. Outputs are for reference only and do not constitute professional advice. You are responsible for reviewing and validating all generated content before use.",
    legal_privacy_title: "Privacy Notice",
    legal_privacy_body:
      "During alpha testing, conversation content may be processed to provide responses and improve product quality. Do not submit sensitive, confidential, or regulated personal information unless explicitly approved by your organization.",
    legal_notice_title: "Alpha Test Disclaimer",
    legal_notice_body:
      "This is an alpha test feature set. Availability, quality, and behavior may change at any time. Results are not guaranteed. By continuing to use this interface, you acknowledge and accept these limitations.",
    guide_back_home: "Back to Workspace",
    guide_title: "Quick Start Guide",
    guide_intro:
      "New here? Follow these steps and you can complete your first strategy workflow in minutes.",
    guide_step_1_title: "Start a session",
    guide_step_1_body:
      "Click '+ New Session' if needed. The AI will ask interview questions in chat.",
    guide_step_2_title: "Answer naturally",
    guide_step_2_body:
      "Use your own words. If you feel confused, ask the agent directly, for example: \"Can you explain this question more?\" or \"I don't understand this question.\"",
    guide_step_3_title: "Watch live preview",
    guide_step_3_body:
      "The right panel fills your strategy sections as you answer.",
    guide_step_4_title: "Finish all questions",
    guide_step_4_body:
      "Progress is based on answered questions. Complete them to unlock AI suggested directions.",
    guide_step_5_title: "Export your results",
    guide_step_5_body:
      "Scroll down to Export Desk and download chat history, answered sheet, and AI report.",
    guide_tip_title: "Pro tips",
    guide_tip_1: "Use one session per brand/project.",
    guide_tip_2: "Keep answers concrete: audience, pain points, proof, and boundaries.",
    guide_tip_3: "Review before export if any section looks unclear.",

    // Section names
    section_company_understanding: "Company Understanding",
    section_audience_understanding: "Audience Understanding",
    section_linkedin_content_strategy: "LinkedIn Content Strategy",
    section_evidence_and_proof_assets: "Evidence & Proof Assets",
    section_ai_suggested_content_directions: "AI Suggested Directions",
    section_generation_plan: "Generation Plan",
    section_content_preferences_and_boundaries: "Content Preferences & Boundaries",
    section_export_desk: "Export Desk",

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
    ai_suggestion_pending_note: "AI suggestion will provide after finished all 6 sections!",
    export_pending_note: "Please finish all interview steps and wait for AI suggestions before exporting.",
    export_ready_note: "All exports are ready.",
    export_chat_history: "Chat history (.txt)",
    export_question_sheet: "Question list answered sheet",
    export_ai_report: "AI suggested direction report (.md)",
    export_chat_history_btn: "Export TXT",
    export_question_sheet_md_btn: "Export MD",
    export_question_sheet_txt_btn: "Export TXT",
    export_ai_report_btn: "Export MD",
    export_in_progress: "Exporting...",
    export_locked_badge: "Locked",

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
    label_preferred_tone: "Preferred tone",
    label_voice_and_style: "Voice and style",
    label_avoid_style: "Avoided style",
    label_boundaries: "Boundaries",
    label_concerns: "Concerns",

    // Row labels (AI Suggested Directions)
    label_direction: "Direction",
    label_format: "Format",
    label_angle: "Angle",
    label_target_audience: "Target audience",
    label_core_insight: "Core insight",
    label_example_hook: "Example hook",
    label_proof_to_use: "Proof to use",
    label_risk_boundary_check: "Risk check",
    label_why_fit: "Why it fits",
    label_execution_difficulty: "Execution",
    label_best_starting_direction: "Best start",
    label_reason: "Reason",
    label_first_week_plan: "First week plan",

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
    badge_alpha: "ALPHA",
    btn_how_to_use: "如何使用？",

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
    session_none: "无会话",
    session_badge: "会话 {id}",
    deleting_title: "正在删除会话...",
    deleting_hint: "请稍候，暂时不要进行其他操作。",
    switching_title: "正在切换会话...",
    switching_hint: "正在加载所选会话，请稍候。",

    btn_send: "发送",
    input_placeholder: "输入您的回答…（回车发送，Shift+回车换行）",

    legal_terms_btn: "服务条款",
    legal_privacy_btn: "隐私说明",
    legal_notice_btn: "Alpha 声明",
    legal_alpha_notice: "当前为 Alpha 测试版本，结果不作任何保证。",
    legal_rights: "Ultrafilter AI 保留所有权利。",
    legal_terms_title: "服务条款",
    legal_terms_body:
      "本产品仅用于内部 Alpha 测试。系统输出仅供参考，不构成任何专业建议。您有责任在使用前审阅并验证所有生成内容。",
    legal_privacy_title: "隐私说明",
    legal_privacy_body:
      "在 Alpha 测试期间，系统可能处理对话内容以提供功能并改进产品质量。除非已获得组织明确批准，请勿提交敏感、机密或受监管的个人信息。",
    legal_notice_title: "Alpha 测试免责声明",
    legal_notice_body:
      "当前功能集处于 Alpha 测试阶段，可用性、质量与行为可能随时变化，结果不作保证。继续使用即表示您已知悉并接受上述限制。",
    guide_back_home: "返回工作台",
    guide_title: "快速上手指南",
    guide_intro: "第一次使用？按下面步骤走，几分钟内就能完成第一轮策略流程。",
    guide_step_1_title: "开始一个会话",
    guide_step_1_body: "如有需要先点击「+ 新建会话」。AI 会在聊天区发起访谈提问。",
    guide_step_2_title: "自然回答问题",
    guide_step_2_body: "用你自己的话回答即可。如果有疑问，可以直接问 AI，例如：「可以再解释一下这个问题吗？」或「我不太理解这个问题。」",
    guide_step_3_title: "看右侧实时预览",
    guide_step_3_body: "你回答的内容会同步填充到右侧各个策略板块。",
    guide_step_4_title: "完成全部问题",
    guide_step_4_body: "进度按已回答问题计算。完成后会解锁 AI 建议方向。",
    guide_step_5_title: "导出结果",
    guide_step_5_body: "向下滚动到导出桌面，下载聊天记录、回答清单和 AI 报告。",
    guide_tip_title: "使用建议",
    guide_tip_1: "每个品牌/项目建议单独一个会话。",
    guide_tip_2: "回答尽量具体：受众、痛点、证据、边界。",
    guide_tip_3: "若某板块不清楚，先修正再导出。",

    section_company_understanding: "公司概况",
    section_audience_understanding: "受众洞察",
    section_linkedin_content_strategy: "LinkedIn 内容策略",
    section_evidence_and_proof_assets: "证据与案例资产",
    section_ai_suggested_content_directions: "AI 建议方向",
    section_generation_plan: "内容生成计划",
    section_content_preferences_and_boundaries: "内容偏好与边界",
    section_export_desk: "导出桌面",

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
    ai_suggestion_pending_note: "完成前 6 个板块后，AI 将提供建议方向！",
    export_pending_note: "请先完成全部步骤并等待 AI 建议生成后再导出。",
    export_ready_note: "导出文件已就绪。",
    export_chat_history: "聊天记录（.txt）",
    export_question_sheet: "已回答问题清单",
    export_ai_report: "AI 建议方向报告（.md）",
    export_chat_history_btn: "导出 TXT",
    export_question_sheet_md_btn: "导出 MD",
    export_question_sheet_txt_btn: "导出 TXT",
    export_ai_report_btn: "导出 MD",
    export_in_progress: "导出中...",
    export_locked_badge: "未解锁",

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
    label_preferred_tone: "偏好语气",
    label_voice_and_style: "语调与风格",
    label_avoid_style: "避免风格",
    label_boundaries: "内容边界",
    label_concerns: "顾虑",

    label_direction: "方向",
    label_format: "格式",
    label_angle: "切入角度",
    label_target_audience: "目标受众",
    label_core_insight: "核心洞察",
    label_example_hook: "示例开场",
    label_proof_to_use: "可用证据",
    label_risk_boundary_check: "风险与边界",
    label_why_fit: "匹配原因",
    label_execution_difficulty: "执行难度",
    label_best_starting_direction: "推荐起步方向",
    label_reason: "原因",
    label_first_week_plan: "首周计划",

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
