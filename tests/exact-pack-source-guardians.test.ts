import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { Digest } from "../src/domain/ids.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import { signWorkOrder } from "../src/security/work-order-signature.js";
import { measureBuildVector } from "../src/build/tree-fingerprint.js";
import { createExactMaterializationPack } from "../src/engine/exact-materialization-pack.js";
import { ExactPackAgentMaterializer } from "../src/engine/exact-pack-agent-materializer.js";
import { ExactPackSourceGuardians } from "../src/engine/exact-pack-source-guardians.js";
import type { MaterializationOrder } from "../src/engine/autonomous-recovery.js";
import type { OrchestratorRunRequest } from "../src/orchestrator/orchestrator.js";

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
    taskId: "TASK-SOURCE-GUARDIANS",
    workspaceId: "WS-SOURCE-GUARDIANS",
    revision: 0,
    objective: "Sprawdź dokładną materializację przed buildem.",
    scope: { modules: ["core"], allowedPaths: ["src/**"] },
    requiredInputs: [],
    capabilities: ["repo.write"],
    budget: { timeSec: 600, costLimit: 5, retries: 2, maxDagDepth: 8 },
    requiredGates: ["unit"],
    expectedEvidence: ["dependency"],
    acceptanceCriteria: ["kontrola źródła przechodzi"],
    failureCriteria: ["kontrola źródła nie przechodzi"],
    securityContractRef: d("security"),
    performanceContractRef: d("performance"),
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release-v1", bundleHash: d("policy") }
  };
}

async function setup(root: string) {
  const before = "export const value = 0;\n";
  const after = "export const value = 1;\n";
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/a.ts"), before, "utf8");
  const measured = await measureBuildVector(root, extras);
  const keys = generateKeyPairSync("ed25519");
  const request: OrchestratorRunRequest = {
    signedWorkOrder: signWorkOrder(workOrder(), "owner", keys.privateKey),
    buildVector: measured.vector,
    moduleManifestFp: d("module")
  };
  const order: MaterializationOrder = {
    taskId: request.signedWorkOrder.order.taskId,
    instructions: "Zainstaluj dokładnie dostarczony plik.",
    allowedPaths: [...request.signedWorkOrder.order.scope.allowedPaths],
    suppliedMaterialFp: request.buildVector.sourceFp,
    expectedResult: "value = 1",
    initiative: "brak"
  };
  const pack = createExactMaterializationPack([{
    kind: "replace",
    path: "src/a.ts",
    content: after,
    beforeFp: raw(before),
    afterFp: raw(after)
  }]);
  const materializer = new ExactPackAgentMaterializer(root, request, { async next() { return pack; } });
  const result = await materializer.materialize(order, { agent: "Agent", aiRoute: "OmniRoute", generation: 0 });
  return { order, materializer, result };
}

describe("exact-pack pre-build guardians", () => {
  it("returns one/one when the exact materialization record and source QC both match", async () => {
    const root = await mkdtemp(join(tmpdir(), "source-guardians-pass-"));
    try {
      const { order, materializer, result } = await setup(root);
      const guardians = new ExactPackSourceGuardians(root, materializer, [{
        name: "shape",
        command: process.execPath,
        args: ["-e", "const fs=require('fs');const s=fs.readFileSync('src/a.ts','utf8');process.exit(s.includes('value = 1')?0:2)"],
        proposedSolution: "Przywróć dokładną treść dostarczonej paczki."
      }]);

      const comparison = await guardians.compare(order, result);
      expect(comparison.opposing).toEqual({ value: 1 });
      expect(comparison.qc1).toEqual({ value: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the process guardian at one but returns QC1 zero with a concrete correction when shape fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "source-guardians-fail-"));
    try {
      const { order, materializer, result } = await setup(root);
      const guardians = new ExactPackSourceGuardians(root, materializer, [{
        name: "shape",
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
        proposedSolution: "Zastosuj poprawioną paczkę, która spełnia test kształtu."
      }]);

      const comparison = await guardians.compare(order, result);
      expect(comparison.opposing).toEqual({ value: 1 });
      expect(comparison.qc1.value).toBe(0);
      if (comparison.qc1.value === 0) {
        expect(comparison.qc1.issue?.detectedBy).toBe("QC1");
        expect(comparison.qc1.issue?.actual).toBe("exit 7");
        expect(comparison.qc1.proposedSolution).toBe("Zastosuj poprawioną paczkę, która spełnia test kształtu.");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("binds the QC definition to command, args, limits and proposed correction", async () => {
    const root = await mkdtemp(join(tmpdir(), "source-guardians-fp-"));
    try {
      const { materializer } = await setup(root);
      const first = new ExactPackSourceGuardians(root, materializer, [{
        name: "shape",
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        proposedSolution: "Korekta A."
      }]);
      const second = new ExactPackSourceGuardians(root, materializer, [{
        name: "shape",
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        proposedSolution: "Korekta B."
      }]);
      expect(first.definitionFp()).not.toBe(second.definitionFp());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
