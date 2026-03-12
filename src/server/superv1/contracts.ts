import { SuperV1TurnResult } from "@/server/superv1/types";

export interface SuperV1TurnInput {
  conversationId: string;
  userMessage: string;
  language?: "en" | "zh";
}

export interface TurnControllerV1 {
  handleUserTurn(input: SuperV1TurnInput): Promise<SuperV1TurnResult>;
}

