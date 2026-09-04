import { freezeCandidate, type FrozenCandidate } from "../domain/candidate.js";
import type { EvidenceReceipt } from "../domain/evidence.js";
import type { BuildId, Digest, TaskRef } from "../domain/ids.js";
import type { OrchestratorState } from "../domain/state.js";
import type { SignedWorkOrder } from "../security/work-order-signature.js";
import { acceptSignedWorkOrderExecution, type PublicKeyResolver } from "../security/work-order-execution-gate.js";
import type { ArtifactRegistry, StoredArtifact } from "../build/artifact-registry.js";
import type { BuildInputVector } from "../build/build-input.js";
import { buildOrReuse } from "../build/build-or-reuse.js";
import type { HermeticBuilder } from "../build/hermetic-builder.js";
import { transitionState } from "../engine/state-machine.js";
import { executeValidationDag, type Validator } from "../validators/validation-dag.js";
import { evaluateReleasePolicy } from "../policy/release-policy.js";
import { ReleaseController, type ReleaseRecord } from "../release/release-controller.js";
import type { StateStore } from "../store/state-store.js";
import type { SignedWorkOrderStore } from "../store/work-order-store.js";

export type OrchestratorRunRequest = {
  signedWorkOrder: SignedWorkOrder;
  buildVector: BuildInputVector;
  moduleManifestFp: Digest;
  humanApprovalFp?: Digest;
  promoteToProduction?: boolean;
};

export type OrchestratorRunResult = {
  status: "RELEASED" | "RETURNED" | "AWAITING_HUMAN_APPROVAL";
  candidate: FrozenCandidate;
  receipts: EvidenceReceipt[];
  release?: ReleaseRecord;
  nextRevision?: number;
};

export class OrchestratorRuntime {
  constructor(
    private readonly stateStore: StateStore,
    private readonly artifactRegistry: ArtifactRegistry,
    private readonly builder: HermeticBuilder,
    private readonly validators: Validator[],
    private readonly releaseController: ReleaseController,
    private readonly resolvePublicKey: PublicKeyResolver,
    private readonly clock: () => string,
    private readonly verifyAttestation: (artifact: StoredArtifact) => boolean = () => true,
    private readonly workOrderStore?: SignedWorkOrderStore
  ) {}

  private async saveTransition(current: OrchestratorState, next: OrchestratorState["state"], reasonCode?: string): Promise<OrchestratorState> {
    const state = transitionState(current, next, this.clock(), reasonCode);
    await this.stateStore.save(state);
    return state;
  }

  async run(request: OrchestratorRunRequest): Promise<OrchestratorRunResult> {
    const accepted = acceptSignedWorkOrderExecution(request.signedWorkOrder, this.resolvePublicKey);
    const order = accepted.envelope.order;
    await this.workOrderStore?.put(accepted.envelope);
    const previous = await this.stateStore.load(order.taskId);
    if (previous && previous.revision >= order.revision && previous.state !== "RETURNED") {
      throw new Error(`STALE_WORK_ORDER_REVISION:${previous.revision}`);
    }

    const ref: TaskRef = {
      taskId: order.taskId,
      workspaceId: order.workspaceId,
      buildId: `BUILD-${order.taskId.slice(5)}-R${order.revision}` as BuildId,
      revision: order.revision
    };
    let state: OrchestratorState = { ...ref, state: "CREATED", changedAt: this.clock() };
    await this.stateStore.save(state);
    state = await this.saveTransition(state, "READY");
    state = await this.saveTransition(state, "BUILDING");

    const build = await buildOrReuse(request.buildVector, this.artifactRegistry, this.builder, this.verifyAttestation);
    state = await this.saveTransition(state, "BUILD_READY", build.mode);

    const candidate = freezeCandidate(ref, {
      sourceFp: request.buildVector.sourceFp,
      dependencyFp: request.buildVector.dependencyFp,
      configFp: request.buildVector.configFp,
      toolchainFp: request.buildVector.toolchainFp,
      buildEnvironmentFp: request.buildVector.buildEnvironmentFp,
      moduleManifestFp: request.moduleManifestFp,
      artifactFp: build.artifact.artifactFp
    }, this.clock());

    state = await this.saveTransition(state, "CANDIDATE_FROZEN");
    state = await this.saveTransition(state, "VALIDATING");

    const validation = await executeValidationDag(this.validators, order.requiredGates, {
      candidate,
      artifactBytes: build.artifact.bytes,
      policyFp: order.policyRef.bundleHash,
      componentFp: request.buildVector.sourceFp,
      dependencyFp: request.buildVector.dependencyFp,
      configFp: request.buildVector.configFp,
      toolchainFp: request.buildVector.toolchainFp,
      environmentFp: request.buildVector.buildEnvironmentFp,
      now: this.clock()
    });

    const policy = evaluateReleasePolicy(order, candidate.candidateSha, validation.receipts, new Date(this.clock()));
    if (!validation.passed || !policy.allowed) {
      await this.saveTransition(state, "RETURNED", policy.reasons.join("|") || "VALIDATION_FAILED");
      return { status: "RETURNED", candidate, receipts: validation.receipts, nextRevision: order.revision + 1 };
    }

    state = await this.saveTransition(state, "APPROVED");
    if (policy.approval === "HUMAN_REQUIRED" && request.humanApprovalFp === undefined) {
      return { status: "AWAITING_HUMAN_APPROVAL", candidate, receipts: validation.receipts };
    }

    const approvalFp = request.humanApprovalFp ?? policy.approvalFp;
    state = await this.saveTransition(state, "RELEASING");
    let release = await this.releaseController.canary(candidate, approvalFp, order.policyRef.bundleHash);
    if (request.promoteToProduction === true) release = await this.releaseController.promote(release.release.releaseSha);
    if (!this.releaseController.verifyExactArtifact(candidate, release)) throw new Error("RELEASE_EXACT_ARTIFACT_VERIFICATION_FAILED");
    await this.saveTransition(state, "RELEASED");

    return { status: "RELEASED", candidate, receipts: validation.receipts, release };
  }
}
