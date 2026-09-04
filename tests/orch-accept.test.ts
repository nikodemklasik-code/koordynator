import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import { signWorkOrder } from "../src/security/work-order-signature.js";
import { FileStateStore } from "../src/store/file-state-store.js";
import { MemoryArtifactRegistry } from "../src/build/memory-artifact-registry.js";
import type { BuildInputVector } from "../src/build/build-input.js";
import { buildKey } from "../src/build/build-input.js";
import { buildOrReuse } from "../src/build/build-or-reuse.js";
import type { HermeticBuilder } from "../src/build/hermetic-builder.js";
import type { Validator } from "../src/validators/validation-dag.js";
import { MemoryReleaseStore, ReleaseController } from "../src/release/release-controller.js";
import { OrchestratorRuntime } from "../src/orchestrator/orchestrator.js";
import { evaluateReleasePolicy } from "../src/policy/release-policy.js";
import type { EvidenceReceipt } from "../src/domain/evidence.js";

const d = (value: unknown) => canonicalDigest(value);

function vector(seed: string): BuildInputVector {
  return {
    sourceFp: d(`source:${seed}`), dependencyFp: d("deps"), configFp: d("config"),
    toolchainFp: d("toolchain"), buildEnvironmentFp: d("env"), generatedSourcesFp: d("generated")
  };
}

function order(revision: number, policy = d("policy")): WorkOrder {
  return {
    taskId: "TASK-ACCEPT", workspaceId: "WS-ACCEPT", revision, objective: "Build exact releasable candidate",
    scope: { modules: ["core"], allowedPaths: ["src/**"] }, requiredInputs: [], capabilities: ["repo.write"],
    budget: { timeSec: 600, costLimit: 5, retries: 2, maxDagDepth: 8 },
    requiredGates: ["unit", "security"], expectedEvidence: ["security"],
    acceptanceCriteria: ["A-D pass"], failureCriteria: ["any required gate fails"],
    securityContractRef: d("security-contract"), performanceContractRef: d("performance-contract"),
    rollbackRequirement: "REVERSIBLE", humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release-v1", bundleHash: policy }
  };
}

function validator(gate: "unit" | "security", status: () => "PASS" | "FAIL"): Validator {
  return {
    gate,
    async validate(context) {
      return {
        status: status(),
        kind: gate === "security" ? "security" : "dependency",
        validUntil: new Date(new Date(context.now).getTime() + 3600_000).toISOString(),
        testDefinitionFp: d({ gate, definition: 1 }),
        fixtureFp: d({ gate, fixture: 1 }),
        validatorVersionFp: d({ gate, validator: 1 })
      };
    }
  };
}

function deterministicBuilder(counter: { value: number }): HermeticBuilder {
  return {
    async build(input) {
      counter.value += 1;
      return {
        bytes: Buffer.from(JSON.stringify(input), "utf8"),
        sbomFp: d("sbom"), provenanceFp: d(input), builderIdentityFp: d("builder-v1")
      };
    }
  };
}

describe("canonical orchestrator acceptance A-D", () => {
  it("A: build -> freeze -> required gates -> exact artifact release", async () => {
    const root = await mkdtemp(join(tmpdir(), "orch-a-"));
    try {
      const keys = generateKeyPairSync("ed25519");
      const buildCount = { value: 0 };
      let tick = 0;
      const clock = () => new Date(Date.UTC(2026, 8, 4, 12, 0, tick++)).toISOString();
      const releases = new MemoryReleaseStore();
      const runtime = new OrchestratorRuntime(
        new FileStateStore(root), new MemoryArtifactRegistry(), deterministicBuilder(buildCount),
        [validator("unit", () => "PASS"), validator("security", () => "PASS")],
        new ReleaseController(releases, (digest) => ({ signatureFp: d({ digest, key: "release" }) }), clock),
        () => keys.publicKey, clock
      );
      const result = await runtime.run({
        signedWorkOrder: signWorkOrder(order(0), "owner", keys.privateKey),
        buildVector: vector("A"), moduleManifestFp: d("module"), promoteToProduction: true
      });
      expect(result.status).toBe("RELEASED");
      expect(result.release?.state).toBe("PRODUCTION");
      expect(result.release?.release.manifest.artifactFp).toBe(result.candidate.artifactFp);
      expect(result.receipts.every((receipt) => receipt.status === "PASS")).toBe(true);
      expect(buildCount.value).toBe(1);
      const history = await new FileStateStore(root).history("TASK-ACCEPT");
      expect(history.map((state) => state.state)).toEqual([
        "CREATED", "READY", "BUILDING", "BUILD_READY", "CANDIDATE_FROZEN", "VALIDATING", "APPROVED", "RELEASING", "RELEASED"
      ]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("B: failed frozen candidate returns revision N+1 without mutating candidate A", async () => {
    const root = await mkdtemp(join(tmpdir(), "orch-b-"));
    try {
      const keys = generateKeyPairSync("ed25519");
      const buildCount = { value: 0 };
      let securityPass = false;
      let tick = 0;
      const clock = () => new Date(Date.UTC(2026, 8, 4, 13, 0, tick++)).toISOString();
      const runtime = new OrchestratorRuntime(
        new FileStateStore(root), new MemoryArtifactRegistry(), deterministicBuilder(buildCount),
        [validator("unit", () => "PASS"), validator("security", () => securityPass ? "PASS" : "FAIL")],
        new ReleaseController(new MemoryReleaseStore(), (digest) => ({ signatureFp: d(digest) }), clock),
        () => keys.publicKey, clock
      );
      const first = await runtime.run({ signedWorkOrder: signWorkOrder(order(0), "owner", keys.privateKey), buildVector: vector("B0"), moduleManifestFp: d("module") });
      expect(first.status).toBe("RETURNED");
      expect(first.nextRevision).toBe(1);
      const candidateA = structuredClone(first.candidate);

      securityPass = true;
      const second = await runtime.run({ signedWorkOrder: signWorkOrder(order(1), "owner", keys.privateKey), buildVector: vector("B1"), moduleManifestFp: d("module") });
      expect(second.status).toBe("RELEASED");
      expect(second.candidate.candidateSha).not.toBe(candidateA.candidateSha);
      expect(first.candidate).toEqual(candidateA);
      expect(second.candidate.revision).toBe(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("C: cache hits only for the exact input vector and honors revocation", async () => {
    const registry = new MemoryArtifactRegistry();
    const buildCount = { value: 0 };
    const builder = deterministicBuilder(buildCount);
    const v1 = vector("C");
    expect((await buildOrReuse(v1, registry, builder, () => true)).mode).toBe("BUILD");
    expect((await buildOrReuse(v1, registry, builder, () => true)).mode).toBe("REUSE");
    const changed = { ...v1, toolchainFp: d("toolchain-v2") };
    expect((await buildOrReuse(changed, registry, builder, () => true)).mode).toBe("BUILD");
    await registry.revoke(buildKey(v1));
    expect((await buildOrReuse(v1, registry, builder, () => true)).mode).toBe("BUILD");
    expect(buildCount.value).toBe(3);
  });

  it("D: policy fingerprint change invalidates old PASS evidence and blocks release", () => {
    const oldPolicy = d("old-policy");
    const newPolicy = d("new-policy");
    const candidateSha = d("candidate");
    const base = {
      candidateSha,
      componentFp: d("component"), dependencyFp: d("deps"), configFp: d("config"), toolchainFp: d("toolchain"),
      policyFp: oldPolicy, testDefinitionFp: d("test"), fixtureFp: d("fixture"), validatorVersionFp: d("validator"),
      environmentFp: d("env"), validUntil: "2026-09-05T00:00:00.000Z", revoked: false
    };
    const receipts: EvidenceReceipt[] = ["unit", "security"].map((gate) => {
      const value = { ...base, gate: gate as "unit" | "security", kind: gate === "security" ? "security" as const : "dependency" as const, status: "PASS" as const };
      return { ...value, receiptFp: d(value) };
    });
    const decision = evaluateReleasePolicy(order(0, newPolicy), candidateSha, receipts, new Date("2026-09-04T18:00:00.000Z"));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("STALE_POLICY:unit");
    expect(decision.reasons).toContain("STALE_POLICY:security");
  });
});
