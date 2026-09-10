import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import type { BuildInputVector } from "../src/build/build-input.js";
import type { HermeticBuilder } from "../src/build/hermetic-builder.js";
import { MemoryArtifactRegistry } from "../src/build/memory-artifact-registry.js";
import { FileStateStore } from "../src/store/file-state-store.js";
import type { Validator } from "../src/validators/validation-dag.js";
import { MemoryReleaseStore, ReleaseController } from "../src/release/release-controller.js";
import { signWorkOrder } from "../src/security/work-order-signature.js";
import { OrchestratorRuntime, type OrchestratorRunRequest } from "../src/orchestrator/orchestrator.js";
import { AutonomousOrchestratorRuntime } from "../src/orchestrator/autonomous-orchestrator.js";
import { MaterializationRecoveryBridge } from "../src/orchestrator/materialization-recovery-bridge.js";
import { AutonomousMaterializationLoop, type AgentMaterializer, type BrainExecutionConditions, type GuardianComparator, type HarmoniaConflictWeigher, type Rewident } from "../src/engine/materialization-loop.js";

const d = (value: unknown) => canonicalDigest(value);

function vector(seed: string): BuildInputVector {
  return {
    sourceFp: d(`source:${seed}`),
    dependencyFp: d("deps"),
    configFp: d("config"),
    toolchainFp: d("toolchain"),
    buildEnvironmentFp: d("env"),
    generatedSourcesFp: d("generated")
  };
}

function order(revision: number, retries: number): WorkOrder {
  return {
    taskId: "TASK-AUTONOMOUS-RUNTIME",
    workspaceId: "WS-AUTONOMOUS-RUNTIME",
    revision,
    objective: "Zmaterializuj dokładnie zatwierdzony element.",
    scope: { modules: ["core"], allowedPaths: ["src/**"] },
    requiredInputs: [{ uri: "repo://source", digest: d("source-contract") }],
    capabilities: ["repo.write"],
    budget: { timeSec: 600, costLimit: 5, retries, maxDagDepth: 8 },
    requiredGates: ["unit"],
    expectedEvidence: ["dependency"],
    acceptanceCriteria: ["wymagany test przechodzi"],
    failureCriteria: ["wymagany test nie przechodzi"],
    securityContractRef: d("security-contract"),
    performanceContractRef: d("performance-contract"),
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release-v1", bundleHash: d("policy") }
  };
}

function builder(): HermeticBuilder {
  return {
    async build(input) {
      return {
        bytes: Buffer.from(JSON.stringify(input), "utf8"),
        sbomFp: d("sbom"),
        provenanceFp: d(input),
        builderIdentityFp: d("builder")
      };
    }
  };
}

function validator(status: () => "PASS" | "FAIL"): Validator {
  return {
    gate: "unit",
    async validate(context) {
      return {
        status: status(),
        kind: "dependency",
        validUntil: new Date(new Date(context.now).getTime() + 3600_000).toISOString(),
        testDefinitionFp: d("test"),
        fixtureFp: d("fixture"),
        validatorVersionFp: d("validator")
      };
    }
  };
}

function makeRuntime(root: string, publicKey: KeyObject, status: () => "PASS" | "FAIL"): OrchestratorRuntime {
  let tick = 0;
  const clock = () => new Date(Date.UTC(2026, 8, 10, 8, 0, tick++)).toISOString();
  return new OrchestratorRuntime(
    new FileStateStore(root),
    new MemoryArtifactRegistry(),
    builder(),
    [validator(status)],
    new ReleaseController(new MemoryReleaseStore(), (digest) => ({ signatureFp: d({ digest, key: "release" }) }), clock),
    () => publicKey,
    clock
  );
}

function makeBridge(privateKey: KeyObject, retries: number, routes: string[], materializations: { value: number }) {
  return new MaterializationRecoveryBridge({
    materializationOrder(context) {
      return {
        taskId: context.request.signedWorkOrder.order.taskId,
        instructions: "Zainstaluj dostarczoną korektę dokładnie, bez zmiany architektury i zakresu.",
        allowedPaths: [...context.request.signedWorkOrder.order.scope.allowedPaths],
        suppliedMaterialFp: context.request.buildVector.sourceFp,
        expectedResult: "Element zgodny z niezmienioną instrukcją i wymaganymi testami.",
        initiative: "brak"
      };
    },
    createLoop(context) {
      const materializer: AgentMaterializer<OrchestratorRunRequest> = {
        async materialize(_materializationOrder, conditions) {
          materializations.value += 1;
          routes.push(conditions.aiRoute);
          const revision = context.result.nextRevision ?? context.request.signedWorkOrder.order.revision + 1;
          const nextRequest: OrchestratorRunRequest = {
            signedWorkOrder: signWorkOrder(order(revision, retries), "owner", privateKey),
            buildVector: vector(`repaired-${revision}`),
            moduleManifestFp: context.request.moduleManifestFp
          };
          return { artifact: nextRequest, artifactFp: d({ revision, sourceFp: nextRequest.buildVector.sourceFp }) };
        }
      };
      const guardians: GuardianComparator<OrchestratorRunRequest> = {
        async compare() { return { opposing: { value: 1 }, qc1: { value: 1 } }; }
      };
      const brain: BrainExecutionConditions = {
        async change(current) { return { ...current, generation: current.generation + 1 }; }
      };
      const rewident: Rewident<{}, OrchestratorRunRequest> = { async gather() { return {}; } };
      const harmonia: HarmoniaConflictWeigher<{}> = { async weigh() { return { action: "dalej" }; } };
      return new AutonomousMaterializationLoop(materializer, guardians, brain, rewident, harmonia, {
        maxAgentCorrections: 1,
        maxConditionChanges: 1
      });
    }
  });
}

describe("autonomous orchestrator runtime", () => {
  it("repairs a returned revision through the materialization loop and retries through OmniRoute by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "autonomous-runtime-"));
    try {
      const keys = generateKeyPairSync("ed25519");
      let validationCalls = 0;
      const runtime = makeRuntime(root, keys.publicKey, () => ++validationCalls === 1 ? "FAIL" : "PASS");
      const routes: string[] = [];
      const materializations = { value: 0 };
      const autonomous = new AutonomousOrchestratorRuntime(runtime, makeBridge(keys.privateKey, 2, routes, materializations));

      const result = await autonomous.run({
        signedWorkOrder: signWorkOrder(order(0, 2), "owner", keys.privateKey),
        buildVector: vector("broken"),
        moduleManifestFp: d("module")
      });

      expect(result.status).toBe("RELEASED");
      expect(result.candidate.revision).toBe(1);
      expect(validationCalls).toBe(2);
      expect(materializations.value).toBe(1);
      expect(routes).toEqual(["OmniRoute"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns only after the autonomous retry budget is exhausted", async () => {
    const root = await mkdtemp(join(tmpdir(), "autonomous-exhausted-"));
    try {
      const keys = generateKeyPairSync("ed25519");
      const runtime = makeRuntime(root, keys.publicKey, () => "FAIL");
      const materializations = { value: 0 };
      const autonomous = new AutonomousOrchestratorRuntime(runtime, makeBridge(keys.privateKey, 1, [], materializations));

      const result = await autonomous.run({
        signedWorkOrder: signWorkOrder(order(0, 1), "owner", keys.privateKey),
        buildVector: vector("still-broken"),
        moduleManifestFp: d("module")
      });

      expect(result.status).toBe("RETURNED");
      expect(result.candidate.revision).toBe(1);
      expect(result.reasons).toContain("Wyczerpano autonomiczną drabinę naprawy.");
      expect(materializations.value).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an autonomous retry that rewrites the canonical task instead of repairing materialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "autonomous-invariant-"));
    try {
      const keys = generateKeyPairSync("ed25519");
      const runtime = makeRuntime(root, keys.publicKey, () => "FAIL");
      const recovery = {
        async recover() {
          const changed = order(1, 1);
          changed.objective = "Nowy cel wymyślony podczas naprawy.";
          return {
            action: "retry" as const,
            request: {
              signedWorkOrder: signWorkOrder(changed, "owner", keys.privateKey),
              buildVector: vector("scope-drift"),
              moduleManifestFp: d("module")
            }
          };
        }
      };
      const autonomous = new AutonomousOrchestratorRuntime(runtime, recovery);

      await expect(autonomous.run({
        signedWorkOrder: signWorkOrder(order(0, 1), "owner", keys.privateKey),
        buildVector: vector("broken"),
        moduleManifestFp: d("module")
      })).rejects.toThrow("AUTONOMOUS_RETRY_SCOPE_CHANGED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
