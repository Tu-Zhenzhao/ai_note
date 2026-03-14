import { z } from "zod";
import { generateModelObject } from "@/server/model/adapters";
import { superV1AiDirectionsSystemPrompt } from "@/server/prompts/superv1";
import {
  SuperV1AiSuggestedDirectionsPayload,
  SuperV1ChecklistAnswer,
  SuperV1TemplateQuestion,
  SuperV1Turn,
} from "@/server/superv1/types";

const schema = z.object({
  ai_suggested_directions: z.array(
    z.object({
      id: z.enum(["dir_1", "dir_2", "dir_3"]),
      title: z.string().min(1),
      target_audience: z.string().min(1),
      core_insight: z.string().min(1),
      content_angle: z.string().min(1),
      suggested_formats: z.array(z.string().min(1)).min(2),
      example_hook: z.string().min(1),
      proof_to_use: z.array(z.string().min(1)).min(1),
      risk_boundary_check: z.string().min(1),
      why_fit: z.string().min(1),
      execution_difficulty: z.enum(["Low", "Medium", "High"]),
    }),
  ).length(3),
  recommendation_summary: z.object({
    best_starting_direction_id: z.enum(["dir_1", "dir_2", "dir_3"]),
    reason: z.string().min(1),
    first_week_plan: z.array(z.string().min(1)).length(3),
  }),
});

function fallbackDirections(params: {
  language: "en" | "zh";
  answers: SuperV1ChecklistAnswer[];
}): SuperV1AiSuggestedDirectionsPayload {
  const isZh = params.language === "zh";
  const answerMap = new Map(params.answers.map((answer) => [answer.question_id, answer]));
  const audience = String(answerMap.get("ma_primary_audience")?.value_json ?? (isZh ? "目标受众" : "Target audience"));
  const problem = String(answerMap.get("ps_problem_solved")?.value_json ?? (isZh ? "关键业务问题" : "Key business problem"));
  const proof = String(answerMap.get("ev_proof")?.value_json ?? (isZh ? "可验证案例与数据" : "Verifiable case studies and metrics"));
  const firstTopic = String(answerMap.get("cr_first_topic")?.value_json ?? (isZh ? "首发主题" : "First topic"));

  return {
    ai_suggested_directions: [
      {
        id: "dir_1",
        title: isZh ? "问题拆解型内容" : "Problem Breakdown Content",
        target_audience: audience,
        core_insight: isZh ? `受众最关心的是如何解决：${problem}` : `Audience cares most about solving: ${problem}`,
        content_angle: isZh ? "先定义问题，再展示可复制方法" : "Define the problem first, then show repeatable methods",
        suggested_formats: isZh ? ["轮播图", "实战帖"] : ["Carousel", "How-to post"],
        example_hook: isZh ? `如果你也在被「${problem}」拖慢，这里是可执行方案。` : `If "${problem}" is slowing you down, here is an executable approach.`,
        proof_to_use: [proof],
        risk_boundary_check: isZh ? "避免绝对化效果承诺，使用真实边界条件。" : "Avoid absolute outcome claims; keep boundary conditions explicit.",
        why_fit: isZh ? "与当前业务价值表达一致，便于建立专业信任。" : "Aligned with current business value narrative and builds trust fast.",
        execution_difficulty: "Low",
      },
      {
        id: "dir_2",
        title: isZh ? "案例证据型内容" : "Proof-led Case Content",
        target_audience: audience,
        core_insight: isZh ? "决策者更容易被可验证证据驱动。" : "Decision makers are moved by verifiable proof.",
        content_angle: isZh ? "从案例复盘切入，强调结果与方法链路。" : "Lead with case retrospectives and result-to-method linkage.",
        suggested_formats: isZh ? ["案例长帖", "数据图文"] : ["Case-study post", "Data visual post"],
        example_hook: isZh ? "这个案例最有价值的不是结果，而是可复用的路径。" : "The most valuable part of this case is not the outcome, but the reusable path.",
        proof_to_use: [proof],
        risk_boundary_check: isZh ? "敏感数据脱敏，避免披露客户隐私。" : "Mask sensitive data and avoid client privacy leakage.",
        why_fit: isZh ? "强化可信度，支持后续商业转化。" : "Strengthens credibility and supports downstream conversion.",
        execution_difficulty: "Medium",
      },
      {
        id: "dir_3",
        title: isZh ? "观点引领型内容" : "Point-of-View Leadership Content",
        target_audience: audience,
        core_insight: isZh ? "行业受众需要可落地且有立场的判断。" : "Industry audience wants practical yet opinionated judgment.",
        content_angle: isZh ? "用趋势判断连接业务实践与方法论。" : "Connect market POV with operational practice and frameworks.",
        suggested_formats: isZh ? ["观点帖", "短视频口播脚本"] : ["POV post", "Short video script"],
        example_hook: isZh ? `${firstTopic} 只是表层，真正决定结果的是策略顺序。` : `${firstTopic} is surface-level; sequencing strategy determines results.`,
        proof_to_use: [proof],
        risk_boundary_check: isZh ? "避免过度泛化，明确适用场景。" : "Avoid overgeneralization; state applicability boundaries.",
        why_fit: isZh ? "可提升品牌心智位置并形成差异化表达。" : "Elevates brand positioning and sharpens differentiation.",
        execution_difficulty: "High",
      },
    ],
    recommendation_summary: {
      best_starting_direction_id: "dir_1",
      reason: isZh ? "执行门槛低，且能最快验证受众反馈。" : "Lowest execution barrier and fastest feedback validation.",
      first_week_plan: isZh
        ? ["发布 1 篇问题拆解轮播", "发布 1 篇案例复盘帖", "发布 1 篇观点帖并观察互动"]
        : ["Publish 1 problem-breakdown carousel", "Publish 1 proof-led case post", "Publish 1 POV post and measure engagement"],
    },
  };
}

export async function generateAiSuggestedDirections(params: {
  language: "en" | "zh";
  turns: SuperV1Turn[];
  questions: SuperV1TemplateQuestion[];
  answers: SuperV1ChecklistAnswer[];
}): Promise<SuperV1AiSuggestedDirectionsPayload> {
  try {
    const questionMap = new Map(params.questions.map((question) => [question.question_id, question]));
    const checklistAnswers = params.answers.map((answer) => ({
      question_id: answer.question_id,
      question_text: questionMap.get(answer.question_id)?.question_text ?? answer.question_id,
      status: answer.status,
      value: answer.value_json,
      evidence: answer.evidence_text,
      confidence: answer.confidence,
    }));
    const chatHistory = params.turns.map((turn) => ({
      role: turn.role,
      content: turn.message_text,
      created_at: turn.created_at,
    }));

    return await generateModelObject({
      system: superV1AiDirectionsSystemPrompt(),
      prompt: [
        `Language: ${params.language}`,
        `Chat history JSON:\n${JSON.stringify(chatHistory)}`,
        `Checklist answers JSON:\n${JSON.stringify(checklistAnswers)}`,
      ].join("\n\n"),
      schema,
    });
  } catch {
    return fallbackDirections({
      language: params.language,
      answers: params.answers,
    });
  }
}
