import { AgentTurnResult, InterviewMessage, InterviewState } from "@/lib/types";

export interface HandleUserTurnInput {
  sessionId: string;
  userMessage: string;
  userTurnId: string;
  state: InterviewState;
  recentMessages?: InterviewMessage[];
  language?: "en" | "zh";
}

export interface TurnController {
  handleUserTurn(input: HandleUserTurnInput): Promise<AgentTurnResult>;
}
