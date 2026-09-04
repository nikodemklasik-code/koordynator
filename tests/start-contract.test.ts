import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import { validateWorkOrder } from "../src/domain/work-order.js";
import { signWorkOrder } from "../src/security/work-order-signature.js";
import { MemoryArtifactRegistry } from "../src/build/memory-artifact-registry.js";
import type { BuildInputVector } from "../src/build/build-input.js";
import { buildKey } from "../src/build/build-input.js";
import { buildOrReuse } from "../src/build/build-or-reuse.js";
import type { HermeticBuilder } from "../src/build/hermetic-builder.js";
import { FileStateStore } from "../src/store/file-state-store.js";
import { FileSignedWorkOrderStore } from "../src/store/work-order-store.js";
import type { Validator } from "../src/validators/validation-dag.js";
import { MemoryReleaseStore, ReleaseController } from "../src/release/release-controller.js";
import { OrchestratorRuntime } from "../src/orchestrator/orchestrator.js";

const d = (value: unknown) => canonicalDigest(value);

function vector(): BuildInputVector {
  return {
    sourceFp: d("source"), dependencyFp: d("deps"), configFp: d("config"),
    toolchainFp: d("toolchain"), buildEnvironmentFp: d("env"), generatedSourcesFp: d("generated")
  };
}

function order(revision: number, policy: string): WorkOrder {
  return {
    taskId: "TASK-START", workspaceId: "WS-START", revision, objective: "Prove start contract",
    scope: { modules: ["hello"], allowedPaths: ["src/**"] }, requiredInputs: [], capabilities: ["repo.write"],
    budget: { timeSec: 60, costLimit: 0, retries: 1, maxDagDepth: 4 }, requiredGates: ["unit", "security"],
    expectedEvidence: ["dependency", "security"], acceptanceCriteria: ["pass"], failureCriteria: ["gate fail"],
    securityContractRef: d("security"), performanceContractRef: d("performance"), rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS", policyRef: { policyId: "release-v1", bundleHash: d(policy) }
  };
}

function builder(counter: { value: number }): HermeticBuilder {
  return {
    async build(input) {
      counter.value += 1;
      return {
        bytes: Buffer.from(JSON.stringify({ input, build: counter.value })),
        sbomFp: d("sbom"), provenanceFp: d(input), builderIdentityFp: d("builder")
      };
    }
  };
}

function validator(gate: "unit" | "security"): Validator {
  return {
    gate,
    async validate(context) {
      return {
        status: "PASS",
        kind: gate === "security" ? "security" : "dependency",
        validUntil: new Date(new Date(context.now).getTime() + 60_000).toISOString(),
        testDefinitionFp: d({ gate, test: 1 }), fixtureFp: d({ gate, fixture: 1 }), validatorVersionFp: d("validator-v1")
      };
    }
  };
}

describe("P0 start contract", () => {
  it("cache reuse is fail-closed when attestation is corrupt", async () => {
    const registry = new MemoryArtifactRegistry();
    const count = { value: 0 };
    const input = vector();
    expect((await buildOrReuse(input, registry, builder(count))).mode).toBe("BUILD");
    const cached = await registry.get(buildKey(input));
    if (!cached) throw new Error("missing cache");
    await registry.put({ ...cached, signedAttestationFp: d("forged") });
    expect((await buildOrReuse(input, registry, builder(count))).mode).toBe("BUILD");
    expect(count.value).toBe(2);
  });

  it("freeze guard rejects artifact bytes/fingerprint mutation after freeze", async () => {
    const registry = new MemoryArtifactRegistry();
    const input = vector();
    const built = await buildOrReuse(input, registry, builder({ value: 0 }));
    await registry.freeze(buildKey(input), built.artifact.artifactFp);
    const frozen = await registry.get(buildKey(input));
    if (!frozen) throw new Error("missing frozen artifact");
    await expect(registry.put({ ...frozen, bytes: Buffer.from("mutated"), artifactFp: d("mutated") })).rejects.toThrow("FROZEN_ARTIFACT_MUTATION_DENIED");
    await expect(registry.revoke(buildKey(input))).rejects.toThrow("FROZEN_ARTIFACT_MUTATION_DENIED");
  });

  it("strict WorkOrder validation rejects payload outside schema", () => {
    const valid = order(0, "policy-a");
    expect(() => validateWorkOrder(valid)).not.toThrow();
    const withExtra = { ...valid, prompt: "free text bypass" } as WorkOrder;
    expect(() => validateWorkOrder(withExtra)).toThrow(/WORK_ORDER_SCHEMA_ADDITIONAL_OR_MISSING_PROPERTY:prompt/);
  });

  it("missing required validator produces UNEXECUTED and blocks release", async () => {
    const root = await mkdtemp(join(tmpdir(), "orch-unexecuted-"));
    try {
      const keys = generateKeyPairSync("ed25519");
      const runtime = new OrchestratorRuntime(
        new FileStateStore(join(root, "state")), new MemoryArtifactRegistry(), builder({ value: 0 }), [validator("unit")],
        new ReleaseController(new MemoryReleaseStore(), (digest) => ({ signatureFp: d(digest) }), () => new Date().toISOString()),
        () => keys.publicKey, () => new Date().toISOString(), undefined, new FileSignedWorkOrderStore(join(root, "workorders"))
      );
      const result = await runtime.run({ signedWorkOrder: signWorkOrder(order(0, "policy-a"), "owner", keys.privateKey), buildVector: vector(), moduleManifestFp: d("module"), promoteToProduction: true });
      expect(result.status).toBe("RETURNED");
      expect(result.receipts.find((r) => r.gate === "security")?.status).toBe("UNEXECUTED");
      expect(result.reasons).toContain("UNEXECUTED:security");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("runtime policy change invalidates previous PASS and returns STALE_POLICY", async () => {
    const root = await mkdtemp(join(tmpdir(), "orch-policy-"));
    try {
      const keys = generateKeyPairSync("ed25519");
      let tick = 0;
      const clock = () => new Date(Date.UTC(2026, 8, 5, 0, 0, tick++)).toISOString();
      const store = new FileSignedWorkOrderStore(join(root, "workorders"));
      const runtime = new OrchestratorRuntime(
        new FileStateStore(join(root, "state")), new MemoryArtifactRegistry(), builder({ value: 0 }), [validator("unit"), validator("security")],
        new ReleaseController(new MemoryReleaseStore(), (digest) => ({ signatureFp: d(digest) }), clock),
        () => keys.publicKey, clock, undefined, store
      );
      const first = await runtime.run({ signedWorkOrder: signWorkOrder(order(0, "policy-a"), "owner", keys.privateKey), buildVector: vector(), moduleManifestFp: d("module"), promoteToProduction: true });
      expect(first.status).toBe("RELEASED");
      const second = await runtime.run({ signedWorkOrder: signWorkOrder(order(1, "policy-b"), "owner", keys.privateKey), buildVector: vector(), moduleManifestFp: d("module"), promoteToProduction: true });
      expect(second.status).toBe("RETURNED");
      expect(second.reasons).toEqual(["STALE_POLICY"]);
      const history = await new FileStateStore(join(root, "state")).history("TASK-START");
      expect(history.at(-1)?.reasonCode).toBe("STALE_POLICY");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
