import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { Digest } from "../src/domain/ids.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import { signWorkOrder } from "../src/security/work-order-signature.js";
import { measureBuildVector } from "../src/build/tree-fingerprint.js";
import {
  applyExactMaterializationPack,
  createExactMaterializationPack,
  type ExactFileOperation
} from "../src/engine/exact-materialization-pack.js";
import { ExactPackAgentMaterializer } from "../src/engine/exact-pack-agent-materializer.js";
import type { MaterializationOrder } from "../src/engine/autonomous-recovery.js";
import type { OrchestratorRunRequest } from "../src/orchestrator/orchestrator.js";

const d = (value: unknown) => canonicalDigest(value);
const raw = (value: string): Digest => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function replace(path: string, before: string, after: string): ExactFileOperation {
  return { kind: "replace", path, content: after, beforeFp: raw(before), afterFp: raw(after) };
}

function workOrder(): WorkOrder {
  return {
    taskId: "TASK-EXACT-PACK",
    workspaceId: "WS-EXACT-PACK",
    revision: 0,
    objective: "Zainstaluj dokładnie dostarczony kod.",
    scope: { modules: ["core"], allowedPaths: ["src/**"] },
    requiredInputs: [],
    capabilities: ["repo.write"],
    budget: { timeSec: 600, costLimit: 5, retries: 2, maxDagDepth: 8 },
    requiredGates: ["unit"],
    expectedEvidence: ["dependency"],
    acceptanceCriteria: ["dokładny materiał został zainstalowany"],
    failureCriteria: ["jakiekolwiek odstępstwo od paczki"],
    securityContractRef: d("security"),
    performanceContractRef: d("performance"),
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release-v1", bundleHash: d("policy") }
  };
}

const extras = {
  dependencyFp: d("deps"),
  configFp: d("config"),
  generatedSourcesFp: d("generated"),
  toolchainFp: d("toolchain"),
  buildEnvironmentFp: d("environment")
};

async function initialRequest(root: string): Promise<OrchestratorRunRequest> {
  const keys = generateKeyPairSync("ed25519");
  const measured = await measureBuildVector(root, extras);
  return {
    signedWorkOrder: signWorkOrder(workOrder(), "owner", keys.privateKey),
    buildVector: measured.vector,
    moduleManifestFp: d("module")
  };
}

function materializationOrder(request: OrchestratorRunRequest): MaterializationOrder {
  return {
    taskId: request.signedWorkOrder.order.taskId,
    instructions: "Zainstaluj wyłącznie przekazaną paczkę plików.",
    allowedPaths: [...request.signedWorkOrder.order.scope.allowedPaths],
    suppliedMaterialFp: request.buildVector.sourceFp,
    expectedResult: "Drzewo źródłowe odpowiada dokładnie paczce.",
    initiative: "brak"
  };
}

describe("exact materialization pack", () => {
  it("replaces an allowed file only when the before and after fingerprints are exact", async () => {
    const root = await mkdtemp(join(tmpdir(), "exact-pack-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/a.ts"), "old", "utf8");
      const pack = createExactMaterializationPack([replace("src/a.ts", "old", "new")]);

      const receipts = await applyExactMaterializationPack(root, ["src/**"], pack);
      expect(await readFile(join(root, "src/a.ts"), "utf8")).toBe("new");
      expect(receipts).toEqual([{ path: "src/a.ts", kind: "replace", beforeFp: raw("old"), afterFp: raw("new") }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed on a stale source file and leaves it untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "exact-pack-stale-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/a.ts"), "actual", "utf8");
      const pack = createExactMaterializationPack([replace("src/a.ts", "expected", "new")]);

      await expect(applyExactMaterializationPack(root, ["src/**"], pack)).rejects.toThrow("MATERIALIZATION_BEFORE_FINGERPRINT_MISMATCH:src/a.ts");
      expect(await readFile(join(root, "src/a.ts"), "utf8")).toBe("actual");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects writes outside the signed scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "exact-pack-scope-"));
    try {
      const operation: ExactFileOperation = { kind: "create", path: "secrets/key.txt", content: "x", afterFp: raw("x") };
      const pack = createExactMaterializationPack([operation]);
      await expect(applyExactMaterializationPack(root, ["src/**"], pack)).rejects.toThrow("MATERIALIZATION_PATH_OUT_OF_SCOPE:secrets/key.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a pack whose declared fingerprint no longer matches its exact content", async () => {
    const root = await mkdtemp(join(tmpdir(), "exact-pack-fp-"));
    try {
      const pack = createExactMaterializationPack([{ kind: "create", path: "src/a.ts", content: "A", afterFp: raw("A") }]);
      const tampered = { ...pack, operations: [{ ...pack.operations[0]!, content: "B" }] };
      await expect(applyExactMaterializationPack(root, ["src/**"], tampered)).rejects.toThrow("MATERIALIZATION_PACK_FINGERPRINT_MISMATCH");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("materializes a real source tree and returns a remeasured request for pre-build QC", async () => {
    const root = await mkdtemp(join(tmpdir(), "exact-pack-agent-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/a.ts"), "old", "utf8");
      const initial = await initialRequest(root);
      const pack = createExactMaterializationPack([replace("src/a.ts", "old", "new")]);
      const materializer = new ExactPackAgentMaterializer(root, initial, {
        async next() { return pack; }
      });

      const result = await materializer.materialize(
        materializationOrder(initial),
        { agent: "Agent", aiRoute: "OmniRoute", generation: 0 }
      );
      const measured = await measureBuildVector(root, extras);

      expect(await readFile(join(root, "src/a.ts"), "utf8")).toBe("new");
      expect(result.artifact.buildVector.sourceFp).toBe(measured.vector.sourceFp);
      expect(result.artifact.buildVector.sourceFp).not.toBe(initial.buildVector.sourceFp);
      expect(result.artifact.signedWorkOrder).toEqual(initial.signedWorkOrder);
      expect(materializer.records()).toHaveLength(1);
      expect(materializer.records()[0]?.conditions.aiRoute).toBe("OmniRoute");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
