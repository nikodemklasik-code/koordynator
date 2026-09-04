import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import { FileArtifactRegistry } from "../src/build/file-artifact-registry.js";
import { buildOrReuse } from "../src/build/build-or-reuse.js";
import { buildKey, type BuildInputVector } from "../src/build/build-input.js";
import type { HermeticBuilder } from "../src/build/hermetic-builder.js";
import { FileProviderReceiptStore } from "../src/api/provider-receipt-store.js";
import { ProviderExecutor } from "../src/api/provider-executor.js";
import { ProviderRegistry } from "../src/api/provider-registry.js";
import { ProviderRouter } from "../src/api/provider-router.js";
import type { CapabilityRequest } from "../src/api/capability-api.js";
import type { ProviderAdapter, ProviderDescriptor, ProviderResult } from "../src/api/provider-contract.js";

const d = (value: unknown) => canonicalDigest(value);

function vector(): BuildInputVector {
  return { sourceFp: d("source"), dependencyFp: d("deps"), configFp: d("config"), toolchainFp: d("toolchain"), buildEnvironmentFp: d("env"), generatedSourcesFp: d("gen") };
}

const builder: HermeticBuilder = {
  async build(input) {
    return { bytes: Buffer.from(JSON.stringify(input)), sbomFp: d("sbom"), provenanceFp: d(input), builderIdentityFp: d("builder") };
  }
};

class FakeProvider implements ProviderAdapter {
  constructor(readonly descriptor: ProviderDescriptor) {}
  async health() { return "HEALTHY" as const; }
  async canExecute() { return true; }
  async execute<T>(): Promise<ProviderResult<T>> { return { output: { ok: true } as T }; }
}

function descriptor(id: string, mode: "SUBSCRIPTION" | "API"): ProviderDescriptor {
  return {
    providerId: id, accessMode: mode, capabilities: ["ai.reasoning"], allowedSecurityClasses: ["S1"], external: true,
    priority: 1, enabled: true, transport: mode === "SUBSCRIPTION" ? "OFFICIAL_CLI" : "RAW_API",
    authMode: mode === "SUBSCRIPTION" ? "SUBSCRIPTION_OAUTH" : "API_KEY",
    billingMode: mode === "SUBSCRIPTION" ? "SUBSCRIPTION_INCLUDED" : "API_PAYG"
  };
}

function request(id: string, policy: "SUBSCRIPTION_ONLY" | "API_ONLY"): CapabilityRequest {
  return {
    requestId: `REQ-${id}`, taskId: "TASK-PERSIST", tenantId: "TENANT-PERSIST", role: "BUILDER", capability: "ai.reasoning",
    input: { id }, securityClass: "S1", requirements: { externalProviderAllowed: true, billingPolicy: policy }
  };
}

describe("persistent start contracts", () => {
  it("file artifact freeze survives registry restart and rejects mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-freeze-"));
    try {
      const input = vector();
      const firstRegistry = new FileArtifactRegistry(root);
      const built = await buildOrReuse(input, firstRegistry, builder);
      await firstRegistry.freeze(buildKey(input), built.artifact.artifactFp);
      const restarted = new FileArtifactRegistry(root);
      expect(await restarted.isFrozen(buildKey(input))).toBe(true);
      const stored = await restarted.get(buildKey(input));
      if (!stored) throw new Error("FROZEN_ARTIFACT_MISSING");
      await expect(restarted.put({ ...stored, bytes: Buffer.from("tamper"), artifactFp: d("tamper") })).rejects.toThrow("FROZEN_ARTIFACT_MUTATION_DENIED");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("provider billing receipts persist SUBSCRIPTION_INCLUDED and API_PAYG", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-receipts-"));
    try {
      const store = new FileProviderReceiptStore(root);
      const clock = { now: () => "2026-09-05T00:10:00.000Z" };
      const subRegistry = new ProviderRegistry();
      subRegistry.register(new FakeProvider(descriptor("sub", "SUBSCRIPTION")));
      await new ProviderExecutor(new ProviderRouter(subRegistry, { mode: "MONO", providerId: "sub" }), clock, store).execute(request("SUB", "SUBSCRIPTION_ONLY"));

      const apiRegistry = new ProviderRegistry();
      apiRegistry.register(new FakeProvider(descriptor("api", "API")));
      await new ProviderExecutor(new ProviderRouter(apiRegistry, { mode: "MONO", providerId: "api" }), clock, store).execute(request("API", "API_ONLY"));

      const restarted = new FileProviderReceiptStore(root);
      const receipts = await restarted.listByTask("TASK-PERSIST");
      expect(receipts.map((receipt) => receipt.billingPath).sort()).toEqual(["API_PAYG", "SUBSCRIPTION_INCLUDED"]);
      expect(receipts.every((receipt) => receipt.taskId === "TASK-PERSIST")).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
