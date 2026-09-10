import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import type { MaterializationOrder } from "./autonomous-recovery.js";
import type { AgentMaterializer, ExecutionConditions, MaterializationResult } from "./materialization-loop.js";
import { applyExactMaterializationPack, type ExactMaterializationPack, type ExactMaterializationReceipt } from "./exact-materialization-pack.js";
import { measureBuildVector } from "../build/tree-fingerprint.js";
import type { OrchestratorRunRequest } from "../orchestrator/orchestrator.js";

export type ExactPackRequestContext = {
  order: Readonly<MaterializationOrder>;
  conditions: Readonly<ExecutionConditions>;
  currentRequest: Readonly<OrchestratorRunRequest>;
  correction?: string;
};

export interface ExactPackSource {
  next(context: Readonly<ExactPackRequestContext>): Promise<ExactMaterializationPack>;
}

export type ExactPackMaterializationRecord = {
  packFp: Digest;
  sourceBeforeFp: Digest;
  sourceAfterFp: Digest;
  correctionFp?: Digest;
  conditions: ExecutionConditions;
  receipts: ExactMaterializationReceipt[];
};

export class ExactPackAgentMaterializer implements AgentMaterializer<OrchestratorRunRequest> {
  private currentRequest: OrchestratorRunRequest;
  private readonly history: ExactPackMaterializationRecord[] = [];

  constructor(
    private readonly sourceDir: string,
    initialRequest: OrchestratorRunRequest,
    private readonly packSource: ExactPackSource
  ) {
    this.currentRequest = initialRequest;
  }

  records(): readonly ExactPackMaterializationRecord[] {
    return this.history;
  }

  async materialize(
    order: Readonly<MaterializationOrder>,
    conditions: Readonly<ExecutionConditions>,
    correction?: string
  ): Promise<MaterializationResult<OrchestratorRunRequest>> {
    const currentVector = this.currentRequest.buildVector;
    const before = await measureBuildVector(this.sourceDir, {
      dependencyFp: currentVector.dependencyFp,
      configFp: currentVector.configFp,
      generatedSourcesFp: currentVector.generatedSourcesFp,
      toolchainFp: currentVector.toolchainFp,
      buildEnvironmentFp: currentVector.buildEnvironmentFp
    });
    if (before.vector.sourceFp !== currentVector.sourceFp) {
      throw new Error(`MATERIALIZATION_SOURCE_STALE:declared=${currentVector.sourceFp}:actual=${before.vector.sourceFp}`);
    }

    const pack = await this.packSource.next({
      order,
      conditions,
      currentRequest: this.currentRequest,
      ...(correction === undefined ? {} : { correction })
    });
    const receipts = await applyExactMaterializationPack(this.sourceDir, order.allowedPaths, pack);

    const after = await measureBuildVector(this.sourceDir, {
      dependencyFp: currentVector.dependencyFp,
      configFp: currentVector.configFp,
      generatedSourcesFp: currentVector.generatedSourcesFp,
      toolchainFp: currentVector.toolchainFp,
      buildEnvironmentFp: currentVector.buildEnvironmentFp
    });
    const nextRequest: OrchestratorRunRequest = {
      ...this.currentRequest,
      buildVector: after.vector
    };

    const record: ExactPackMaterializationRecord = {
      packFp: pack.packFp,
      sourceBeforeFp: before.vector.sourceFp,
      sourceAfterFp: after.vector.sourceFp,
      ...(correction === undefined ? {} : { correctionFp: canonicalDigest(correction) }),
      conditions: { ...conditions },
      receipts
    };
    this.history.push(record);
    this.currentRequest = nextRequest;

    return {
      artifact: nextRequest,
      artifactFp: canonicalDigest({
        kind: "exact-pack-materialization-result-v1",
        taskId: order.taskId,
        packFp: pack.packFp,
        sourceBeforeFp: record.sourceBeforeFp,
        sourceAfterFp: record.sourceAfterFp,
        receipts
      })
    };
  }
}
