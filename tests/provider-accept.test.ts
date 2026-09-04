import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../src/api/provider-registry.js";
import { ProviderRouter } from "../src/api/provider-router.js";
import { ProviderExecutor } from "../src/api/provider-executor.js";
import type { CapabilityRequest } from "../src/api/capability-api.js";
import type { ProviderAdapter, ProviderDescriptor, ProviderHealth, ProviderResult } from "../src/api/provider-contract.js";
import { OfficialCliProviderAdapter } from "../src/api/official-cli-adapter.js";

class FakeProvider implements ProviderAdapter {
  executeCount = 0;
  constructor(
    readonly descriptor: ProviderDescriptor,
    public healthState: ProviderHealth = "HEALTHY",
    private readonly failure?: string
  ) {}
  async health(): Promise<ProviderHealth> { return this.healthState; }
  async canExecute(): Promise<boolean> { return true; }
  async execute<T>(): Promise<ProviderResult<T>> {
    this.executeCount += 1;
    if (this.failure) throw new Error(this.failure);
    return { output: { provider: this.descriptor.providerId } as T };
  }
}

function descriptor(providerId: string, accessMode: "SUBSCRIPTION" | "API" | "LOCAL" = "SUBSCRIPTION"): ProviderDescriptor {
  return {
    providerId, accessMode, capabilities: ["ai.code", "ai.review"], allowedSecurityClasses: ["S0", "S1", "S2"],
    external: accessMode !== "LOCAL", priority: 10, enabled: true,
    transport: accessMode === "SUBSCRIPTION" ? "OFFICIAL_CLI" : accessMode === "API" ? "RAW_API" : "LOCAL_RUNTIME",
    authMode: accessMode === "SUBSCRIPTION" ? "SUBSCRIPTION_OAUTH" : accessMode === "API" ? "API_KEY" : "LOCAL",
    billingMode: accessMode === "SUBSCRIPTION" ? "SUBSCRIPTION_INCLUDED" : accessMode === "API" ? "API_PAYG" : "LOCAL"
  };
}

function request(overrides: Partial<CapabilityRequest["requirements"]> = {}): CapabilityRequest {
  return {
    requestId: "REQ-1", taskId: "TASK-1", tenantId: "TENANT-1", role: "BUILDER", capability: "ai.code",
    input: { task: "implement" }, securityClass: "S1", idempotencyKey: "IDEMP-1",
    requirements: { externalProviderAllowed: true, ...overrides }
  };
}

const clock = { now: () => "2026-09-04T20:00:00.000Z" };

describe("Provider Fabric P1-P6", () => {
  it("P1 MONO subscription routes only to configured subscription provider", async () => {
    const registry = new ProviderRegistry();
    const sub = new FakeProvider(descriptor("sub"));
    const api = new FakeProvider(descriptor("api", "API"));
    registry.register(sub); registry.register(api);
    const executor = new ProviderExecutor(new ProviderRouter(registry, { mode: "MONO", providerId: "sub" }), clock);
    const result = await executor.execute(request({ billingPolicy: "SUBSCRIPTION_ONLY" }));
    expect(result.receipts[0]?.providerId).toBe("sub");
    expect(result.receipts[0]?.billingPath).toBe("SUBSCRIPTION_INCLUDED");
    expect(api.executeCount).toBe(0);
  });

  it("P2 MULTI filters denied provider and enforces diverse reviewer", async () => {
    const registry = new ProviderRegistry();
    const builder = new FakeProvider(descriptor("builder"));
    const reviewer = new FakeProvider(descriptor("reviewer"));
    registry.register(builder); registry.register(reviewer);
    const router = new ProviderRouter(registry, { mode: "MULTI", strategy: "DIVERSE_REVIEW", providerOrder: ["builder", "reviewer"] });
    const selected = await router.select({
      ...request({ providerDiversityRequired: true, diversityAgainstProviderId: "builder" }),
      role: "REVIEWER", capability: "ai.review"
    });
    expect(selected.descriptor.providerId).toBe("reviewer");
  });

  it("P3 exhausted subscription never silently charges API, but explicit budgeted fallback may use API", async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider(descriptor("sub"), "RATE_LIMITED"));
    const api = new FakeProvider(descriptor("api", "API"));
    registry.register(api);
    const router = new ProviderRouter(registry, { mode: "MULTI", strategy: "POLICY", providerOrder: ["sub", "api"] });
    await expect(router.select(request({ billingPolicy: "SUBSCRIPTION_ONLY" }))).rejects.toThrow("NO_ALLOWED_PROVIDER");
    expect(api.executeCount).toBe(0);

    const executor = new ProviderExecutor(router, clock);
    const result = await executor.execute(request({ billingPolicy: "SUBSCRIPTION_FIRST", allowPaidApiFallback: true, maxCost: 5 }));
    expect(result.receipts.at(-1)?.providerId).toBe("api");
    expect(result.receipts.at(-1)?.billingPath).toBe("API_PAYG");
  });

  it("P4 expired authentication is blocked without credential scraping", async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider(descriptor("sub"), "AUTH_REQUIRED"));
    const router = new ProviderRouter(registry, { mode: "MONO", providerId: "sub" });
    await expect(router.select(request({ billingPolicy: "SUBSCRIPTION_ONLY" }))).rejects.toThrow("PROVIDER_AUTH_REQUIRED");
  });

  it("P5 failover requires explicit idempotency protection", async () => {
    const registry = new ProviderRegistry();
    const first = new FakeProvider(descriptor("first"), "HEALTHY", "PROVIDER_TIMEOUT");
    const second = new FakeProvider(descriptor("second"));
    registry.register(first); registry.register(second);
    const executor = new ProviderExecutor(new ProviderRouter(registry, { mode: "MULTI", strategy: "FAILOVER", providerOrder: ["first", "second"] }), clock);
    const safe = await executor.execute(request({ allowProviderFailover: true, billingPolicy: "SUBSCRIPTION_ONLY" }));
    expect(safe.receipts).toHaveLength(2);
    expect(safe.receipts[0]?.result).toBe("TIMEOUT");
    expect(safe.receipts[1]?.providerId).toBe("second");

    const unsafe = { ...request({ allowProviderFailover: true, billingPolicy: "SUBSCRIPTION_ONLY" }) };
    delete unsafe.idempotencyKey;
    first.executeCount = 0; second.executeCount = 0;
    await expect(executor.execute(unsafe)).rejects.toThrow("PROVIDER_TIMEOUT");
    expect(second.executeCount).toBe(0);
  });

  it("P6 CLI version drift blocks adapter instead of guessing invocation", async () => {
    const adapter = new OfficialCliProviderAdapter({
      descriptor: descriptor("node-cli"), executable: process.execPath, versionArgs: ["--version"],
      expectedVersionPattern: /^definitely-not-node$/,
      buildArgs: () => ["-e", "process.stdout.write('ok')"], parseOutput: (stdout) => stdout
    });
    expect(await adapter.health()).toBe("BLOCKED");
  });
});
