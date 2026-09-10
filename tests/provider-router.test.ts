import { describe, expect, it } from "vitest";
import type { CapabilityRequest } from "../src/api/capability-api.js";
import type { ProviderAdapter, ProviderDescriptor, ProviderHealth } from "../src/api/provider-contract.js";
import { ProviderRegistry } from "../src/api/provider-registry.js";
import { ProviderRouter } from "../src/api/provider-router.js";

class FakeProvider implements ProviderAdapter {
  constructor(public readonly descriptor: ProviderDescriptor, private readonly currentHealth: ProviderHealth) {}
  async health() { return this.currentHealth; }
  async canExecute() { return true; }
  async execute<T>() { return { output: "ok" as T }; }
}

const request: CapabilityRequest = {
  requestId: "REQ-1",
  taskId: "TASK-PROVIDER-ROUTER",
  tenantId: "tenant-a",
  role: "BUILDER",
  capability: "ai.code",
  input: { task: "build" },
  securityClass: "S2",
  requirements: { externalProviderAllowed: true }
};

function descriptor(providerId: string, priority: number, extra: Partial<ProviderDescriptor> = {}): ProviderDescriptor {
  return {
    providerId,
    accessMode: "SUBSCRIPTION",
    capabilities: ["ai.code"],
    allowedSecurityClasses: ["S0", "S1", "S2"],
    external: true,
    priority,
    enabled: true,
    ...extra
  };
}

describe("provider router", () => {
  it("uses exactly the configured provider in MONO mode", async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider(descriptor("codex", 0), "HEALTHY"));
    const selected = await new ProviderRouter(registry, { mode: "MONO", providerId: "codex" }).select(request);
    expect(selected.descriptor.providerId).toBe("codex");
  });

  it("skips an unavailable provider in MULTI mode", async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider(descriptor("codex", 0), "UNAVAILABLE"));
    registry.register(new FakeProvider(descriptor("claude", 1), "HEALTHY"));
    const selected = await new ProviderRouter(registry, { mode: "MULTI", strategy: "POLICY" }).select(request);
    expect(selected.descriptor.providerId).toBe("claude");
  });

  it("denies external providers when the request forbids them", async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider(descriptor("codex", 0), "HEALTHY"));
    const router = new ProviderRouter(registry, { mode: "MULTI", strategy: "POLICY" });
    await expect(router.select({ ...request, requirements: { externalProviderAllowed: false } }))
      .rejects.toThrow("NO_ALLOWED_PROVIDER");
  });

  it("uses OmniRoute first in the default profile when it is healthy", async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider(descriptor("claude-code-sub", 0), "HEALTHY"));
    registry.register(new FakeProvider(descriptor("omniroute", 10, { accessMode: "API" }), "HEALTHY"));
    const selected = await new ProviderRouter(registry).select(request);
    expect(selected.descriptor.providerId).toBe("omniroute");
  });

  it("LOWEST_LATENCY uses latency metadata rather than provider name", async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider(descriptor("slow", 0, { typicalLatencyMs: 900 }), "HEALTHY"));
    registry.register(new FakeProvider(descriptor("fast", 10, { typicalLatencyMs: 100 }), "HEALTHY"));
    const selected = await new ProviderRouter(registry, { mode: "MULTI", strategy: "LOWEST_LATENCY" }).select(request);
    expect(selected.descriptor.providerId).toBe("fast");
  });

  it("QUALITY uses quality metadata", async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider(descriptor("cheap", 0, { qualityScore: 20 }), "HEALTHY"));
    registry.register(new FakeProvider(descriptor("strong", 10, { qualityScore: 95 }), "HEALTHY"));
    const selected = await new ProviderRouter(registry, { mode: "MULTI", strategy: "QUALITY" }).select(request);
    expect(selected.descriptor.providerId).toBe("strong");
  });

  it("ROLE_PINNED chooses the provider that best fits the requested role", async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider(descriptor("general", 0, { roleAffinity: { BUILDER: 20 } }), "HEALTHY"));
    registry.register(new FakeProvider(descriptor("builder", 10, { roleAffinity: { BUILDER: 100 } }), "HEALTHY"));
    const selected = await new ProviderRouter(registry, { mode: "MULTI", strategy: "ROLE_PINNED" }).select(request);
    expect(selected.descriptor.providerId).toBe("builder");
  });
});
