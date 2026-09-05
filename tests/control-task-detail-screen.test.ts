import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import type { BuildInputVector } from "../src/build/build-input.js";
import type { HermeticBuilder } from "../src/build/hermetic-builder.js";
import type { Validator } from "../src/validators/validation-dag.js";
import { signWorkOrder } from "../src/security/work-order-signature.js";
import { FileStateStore } from "../src/store/file-state-store.js";
import { FileSignedWorkOrderStore } from "../src/store/work-order-store.js";
import { FileTaskExecutionStore } from "../src/store/task-execution-store.js";
import { MemoryArtifactRegistry } from "../src/build/memory-artifact-registry.js";
import { MemoryReleaseStore, ReleaseController } from "../src/release/release-controller.js";
import { OrchestratorRuntime } from "../src/orchestrator/orchestrator.js";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];
const d = (value: unknown) => canonicalDigest(value);

function vector(): BuildInputVector {
  return {
    sourceFp: d("detail-source"),
    dependencyFp: d("detail-deps"),
    configFp: d("detail-config"),
    toolchainFp: d("detail-toolchain"),
    buildEnvironmentFp: d("detail-env"),
    generatedSourcesFp: d("detail-generated")
  };
}

function order(): WorkOrder {
  return {
    taskId: "TASK-DETAIL",
    workspaceId: "WS-DETAIL",
    revision: 1,
    objective: "Build a real task-detail candidate",
    scope: { modules: ["hello-module"], allowedPaths: ["examples/hello-module/**"] },
    requiredInputs: [],
    capabilities: ["core.echo"],
    budget: { timeSec: 300, costLimit: 0, retries: 1, maxDagDepth: 4 },
    requiredGates: ["unit", "security"],
    expectedEvidence: ["dependency", "security"],
    acceptanceCriteria: ["candidate and release identity match"],
    failureCriteria: ["any required receipt is not PASS"],
    securityContractRef: d("security-contract"),
    performanceContractRef: d("performance-contract"),
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release-v1", bundleHash: d("policy-v1") }
  };
}

function validator(gate: "unit" | "security"): Validator {
  return {
    gate,
    async validate(context) {
      return {
        status: "PASS",
        kind: gate === "security" ? "security" : "dependency",
        validUntil: new Date(new Date(context.now).getTime() + 3_600_000).toISOString(),
        testDefinitionFp: d({ gate, test: 1 }),
        fixtureFp: d({ gate, fixture: 1 }),
        validatorVersionFp: d({ gate, version: 1 })
      };
    }
  };
}

function builder(): HermeticBuilder {
  return {
    async build(input) {
      return {
        bytes: Buffer.from(JSON.stringify(input), "utf8"),
        sbomFp: d("detail-sbom"),
        provenanceFp: d({ input, provenance: 1 }),
        builderIdentityFp: d("detail-builder")
      };
    }
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Control UI task detail end to end", () => {
  it("persists a real runtime execution and serves the task detail projection and screen", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-detail-"));
    roots.push(root);
    const keys = generateKeyPairSync("ed25519");
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 8, 5, 8, 0, tick++)).toISOString();
    const executionStore = new FileTaskExecutionStore(join(root, "executions"));
    const workOrderStore = new FileSignedWorkOrderStore(join(root, "work-orders"));
    const releaseStore = new MemoryReleaseStore();
    const runtime = new OrchestratorRuntime(
      new FileStateStore(join(root, "state")),
      new MemoryArtifactRegistry(),
      builder(),
      [validator("unit"), validator("security")],
      new ReleaseController(releaseStore, (digest) => ({ signatureFp: d({ digest, key: "release" }) }), clock),
      () => keys.publicKey,
      clock,
      undefined,
      workOrderStore,
      executionStore
    );

    const result = await runtime.run({
      signedWorkOrder: signWorkOrder(order(), "owner-key", keys.privateKey),
      buildVector: vector(),
      moduleManifestFp: d("hello-module-manifest"),
      promoteToProduction: true
    });

    expect(result.status).toBe("RELEASED");
    const persisted = await executionStore.get("TASK-DETAIL", 1);
    expect(persisted?.candidate.candidateSha).toBe(result.candidate.candidateSha);
    expect(persisted?.receipts.map((receipt) => receipt.status)).toEqual(["PASS", "PASS"]);
    expect(persisted?.release?.release.manifest.artifactFp).toBe(result.candidate.artifactFp);

    const server = createControlServer({
      stateDir: root,
      environment: "PROD-EU-1",
      region: "eu-west-1",
      zone: "1a",
      operator: "operator@koordynator.local",
      ciVerify: "PASS",
      version: "0.2.0"
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${address.port}`;
      const detailResponse = await fetch(`${base}/api/tasks/TASK-DETAIL/detail`);
      expect(detailResponse.status).toBe(200);
      const detail = await detailResponse.json() as {
        task: { taskId: string; state: string; target: string };
        executionStatus: string;
        candidate: { candidateSha: string; artifactFp: string };
        receipts: Array<{ gate: string; status: string }>;
        release: { release: { manifest: { candidateSha: string; artifactFp: string } } };
        history: Array<{ state: string }>;
        buildMode: string;
      };
      expect(detail.task).toMatchObject({ taskId: "TASK-DETAIL", state: "RELEASED", target: "hello-module" });
      expect(detail.executionStatus).toBe("RELEASED");
      expect(detail.buildMode).toBe("BUILD");
      expect(detail.history.map((item) => item.state)).toContain("CANDIDATE_FROZEN");
      expect(detail.receipts).toEqual(expect.arrayContaining([
        expect.objectContaining({ gate: "unit", status: "PASS" }),
        expect.objectContaining({ gate: "security", status: "PASS" })
      ]));
      expect(detail.release.release.manifest.candidateSha).toBe(detail.candidate.candidateSha);
      expect(detail.release.release.manifest.artifactFp).toBe(detail.candidate.artifactFp);

      const page = await fetch(`${base}/tasks/TASK-DETAIL`).then((response) => response.text());
      expect(page).toContain("TASK DETAIL");
      expect(page).toContain("CANDIDATE FREEZE");
      expect(page).toContain("EVIDENCE RECEIPTS");
      expect(page).toContain("LOCK &amp; IMMUTABILITY");

      const js = await fetch(`${base}/task.js`).then((response) => response.text());
      expect(js).toContain("/detail");
      expect(js).toContain("RELEASE MATCHES FROZEN CANDIDATE");

      const denied = await fetch(`${base}/api/tasks/TASK-DETAIL/detail`, { method: "POST" });
      expect(denied.status).toBe(405);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
