import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import { generateModule } from "../src/module/module-factory.js";
import { officialSubscriptionLaunchSpecs } from "../src/api/official-cli-adapter.js";
import { ProviderRegistry } from "../src/api/provider-registry.js";
import { ProviderRouter } from "../src/api/provider-router.js";
import { ProviderExecutor } from "../src/api/provider-executor.js";
import { MemoryProviderReceiptStore } from "../src/api/provider-receipt-store.js";
import type { CapabilityRequest } from "../src/api/capability-api.js";
import type { ProviderAdapter, ProviderDescriptor, ProviderHealth, ProviderResult } from "../src/api/provider-contract.js";
import { DagScheduler } from "../src/scheduler/scheduler.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import type { BuildInputVector } from "../src/build/build-input.js";
import type { HermeticBuilder } from "../src/build/hermetic-builder.js";
import type { Validator } from "../src/validators/validation-dag.js";
import { signWorkOrder } from "../src/security/work-order-signature.js";
import { FileStateStore } from "../src/store/file-state-store.js";
import { FileSignedWorkOrderStore } from "../src/store/work-order-store.js";
import { MemoryArtifactRegistry } from "../src/build/memory-artifact-registry.js";
import { MemoryReleaseStore, ReleaseController } from "../src/release/release-controller.js";
import { OrchestratorRuntime } from "../src/orchestrator/orchestrator.js";

const d = (value: unknown) => canonicalDigest(value);

class FakeProvider implements ProviderAdapter {
  constructor(readonly descriptor: ProviderDescriptor, private readonly output: unknown, private readonly healthState: ProviderHealth = "HEALTHY") {}
  async health(): Promise<ProviderHealth> { return this.healthState; }
  async canExecute(): Promise<boolean> { return true; }
  async execute<T>(): Promise<ProviderResult<T>> { return { output: this.output as T }; }
}

function provider(id: string, mode: "SUBSCRIPTION" | "API" = "SUBSCRIPTION"): ProviderDescriptor {
  return {
    providerId: id,
    accessMode: mode,
    capabilities: ["ai.code", "ai.review", "ai.reasoning"],
    allowedSecurityClasses: ["S0", "S1", "S2"], external: true, priority: 10, enabled: true,
    transport: mode === "SUBSCRIPTION" ? "OFFICIAL_CLI" : "RAW_API",
    authMode: mode === "SUBSCRIPTION" ? "SUBSCRIPTION_OAUTH" : "API_KEY",
    billingMode: mode === "SUBSCRIPTION" ? "SUBSCRIPTION_INCLUDED" : "API_PAYG"
  };
}

function request(role: "BUILDER" | "REVIEWER", capability: "ai.code" | "ai.review", extra: Partial<CapabilityRequest["requirements"]> = {}): CapabilityRequest {
  return {
    requestId: `REQ-${role}`, taskId: "TASK-O9", tenantId: "TENANT-O9", role, capability,
    input: { module: "hello-module" }, securityClass: "S1", idempotencyKey: `IDEMP-${role}`,
    requirements: { externalProviderAllowed: true, billingPolicy: "SUBSCRIPTION_ONLY", ...extra }
  };
}

function vector(): BuildInputVector {
  return { sourceFp: d("source"), dependencyFp: d("deps"), configFp: d("config"), toolchainFp: d("toolchain"), buildEnvironmentFp: d("env"), generatedSourcesFp: d("gen") };
}

function order(): WorkOrder {
  return {
    taskId: "TASK-REPLAY-GUARD", workspaceId: "WS-REPLAY-GUARD", revision: 0, objective: "release once",
    scope: { modules: ["hello"], allowedPaths: ["src/**"] }, requiredInputs: [], capabilities: ["repo.write"],
    budget: { timeSec: 60, costLimit: 0, retries: 1, maxDagDepth: 4 }, requiredGates: ["unit"], expectedEvidence: ["dependency"],
    acceptanceCriteria: ["one release"], failureCriteria: ["duplicate build"], securityContractRef: d("security"), performanceContractRef: d("performance"),
    rollbackRequirement: "REVERSIBLE", humanApprovalPolicy: "AUTO_IF_POLICY_PASS", policyRef: { policyId: "release-v1", bundleHash: d("policy") }
  };
}

function passingValidator(): Validator {
  return { gate: "unit", async validate(context) { return { status: "PASS", kind: "dependency", validUntil: new Date(new Date(context.now).getTime() + 60_000).toISOString(), testDefinitionFp: d("test"), fixtureFp: d("fixture"), validatorVersionFp: d("validator") }; } };
}

describe("O9 and operational start contracts", () => {
  it("Module Factory generates vendor-neutral capability-bound module", async () => {
    const root = await mkdtemp(join(tmpdir(), "module-factory-"));
    try {
      const target = join(root, "generated");
      const result = await generateModule({ moduleId: "generated-hello", targetDir: target, capabilities: ["ai.reasoning"] });
      expect(result.files).toContain("module-manifest.json");
      const manifest = JSON.parse(await readFile(join(target, "module-manifest.json"), "utf8"));
      expect(manifest.requires.capabilities).toEqual(["ai.reasoning"]);
      const source = `${await readFile(join(target, "src/index.ts"), "utf8")}\n${await readFile(join(target, "src/platform.ts"), "utf8")}`;
      expect(source).toContain("CapabilityApi");
      expect(source).not.toMatch(/openai|anthropic|gemini|copilot/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("official subscription adapters expose only documented auth flows and version probes", () => {
    const specs = Object.fromEntries(officialSubscriptionLaunchSpecs().map((spec) => [spec.descriptor.providerId, spec]));
    expect(specs["openai-codex-sub"]?.connectArgs).toEqual(["--login"]);
    expect(specs["claude-code-sub"]?.connectArgs).toEqual(["auth", "login"]);
    expect(specs["gemini-cli-sub"]?.connectArgs).toEqual([]);
    expect(specs["github-copilot-sub"]?.connectArgs).toEqual(["login"]);
    for (const spec of Object.values(specs)) {
      expect(spec.versionArgs).toEqual(["--version"]);
      expect(spec.expectedVersionPattern).toBeInstanceOf(RegExp);
      expect(JSON.stringify({ connectArgs: spec.connectArgs, envAllowList: spec.envAllowList })).not.toMatch(/password|cookie|browser-cookie|with-token/i);
    }
  });

  it("MULTI uses a different reviewer provider and persists subscription billing receipt", async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider(provider("builder"), { ok: "builder" }));
    registry.register(new FakeProvider(provider("reviewer"), { ok: "reviewer" }));
    const router = new ProviderRouter(registry, { mode: "MULTI", strategy: "DIVERSE_REVIEW", providerOrder: ["builder", "reviewer"] });
    const store = new MemoryProviderReceiptStore();
    const clock = { now: () => "2026-09-05T00:00:00.000Z" };
    const builder = await new ProviderExecutor(router, clock, store).execute(request("BUILDER", "ai.code"));
    const builderProvider = builder.receipts.at(-1)?.providerId;
    const reviewerRequest = request("REVIEWER", "ai.review", { providerDiversityRequired: true, diversityAgainstProviderId: builderProvider });
    const reviewer = await new ProviderExecutor(router, clock, store).execute(reviewerRequest);
    expect(reviewer.receipts.at(-1)?.providerId).not.toBe(builderProvider);
    const persisted = await store.listByTask("TASK-O9");
    expect(persisted).toHaveLength(2);
    expect(persisted.every((receipt) => receipt.billingPath === "SUBSCRIPTION_INCLUDED")).toBe(true);
  });

  it("scheduler waits across tenant quota batches and rejects impossible CPU requests", async () => {
    const scheduler = new DagScheduler({ cpu: 2, memoryMb: 256, maxConcurrent: 2, maxConcurrentPerTenant: 1 });
    let activeTenant = 0;
    let maxTenant = 0;
    const completed: string[] = [];
    const task = (id: string) => ({
      id, deps: [], tenantId: "same", priority: 1 as const, securityClass: "S1" as const, resources: { cpu: 1, memoryMb: 32 },
      run: async () => { activeTenant += 1; maxTenant = Math.max(maxTenant, activeTenant); await Promise.resolve(); completed.push(id); activeTenant -= 1; return id; }
    });
    const result = await scheduler.run([task("a"), task("b"), task("c")]);
    expect(result.results.size).toBe(3);
    expect(completed.sort()).toEqual(["a", "b", "c"]);
    expect(maxTenant).toBe(1);
    await expect(scheduler.run([{ id: "too-big", deps: [], tenantId: "t", priority: 1, securityClass: "S1", resources: { cpu: 3, memoryMb: 32 }, run: async () => "x" }])).rejects.toThrow("JOB_EXCEEDS_RESOURCE_LIMIT:too-big");
  });

  it("a RELEASED revision cannot build a second candidate on replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "replay-release-"));
    try {
      const keys = generateKeyPairSync("ed25519");
      let builds = 0;
      const hermetic: HermeticBuilder = { async build(input) { builds += 1; return { bytes: Buffer.from(JSON.stringify(input)), sbomFp: d("sbom"), provenanceFp: d(input), builderIdentityFp: d("builder") }; } };
      let tick = 0;
      const clock = () => new Date(Date.UTC(2026, 8, 5, 1, 0, tick++)).toISOString();
      const runtime = new OrchestratorRuntime(
        new FileStateStore(join(root, "state")), new MemoryArtifactRegistry(), hermetic, [passingValidator()],
        new ReleaseController(new MemoryReleaseStore(), (digest) => ({ signatureFp: d(digest) }), clock), () => keys.publicKey, clock, undefined,
        new FileSignedWorkOrderStore(join(root, "orders"))
      );
      const signed = signWorkOrder(order(), "owner", keys.privateKey);
      const first = await runtime.run({ signedWorkOrder: signed, buildVector: vector(), moduleManifestFp: d("module"), promoteToProduction: true });
      expect(first.status).toBe("RELEASED");
      await expect(runtime.run({ signedWorkOrder: signed, buildVector: vector(), moduleManifestFp: d("module"), promoteToProduction: true })).rejects.toThrow("STALE_WORK_ORDER_REVISION:0");
      expect(builds).toBe(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
