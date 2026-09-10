import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import { freezeCandidate } from "../src/domain/candidate.js";
import type { BuildId } from "../src/domain/ids.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import { signWorkOrder } from "../src/security/work-order-signature.js";
import {
  AutonomousMaterializationLoop,
  type AgentMaterializer,
  type BrainExecutionConditions,
  type GuardianComparator,
  type HarmoniaConflictWeigher,
  type Rewident
} from "../src/engine/materialization-loop.js";
import type { OrchestratorRunRequest, OrchestratorRunResult } from "../src/orchestrator/orchestrator.js";
import {
  PreBuildMaterializationRuntime,
  type OrchestratorRunner
} from "../src/orchestrator/prebuild-materialization.js";

const d = (value: unknown) => canonicalDigest(value);

function workOrder(): WorkOrder {
  return {
    taskId: "TASK-PREBUILD",
    workspaceId: "WS-PREBUILD",
    revision: 0,
    objective: "Zmaterializuj dokładnie zatwierdzony element przed zamrożeniem kandydata.",
    scope: { modules: ["core"], allowedPaths: ["src/**"] },
    requiredInputs: [{ uri: "repo://source", digest: d("source-contract") }],
    capabilities: ["repo.write"],
    budget: { timeSec: 600, costLimit: 5, retries: 2, maxDagDepth: 8 },
    requiredGates: ["unit"],
    expectedEvidence: ["dependency"],
    acceptanceCriteria: ["element przechodzi kontrolę przed buildem"],
    failureCriteria: ["strażnicy odrzucają materializację"],
    securityContractRef: d("security"),
    performanceContractRef: d("performance"),
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release-v1", bundleHash: d("policy") }
  };
}

function request(): OrchestratorRunRequest {
  const keys = generateKeyPairSync("ed25519");
  return {
    signedWorkOrder: signWorkOrder(workOrder(), "owner", keys.privateKey),
    buildVector: {
      sourceFp: d("source-before"),
      dependencyFp: d("deps"),
      configFp: d("config"),
      generatedSourcesFp: d("generated"),
      toolchainFp: d("toolchain"),
      buildEnvironmentFp: d("environment")
    },
    moduleManifestFp: d("module")
  };
}

function downstreamResult(received: OrchestratorRunRequest): OrchestratorRunResult {
  const order = received.signedWorkOrder.order;
  const candidate = freezeCandidate(
    {
      taskId: order.taskId,
      workspaceId: order.workspaceId,
      buildId: "BUILD-PREBUILD" as BuildId,
      revision: order.revision
    },
    {
      sourceFp: received.buildVector.sourceFp,
      dependencyFp: received.buildVector.dependencyFp,
      configFp: received.buildVector.configFp,
      toolchainFp: received.buildVector.toolchainFp,
      buildEnvironmentFp: received.buildVector.buildEnvironmentFp,
      moduleManifestFp: received.moduleManifestFp,
      artifactFp: d("artifact")
    },
    "2026-09-10T09:00:00.000Z"
  );
  return { status: "RELEASED", candidate, receipts: [] };
}

function makeLoop(
  initial: OrchestratorRunRequest,
  mode: "pass" | "repeat-fail" | "rewrite-order"
): AutonomousMaterializationLoop<OrchestratorRunRequest, {}> {
  const materializer: AgentMaterializer<OrchestratorRunRequest> = {
    async materialize() {
      let artifact: OrchestratorRunRequest = {
        ...initial,
        buildVector: { ...initial.buildVector, sourceFp: d("source-after-materialization") }
      };
      if (mode === "rewrite-order") {
        artifact = {
          ...artifact,
          signedWorkOrder: {
            ...artifact.signedWorkOrder,
            order: { ...artifact.signedWorkOrder.order, objective: "Agent przepisał cel." }
          }
        };
      }
      return { artifact, artifactFp: d(artifact) };
    }
  };

  const issue = {
    element: "core",
    location: "src/core.ts",
    kind: "niezgodność materializacji",
    expected: "A",
    actual: "B",
    detectedBy: "Zespół przeciwny" as const
  };
  const guardians: GuardianComparator<OrchestratorRunRequest> = {
    async compare() {
      if (mode !== "repeat-fail") return { opposing: { value: 1 }, qc1: { value: 1 } };
      return {
        opposing: { value: 0, issue, reason: "Ta sama niezgodność.", proposedSolution: "Zastosuj dostarczoną korektę." },
        qc1: {
          value: 0,
          issue: { ...issue, detectedBy: "QC1" as const },
          reason: "Kształt nadal nie pasuje.",
          proposedSolution: "Zastosuj dostarczoną korektę."
        }
      };
    }
  };
  const brain: BrainExecutionConditions = {
    async change(current) { return { ...current, generation: current.generation + 1 }; }
  };
  const rewident: Rewident<{}, OrchestratorRunRequest> = { async gather() { return {}; } };
  const harmonia: HarmoniaConflictWeigher<{}> = { async weigh() { return { action: "dalej" }; } };

  return new AutonomousMaterializationLoop(materializer, guardians, brain, rewident, harmonia, {
    maxAgentCorrections: 1,
    maxConditionChanges: 0
  });
}

describe("pre-build materialization runtime", () => {
  it("materializes and passes QC before invoking the build/freeze runtime", async () => {
    const initial = request();
    let downstreamCalls = 0;
    let received: OrchestratorRunRequest | undefined;
    const downstream: OrchestratorRunner = {
      async run(next) {
        downstreamCalls += 1;
        received = next;
        return downstreamResult(next);
      }
    };
    const runtime = new PreBuildMaterializationRuntime(downstream, {
      createLoop: () => makeLoop(initial, "pass"),
      materializationOrder: () => ({
        taskId: initial.signedWorkOrder.order.taskId,
        instructions: "Zainstaluj dokładnie dostarczony element.",
        allowedPaths: [...initial.signedWorkOrder.order.scope.allowedPaths],
        suppliedMaterialFp: initial.buildVector.sourceFp,
        expectedResult: "Element zgodny z poleceniem.",
        initiative: "brak"
      })
    });

    const result = await runtime.run(initial);
    expect(result.status).toBe("EXECUTED");
    expect(downstreamCalls).toBe(1);
    expect(received?.buildVector.sourceFp).toBe(d("source-after-materialization"));
    if (result.status === "EXECUTED") {
      expect(result.result.candidate.sourceFp).toBe(d("source-after-materialization"));
      expect(result.trace.at(-1)?.action).toBe("dalej");
    }
  });

  it("does not build or freeze anything when the pre-build repair ladder is exhausted", async () => {
    const initial = request();
    let downstreamCalls = 0;
    const downstream: OrchestratorRunner = {
      async run(next) {
        downstreamCalls += 1;
        return downstreamResult(next);
      }
    };
    const runtime = new PreBuildMaterializationRuntime(downstream, {
      createLoop: () => makeLoop(initial, "repeat-fail"),
      materializationOrder: () => ({
        taskId: initial.signedWorkOrder.order.taskId,
        instructions: "Zainstaluj dokładnie dostarczony element.",
        allowedPaths: [...initial.signedWorkOrder.order.scope.allowedPaths],
        suppliedMaterialFp: initial.buildVector.sourceFp,
        expectedResult: "Element zgodny z poleceniem.",
        initiative: "brak"
      })
    });

    const result = await runtime.run(initial);
    expect(result.status).toBe("PREBUILD_BLOCKED");
    expect(downstreamCalls).toBe(0);
    expect(result.trace.length).toBe(2);
    expect(result.trace.at(-1)?.action).toBe("zmień warunki wykonania");
  });

  it("blocks any attempt to rewrite the signed task during pre-build materialization", async () => {
    const initial = request();
    let downstreamCalls = 0;
    const downstream: OrchestratorRunner = {
      async run(next) {
        downstreamCalls += 1;
        return downstreamResult(next);
      }
    };
    const runtime = new PreBuildMaterializationRuntime(downstream, {
      createLoop: () => makeLoop(initial, "rewrite-order"),
      materializationOrder: () => ({
        taskId: initial.signedWorkOrder.order.taskId,
        instructions: "Zainstaluj dokładnie dostarczony element.",
        allowedPaths: [...initial.signedWorkOrder.order.scope.allowedPaths],
        suppliedMaterialFp: initial.buildVector.sourceFp,
        expectedResult: "Element zgodny z poleceniem.",
        initiative: "brak"
      })
    });

    await expect(runtime.run(initial)).rejects.toThrow("PREBUILD_WORK_ORDER_CHANGED");
    expect(downstreamCalls).toBe(0);
  });
});
