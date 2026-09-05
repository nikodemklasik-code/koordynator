import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import { signWorkOrder } from "../src/security/work-order-signature.js";
import { FileStateStore } from "../src/store/file-state-store.js";
import { FileSignedWorkOrderStore } from "../src/store/work-order-store.js";
import { FileTaskExecutionStore } from "../src/store/task-execution-store.js";
import { MemoryArtifactRegistry } from "../src/build/memory-artifact-registry.js";
import type { BuildInputVector } from "../src/build/build-input.js";
import type { HermeticBuilder } from "../src/build/hermetic-builder.js";
import type { Validator } from "../src/validators/validation-dag.js";
import { MemoryReleaseStore, ReleaseController } from "../src/release/release-controller.js";
import { OrchestratorRuntime } from "../src/orchestrator/orchestrator.js";
import { createControlServer } from "../src/control/server.js";

const d = (value: unknown) => canonicalDigest(value);
const policyA = d("policy-A");
const policyB = d("policy-B");
const policyC = d("policy-C");

function vector(seed: string): BuildInputVector {
  return {
    sourceFp: d(`source:${seed}`), dependencyFp: d("deps"), configFp: d("config"),
    toolchainFp: d("toolchain"), buildEnvironmentFp: d("env"), generatedSourcesFp: d("generated")
  };
}

function order(revision: number, policy: `sha256:${string}`): WorkOrder {
  return {
    taskId: "TASK-RETURN", workspaceId: "WS-RETURN", revision, objective: "Recover returned candidate",
    scope: { modules: ["payment-service"], allowedPaths: ["src/**"] }, requiredInputs: [], capabilities: ["repo.write"],
    budget: { timeSec: 600, costLimit: 5, retries: 2, maxDagDepth: 8 }, requiredGates: ["unit", "security"],
    expectedEvidence: ["security"], acceptanceCriteria: ["required gates pass"], failureCriteria: ["required gate fails"],
    securityContractRef: d("security"), performanceContractRef: d("performance"), rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS", policyRef: { policyId: "release-policy", bundleHash: policy }
  };
}

const builder: HermeticBuilder = {
  async build(input) {
    return { bytes: Buffer.from(JSON.stringify(input)), sbomFp: d("sbom"), provenanceFp: d(input), builderIdentityFp: d("builder") };
  }
};

function validator(gate: "unit" | "security"): Validator {
  return {
    gate,
    async validate(context) {
      return {
        status: "PASS", kind: gate === "security" ? "security" : "dependency",
        validUntil: "2099-01-01T00:00:00.000Z", testDefinitionFp: d({ gate, test: 1 }), fixtureFp: d({ gate, fixture: 1 }), validatorVersionFp: d({ gate, validator: 1 })
      };
    }
  };
}

describe("Control Targeted Return screen", () => {
  it("projects STALE_POLICY, refuses stale draft, and generates revision N+1 only with current policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-return-"));
    try {
      const keys = generateKeyPairSync("ed25519");
      const clockValues = Array.from({ length: 40 }, (_, index) => new Date(Date.UTC(2026, 8, 5, 9, 0, index)).toISOString());
      let tick = 0;
      const clock = () => clockValues[tick++] ?? new Date(Date.UTC(2026, 8, 5, 9, 10, tick++)).toISOString();
      const stateRoot = join(root, "state");
      const workOrderRoot = join(root, "work-orders");
      const executionRoot = join(root, "executions");
      const runtime = new OrchestratorRuntime(
        new FileStateStore(stateRoot), new MemoryArtifactRegistry(), builder,
        [validator("unit"), validator("security")],
        new ReleaseController(new MemoryReleaseStore(), (digest) => ({ signatureFp: d(digest) }), clock),
        () => keys.publicKey, clock, () => true,
        new FileSignedWorkOrderStore(workOrderRoot), new FileTaskExecutionStore(executionRoot)
      );

      const first = await runtime.run({
        signedWorkOrder: signWorkOrder(order(0, policyA), "owner", keys.privateKey), buildVector: vector("r0"), moduleManifestFp: d("module")
      });
      expect(first.status).toBe("RELEASED");

      const returned = await runtime.run({
        signedWorkOrder: signWorkOrder(order(1, policyB), "owner", keys.privateKey), buildVector: vector("r1"), moduleManifestFp: d("module")
      });
      expect(returned.status).toBe("RETURNED");
      expect(returned.reasons).toContain("STALE_POLICY");
      expect(returned.nextRevision).toBe(2);

      const server = createControlServer({ stateDir: root, webRoot: join(process.cwd(), "web", "control"), environment: "TEST" });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("CONTROL_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;
      try {
        const projectedResponse = await fetch(`${base}/api/tasks/TASK-RETURN/return`);
        expect(projectedResponse.status).toBe(200);
        const projected = await projectedResponse.json();
        expect(projected.primaryReason).toBe("STALE_POLICY");
        expect(projected.previousPolicyFp).toBe(policyB);
        expect(projected.evidenceReusable).toBe(false);
        expect(projected.requiredAction).toBe("REVALIDATE_WITH_CURRENT_POLICY");
        expect(projected.nextRevision).toBe(2);
        expect(projected.nextRevisionSigned).toBe(false);

        const blocked = await fetch(`${base}/api/tasks/TASK-RETURN/next-work-order`);
        expect(blocked.status).toBe(400);
        expect((await blocked.json()).error).toBe("CURRENT_POLICY_FP_REQUIRED");

        const draftResponse = await fetch(`${base}/api/tasks/TASK-RETURN/next-work-order?policyFp=${encodeURIComponent(policyC)}`);
        expect(draftResponse.status).toBe(200);
        const draft = await draftResponse.json();
        expect(draft.persisted).toBe(false);
        expect(draft.safeToSign).toBe(true);
        expect(draft.draft.taskId).toBe("TASK-RETURN");
        expect(draft.draft.revision).toBe(2);
        expect(draft.draft.policyRef.bundleHash).toBe(policyC);

        const page = await fetch(`${base}/tasks/TASK-RETURN/return`).then((response) => response.text());
        expect(page).toContain("TARGETED RETURN");
        expect(page).toContain("NEXT WORK ORDER");
        expect(page).not.toContain("ETH");
        expect(page).not.toContain("payment required");

        const denied = await fetch(`${base}/api/tasks/TASK-RETURN/return`, { method: "POST" });
        expect(denied.status).toBe(405);
      } finally {
        server.close();
        await once(server, "close");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
