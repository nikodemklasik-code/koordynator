import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { MaterializationOrder } from "../engine/autonomous-recovery.js";
import {
  AutonomousMaterializationLoop,
  type ExecutionConditions,
  type MaterializationTrace
} from "../engine/materialization-loop.js";
import type { OrchestratorRunRequest, OrchestratorRunResult } from "./orchestrator.js";

export interface OrchestratorRunner {
  run(request: OrchestratorRunRequest): Promise<OrchestratorRunResult>;
}

export type PreBuildMaterializationOptions<E> = {
  createLoop(request: Readonly<OrchestratorRunRequest>): AutonomousMaterializationLoop<OrchestratorRunRequest, E>;
  materializationOrder(request: Readonly<OrchestratorRunRequest>): MaterializationOrder;
  initialConditions?(request: Readonly<OrchestratorRunRequest>): ExecutionConditions;
};

export type PreBuildMaterializationResult =
  | {
      status: "EXECUTED";
      result: OrchestratorRunResult;
      trace: MaterializationTrace[];
    }
  | {
      status: "PREBUILD_BLOCKED";
      reason: string;
      trace: MaterializationTrace[];
    };

function sameOptional<T>(left: T | undefined, right: T | undefined): boolean {
  return left === right;
}

export function assertPreBuildMaterializationInvariant(
  before: Readonly<OrchestratorRunRequest>,
  after: Readonly<OrchestratorRunRequest>
): void {
  if (canonicalDigest(before.signedWorkOrder) !== canonicalDigest(after.signedWorkOrder)) {
    throw new Error("PREBUILD_WORK_ORDER_CHANGED");
  }
  if (before.moduleManifestFp !== after.moduleManifestFp) {
    throw new Error("PREBUILD_MODULE_MANIFEST_CHANGED");
  }
  if (!sameOptional(before.humanApprovalFp, after.humanApprovalFp)) {
    throw new Error("PREBUILD_APPROVAL_CHANGED");
  }
  if (!sameOptional(before.promoteToProduction, after.promoteToProduction)) {
    throw new Error("PREBUILD_PROMOTION_CHANGED");
  }

  const fixedVectorFields = [
    "dependencyFp",
    "configFp",
    "generatedSourcesFp",
    "toolchainFp",
    "buildEnvironmentFp"
  ] as const;

  for (const field of fixedVectorFields) {
    if (before.buildVector[field] !== after.buildVector[field]) {
      throw new Error(`PREBUILD_VECTOR_FIELD_CHANGED:${field}`);
    }
  }
}

export class PreBuildMaterializationRuntime<E = unknown> {
  constructor(
    private readonly downstream: OrchestratorRunner,
    private readonly options: PreBuildMaterializationOptions<E>
  ) {}

  async run(request: OrchestratorRunRequest): Promise<PreBuildMaterializationResult> {
    const loop = this.options.createLoop(request);
    const order = this.options.materializationOrder(request);
    const conditions = this.options.initialConditions?.(request) ?? {
      agent: "Agent",
      aiRoute: "OmniRoute",
      generation: 0
    };

    const outcome = await loop.run(order, conditions);
    if (outcome.status === "potrzebny człowiek") {
      return {
        status: "PREBUILD_BLOCKED",
        reason: outcome.reason,
        trace: outcome.trace
      };
    }

    assertPreBuildMaterializationInvariant(request, outcome.result.artifact);
    const result = await this.downstream.run(outcome.result.artifact);
    return {
      status: "EXECUTED",
      result,
      trace: outcome.trace
    };
  }
}
