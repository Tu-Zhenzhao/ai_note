import { runAgentTurn } from "@/server/agent/agent-runtime";
import { HandleUserTurnInput, TurnController } from "@/server/turn-controller/contracts";

export class AgentTurnController implements TurnController {
  async handleUserTurn(input: HandleUserTurnInput) {
    return runAgentTurn(input);
  }
}
