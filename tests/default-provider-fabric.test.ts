import { describe, expect, it } from "vitest";
import { createDefaultAiProviderFabric } from "../src/api/default-provider-fabric.js";


describe("default provider fabric", () => {
  it("registers OmniRoute as the default AI gateway", () => {
    const { registry, router } = createDefaultAiProviderFabric({ omniRoute: { apiKey: "test-only", fetchImpl: async () => new Response("{}", { status: 200 }) } });
    expect(registry.names()[0]).toBe("omniroute");
    expect(router.profile).toMatchObject({ mode: "MULTI", strategy: "PRIMARY" });
  });

  it("shows a human name instead of the technical identifier", async () => {
    const { registry } = createDefaultAiProviderFabric({ omniRoute: { apiKey: "test-only", fetchImpl: async () => new Response("{}", { status: 200 }) } });
    const status = await registry.status();
    expect(status[0]?.name).toBe("OmniRoute");
    expect(status[0]?.health).toBe("HEALTHY");
  });
});
