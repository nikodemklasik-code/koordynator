import { describe, expect, it } from "vitest";
import type { CapabilityRequest } from "../src/api/capability-api.js";
import { OmniRouteProviderAdapter, defaultAiProviderOrder } from "../src/api/omniroute-adapter.js";

function request(input: unknown = { messages: [{ role: "user", content: "ping" }] }): CapabilityRequest {
  return {
    requestId: "REQ-OMNI",
    taskId: "TASK-OMNI",
    tenantId: "tenant-a",
    role: "BUILDER",
    capability: "ai.code",
    input,
    securityClass: "S1",
    idempotencyKey: "idem-1",
    requirements: { externalProviderAllowed: true, maxLatencyMs: 1000 }
  };
}

describe("OmniRoute provider adapter", () => {
  it("is the first default AI route", () => {
    expect(defaultAiProviderOrder()[0]).toBe("omniroute");
  });

  it("reports missing local gateway credential without throwing", async () => {
    const previous = process.env.OMNIROUTE_API_KEY;
    delete process.env.OMNIROUTE_API_KEY;
    try {
      const adapter = new OmniRouteProviderAdapter({ fetchImpl: async () => { throw new Error("should not fetch"); } });
      await expect(adapter.health()).resolves.toBe("AUTH_REQUIRED");
    } finally {
      if (previous === undefined) delete process.env.OMNIROUTE_API_KEY;
      else process.env.OMNIROUTE_API_KEY = previous;
    }
  });

  it("uses the local OmniRoute models endpoint for real health", async () => {
    const seen: string[] = [];
    const adapter = new OmniRouteProviderAdapter({
      apiKey: "test-only",
      fetchImpl: async (input) => {
        seen.push(String(input));
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    await expect(adapter.health()).resolves.toBe("HEALTHY");
    expect(seen).toEqual(["http://127.0.0.1:20128/v1/models"]);
  });

  it("maps authentication and rate limits to provider health", async () => {
    const unauthorized = new OmniRouteProviderAdapter({ apiKey: "test-only", fetchImpl: async () => new Response("", { status: 401 }) });
    const limited = new OmniRouteProviderAdapter({ apiKey: "test-only", fetchImpl: async () => new Response("", { status: 429 }) });
    await expect(unauthorized.health()).resolves.toBe("AUTH_REQUIRED");
    await expect(limited.health()).resolves.toBe("RATE_LIMITED");
  });

  it("sends chat work through OmniRoute and supplies a default model", async () => {
    let body: unknown;
    const adapter = new OmniRouteProviderAdapter({
      apiKey: "test-only",
      fetchImpl: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ id: "r1", choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "omni-1" }
        });
      }
    });
    const result = await adapter.execute<{ id: string }>(request());
    expect(body).toMatchObject({ model: "auto/best-free" });
    expect(result.output.id).toBe("r1");
    expect(result.providerRequestId).toBe("omni-1");
  });
});
