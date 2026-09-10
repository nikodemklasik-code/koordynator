import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { WorkOrder } from "../domain/work-order.js";
import { OrchestratorRuntime, type OrchestratorRunRequest, type OrchestratorRunResult } from "./orchestrator.js";

export type ReturnedRunResult = Omit<OrchestratorRunResult, "status"> & { status: "RETURNED" };

export type AutonomousRecoveryContext = {
  request: Readonly<OrchestratorRunRequest>;
  result: Readonly<ReturnedRunResult>;
  recoveryAttempt: number;
  remainingRetries: number;
};

export type AutonomousRecoveryDecision =
  | { action: "retry"; request: OrchestratorRunRequest }
  | { action: "stop"; reason: string };

export interface AutonomousRunRecovery {
  recover(context: Readonly<AutonomousRecoveryContext>): Promise<AutonomousRecoveryDecision>;
}

function governanceProjection(order: WorkOrder): unknown {
  return {
    taskId: order.taskId,
    workspaceId: order.workspaceId,
    objective: order.objective,
    scope: order.scope,
    requiredInputs: order.requiredInputs.map((input) => ({ ...input })),
    capabilities: order.capabilities,
    budget: order.budget,
    requiredGates: order.requiredGates,
    expectedEvidence: order.expectedEvidence,
    acceptanceCriteria: order.acceptanceCriteria,
    failureCriteria: order.failureCriteria,
    securityContractRef: order.securityContractRef,
    performanceContractRef: order.performanceContractRef,
    rollbackRequirement: order.rollbackRequirement,
    humanApprovalPolicy: order.humanApprovalPolicy,
    policyRef: order.policyRef
  };
}

export function autonomousGovernanceFingerprint(order: WorkOrder) {
  return canonicalDigest(governanceProjection(order));
}

function sameOptional<T>(left: T | undefined, right: T | undefined): boolean {
  return left === right;
}

export function assertAutonomousRetryInvariant(
  previous: Readonly<OrchestratorRunRequest>,
  returned: Readonly<ReturnedRunResult>,
  next: Readonly<OrchestratorRunRequest>
): void {
  const previousOrder = previous.signedWorkOrder.order;
  const nextOrder = next.signedWorkOrder.order;
  const expectedRevision = returned.nextRevision ?? previousOrder.revision + 1;

  if (nextOrder.revision !== expectedRevision) {
    throw new Error(`AUTONOMOUS_RETRY_REVISION_INVALID:expected=${expectedRevision}:actual=${nextOrder.revision}`);
  }
  if (autonomousGovernanceFingerprint(previousOrder) !== autonomousGovernanceFingerprint(nextOrder)) {
    throw new Error("AUTONOMOUS_RETRY_SCOPE_CHANGED");
  }
  if (previous.moduleManifestFp !== next.moduleManifestFp) {
    throw new Error("AUTONOMOUS_RETRY_MODULE_MANIFEST_CHANGED");
  }
  if (!sameOptional(previous.humanApprovalFp, next.humanApprovalFp)) {
    throw new Error("AUTONOMOUS_RETRY_APPROVAL_CHANGED");
  }
  if (!sameOptional(previous.promoteToProduction, next.promoteToProduction)) {
    throw new Error("AUTONOMOUS_RETRY_PROMOTION_CHANGED");
  }
}

function withReason(result: ReturnedRunResult, reason: string): ReturnedRunResult {
  return { ...result, reasons: [...(result.reasons ?? []), reason] };
}

export class AutonomousOrchestratorRuntime {
  constructor(
    private readonly runtime: OrchestratorRuntime,
    private readonly recovery: AutonomousRunRecovery
  ) {}

  async run(initialRequest: OrchestratorRunRequest): Promise<OrchestratorRunResult> {
    const retryBudget = initialRequest.signedWorkOrder.order.budget.retries;
    let request = initialRequest;
    let recoveriesUsed = 0;

    while (true) {
      const result = await this.runtime.run(request);
      if (result.status !== "RETURNED") return result;
      const returned: ReturnedRunResult = { ...result, status: "RETURNED" };

      if (recoveriesUsed >= retryBudget) {
        return withReason(returned, "Wyczerpano autonomiczną drabinę naprawy.");
      }

      const decision = await this.recovery.recover({
        request,
        result: returned,
        recoveryAttempt: recoveriesUsed + 1,
        remainingRetries: retryBudget - recoveriesUsed
      });

      if (decision.action === "stop") {
        return withReason(returned, decision.reason.trim() || "Autonomiczna naprawa została zatrzymana.");
      }

      assertAutonomousRetryInvariant(request, returned, decision.request);
      request = decision.request;
      recoveriesUsed += 1;
    }
  }
}
