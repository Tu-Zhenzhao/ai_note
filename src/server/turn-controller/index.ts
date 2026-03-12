import { TurnController } from "@/server/turn-controller/contracts";
import { AgentTurnController } from "@/server/turn-controller/agent-turn-controller";

let turnController: TurnController | null = null;

export function getTurnController(): TurnController {
  if (!turnController) {
    turnController = new AgentTurnController();
  }
  return turnController;
}
