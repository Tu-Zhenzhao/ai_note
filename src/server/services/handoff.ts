import { randomUUID } from "crypto";
import { InterviewState } from "@/lib/types";
import { generateModelText } from "@/server/model/adapters";
import { handoffSystemPrompt, handoffUserPrompt } from "@/server/prompts/handoff";

export async function createHandoffSummary(sessionId: string, state: InterviewState) {
  const fallback = {
    strong: Object.entries(state.system_assessment.module_completion_map)
      .filter(([, status]) => status === "strong" || status === "verified")
      .map(([module]) => module),
    missing: state.system_assessment.missing_fields,
    weak: state.system_assessment.weak_fields,
    sensitive: state.constraints_and_boundaries.sensitive_topics.value,
    next_human_actions: [
      "Review unresolved weak modules",
      "Validate sensitive boundaries",
      "Propose narrowed first content direction",
    ],
  };

  try {
    const summary = await generateModelText({
      system: handoffSystemPrompt(),
      prompt: handoffUserPrompt(JSON.stringify(state)),
    });
    return {
      id: randomUUID(),
      session_id: sessionId,
      summary_jsonb: {
        summary,
      },
      created_at: new Date().toISOString(),
    };
  } catch {
    return {
      id: randomUUID(),
      session_id: sessionId,
      summary_jsonb: fallback,
      created_at: new Date().toISOString(),
    };
  }
}
