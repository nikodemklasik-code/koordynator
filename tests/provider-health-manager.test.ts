import { describe, expect, it } from "vitest";
import type { CapabilityRequest } from "../src/api/capability-api.js";
import type { ProviderAdapter, ProviderDescriptor } from "../src/api/provider-contract.js";
import { ProviderHealthManager } from "../src/api/provider-health-manager.js";
import { ProviderRegistry } from "../src/api/provider-registry.js";
import { ProviderRouter } from "../src/api/provider-router.js";

class HealthyProvider implements ProviderAdapter {
  calls = 0;
  readonly descriptor: ProviderDescriptor = {
    providerId: "primary",
    displayName: "Primary",
    accessMode: "API",
    capabilities: ["ai.code"],
    allowedSecurityClasses: ["S0", "S1", "S2"],
    external: true,
    priority: 0,
    enabled: true
  };
  async health() { this.calls += 1; return "HEALTHY" as const; }
  async canExecute() { return true; }
  async execute<T>() { return { output: "ok" as T }; }
}

const request: CapabilityRequest = {
  requestId: "REQ-HEALTH",
  taskId: "TASK-HEALTH",
  tenantId: "tenant-a",
  role: "BUILDER",
  capability: "ai.code",
  input: {},
  securityClass: "S1",
  requirements: { externalProviderAllowed: true }
};

describe("provider health manager", () => {
  it("caches health probes within the TTL", async () => {
    let now = 1000;
    const manager = new ProviderHealthManager({ ttlMs: 100, clock: () => now });
    const provider = new HealthyProvider();
    await expect(manager.health(provider)).resolves.toBe("HEALTHY");
    await expect(manager.health(provider)).resolves.toBe("HEALTHY");
    expect(provider.calls).toBe(1);
    now = 1200;
    await expect(manager.health(provider)).resolves.toBe("HEALTHY");
    expect(provider.calls).toBe(2);
  });

  it("puts a rate limited provider into cooldown so routing can skip it", async () => {
    let now = 1000;
    const manager = new ProviderHealthManager({ cooldownMs: 1000, clock: () => now });
    const provider = new HealthyProvider();
    manager.recordFailure("primary", "RATE_LIMITED");
    await expect(manager.health(provider)).resolves.toBe("RATE_LIMITED");
    expect(provider.calls).toBe(0);
    now = 2500;
    await expect(manager.health(provider)).resolves.toBe("HEALTHY");
    expect(provider.calls).toBe(1);
  });

  it("isolates provider cooldown inside the router", async () => {
    const registry = new ProviderRegistry();
    const primary = new HealthyProvider();
    registry.register(primary);
    registry.register({
      descriptor: { ...primary.descriptor, providerId: "backup", priority: 1 },
      health: async () => "HEALTHY",
      canExecute: async () => true,
      execute: async <T>() => ({ output: "backup" as T })
    });
    const manager = new ProviderHealthManager();
    manager.recordFailure("primary", "RATE_LIMITED");
    const router = new ProviderRouter(registry, { mode: "MULTI", strategy: "PRIMARY", providerOrder: ["primary", "backup"] }, manager);
    await expect(router.select(request)).resolves.toMatchObject({ descriptor: { providerId: "backup" } });
  });
});
