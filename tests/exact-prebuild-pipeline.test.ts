import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import { freezeCandidate } from "../src/domain/candidate.js";
import type { BuildId, Digest } from "../src/domain/ids.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import { signWorkOrder } from "../src/security/work-order-signature.js";
import { measureBuildVector } from "../src/build/tree-fingerprint.js";
import { createExactMaterializationPack, type ExactMaterializationPack } from "../src/engine/exact-materialization-pack.js";
import type { BrainExecutionConditions, HarmoniaConflictWeigher, Rewident } from "../src/engine/materialization-loop.js";
import type { OrchestratorRunRequest, OrchestratorRunResult } from "../src/orchestrator/orchestrator.js";
import { ExactPreBuildPipeline } from "../src/orchestrator/exact-prebuild-pipeline.js";
import type { OrchestratorRunner } from "../src/orchestrator/prebuild-materialization.js";

const d = (value: unknown) => canonicalDigest(value);
const raw = (value: string): Digest => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const extras = {
  dependencyFp: d("deps"),
  configFp: d("config"),
  generatedSourcesFp: d("generated"),
  toolchainFp: d("toolchain"),
  buildEnvironmentFp: d("environment")
};

function workOrder(): WorkOrder {
  return {
    taskId: "TASK-EXACT-PREBUILD",
    workspaceId: "WS-EXACT-PREBUILD",
    revision: 0,
    objective: "Złóż dokładny materiał przed buildem.",
    scope: { modules: ["core"], allowedPaths: ["src/**"] },
    requiredInputs: [],
    capabilities: ["repo.write"],
    budget: { timeSec: 600, costLimit: 5, retries: 3, maxDagDepth: 8 },
    requiredGates: ["unit"],
    expectedEvidence: ["dependency"],
    acceptanceCriteria: ["value = 2 przed buildem"],
    failureCriteria: ["niezgodny kształt źródła"],
    securityContractRef: d("security"),
    performanceContractRef: d("performance"),
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release-v1", bundleHash: d("policy") }
  };
}

async function request(root: string): Promise<OrchestratorRunRequest> {
  const keys = generateKeyPairSync("ed25519");
  const measured = await measureBuildVector(root, extras);
  return {
    signedWorkOrder: signWorkOrder(workOrder(), "owner", keys.privateKey),
    buildVector: measured.vector,
    moduleManifestFp: d("module")
  };
}

function replacePack(before: string, after: string): ExactMaterializationPack {
  return createExactMaterializationPack([{
    kind: "replace",
    path: "src/a.ts",
    content: after,
    beforeFp: raw(before),
    afterFp: raw(after)
  }]);
}

function released(received: OrchestratorRunRequest): OrchestratorRunResult {
  const order = received.signedWorkOrder.order;
  const candidate = freezeCandidate(
    {
      taskId: order.taskId,
      workspaceId: order.workspaceId,
      buildId: "BUILD-EXACT-PREBUILD" as BuildId,
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
    "2026-09-10T09:30:00.000Z"
  );
  return { status: "RELEASED", candidate, receipts: [] };
}

function qc1() {
  return [{
    name: "shape",
    command: process.execPath,
    args: ["-e", "const fs=require('fs');const s=fs.readFileSync('src/a.ts','utf8');process.exit(s.includes('value = 2')?0:9)"],
    proposedSolution: "Zastosuj dokładną korektę ustawiającą value = 2."
  }];
}

const brain: BrainExecutionConditions = {
  async change(current) { return { ...current, generation: current.generation + 1 }; }
};

describe("exact pre-build pipeline", () => {
  it("repairs source before downstream build/freeze and invokes downstream only after one/one", async () => {
    const root = await mkdtemp(join(tmpdir(), "exact-prebuild-pipeline-"));
    try {
      const v0 = "export const value = 0;\n";
      const v1 = "export const value = 1;\n";
      const v2 = "export const value = 2;\n";
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/a.ts"), v0, "utf8");
      const initial = await request(root);
      const packs = [replacePack(v0, v1), replacePack(v1, v2)];
      let packIndex = 0;
      let downstreamCalls = 0;
      let rewidentCalls = 0;

      const downstream: OrchestratorRunner = {
        async run(next) {
          downstreamCalls += 1;
          expect(await readFile(join(root, "src/a.ts"), "utf8")).toBe(v2);
          return released(next);
        }
      };
      const rewident: Rewident<{}, OrchestratorRunRequest> = {
        async gather() { rewidentCalls += 1; return {}; }
      };
      const harmonia: HarmoniaConflictWeigher<{}> = {
        async weigh() { return { action: "dalej" }; }
      };
      const pipeline = new ExactPreBuildPipeline(downstream, {
        sourceDir: root,
        packSource: () => ({ async next() { return packs[packIndex++]!; } }),
        qc1: () => qc1(),
        instructions: () => "Zainstaluj dokładnie dostarczony kod; bez własnej inicjatywy.",
        expectedResult: () => "value = 2",
        brain,
        rewident,
        harmonia,
        maxAgentCorrections: 2,
        maxConditionChanges: 1
      });

      const outcome = await pipeline.run(initial);
      expect(outcome.status).toBe("EXECUTED");
      expect(downstreamCalls).toBe(1);
      expect(rewidentCalls).toBe(0);
      expect(packIndex).toBe(2);
      if (outcome.status === "EXECUTED") {
        expect(outcome.trace.map((entry) => entry.action)).toEqual(["do agenta", "dalej"]);
        expect(outcome.result.candidate.sourceFp).not.toBe(initial.buildVector.sourceFp);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("invokes Rewident only when the same guardian conflict survives the second approach", async () => {
    const root = await mkdtemp(join(tmpdir(), "exact-prebuild-rewident-"));
    try {
      const v0 = "export const value = 0;\n";
      const v1 = "export const value = 1;\n";
      const v2 = "export const value = 2;\n";
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/a.ts"), v0, "utf8");
      const initial = await request(root);
      const packs = [replacePack(v0, v1), replacePack(v1, v1), replacePack(v1, v2)];
      let packIndex = 0;
      let rewidentCalls = 0;
      let harmoniaCalls = 0;
      let downstreamCalls = 0;

      const downstream: OrchestratorRunner = {
        async run(next) { downstreamCalls += 1; return released(next); }
      };
      const rewident: Rewident<{ conflict: true }, OrchestratorRunRequest> = {
        async gather() { rewidentCalls += 1; return { conflict: true }; }
      };
      const harmonia: HarmoniaConflictWeigher<{ conflict: true }> = {
        async weigh() {
          harmoniaCalls += 1;
          return { action: "do agenta", correction: "Zastosuj dostarczoną korektę value = 2." };
        }
      };
      const pipeline = new ExactPreBuildPipeline(downstream, {
        sourceDir: root,
        packSource: () => ({ async next() { return packs[packIndex++]!; } }),
        qc1: () => qc1(),
        instructions: () => "Zainstaluj dokładnie dostarczony kod; bez własnej inicjatywy.",
        expectedResult: () => "value = 2",
        brain,
        rewident,
        harmonia,
        maxAgentCorrections: 3,
        maxConditionChanges: 1
      });

      const outcome = await pipeline.run(initial);
      expect(outcome.status).toBe("EXECUTED");
      expect(rewidentCalls).toBe(1);
      expect(harmoniaCalls).toBe(1);
      expect(downstreamCalls).toBe(1);
      expect(packIndex).toBe(3);
      expect(await readFile(join(root, "src/a.ts"), "utf8")).toBe(v2);
      if (outcome.status === "EXECUTED") {
        expect(outcome.trace.map((entry) => entry.action)).toEqual(["do agenta", "Rewident", "dalej"]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
