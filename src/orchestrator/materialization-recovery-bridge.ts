import type { MaterializationOrder } from "../engine/autonomous-recovery.js";
import { AutonomousMaterializationLoop, type ExecutionConditions } from "../engine/materialization-loop.js";
import type { OrchestratorRunRequest } from "./orchestrator.js";
import type { AutonomousRecoveryContext, AutonomousRecoveryDecision, AutonomousRunRecovery } from "./autonomous-orchestrator.js";

export type MaterializationRecoveryBridgeOptions<E> = {
  createLoop(context: Readonly<AutonomousRecoveryContext>): AutonomousMaterializationLoop<OrchestratorRunRequest, E>;
  materializationOrder(context: Readonly<AutonomousRecoveryContext>): MaterializationOrder;
  initialConditions?(context: Readonly<AutonomousRecoveryContext>): ExecutionConditions;
};

export class MaterializationRecoveryBridge<E = unknown> implements AutonomousRunRecovery {
  constructor(private readonly options: MaterializationRecoveryBridgeOptions<E>) {}

  async recover(context: Readonly<AutonomousRecoveryContext>): Promise<AutonomousRecoveryDecision> {
    const loop = this.options.createLoop(context);
    const order = this.options.materializationOrder(context);
    const conditions = this.options.initialConditions?.(context) ?? {
      agent: "Agent",
      aiRoute: "OmniRoute",
      generation: context.recoveryAttempt - 1
    };

    const outcome = await loop.run(order, conditions);
    if (outcome.status === "potrzebny człowiek") {
      return { action: "stop", reason: `Potrzebny człowiek: ${outcome.reason}` };
    }
    return { action: "retry", request: outcome.result.artifact };
  }
}
