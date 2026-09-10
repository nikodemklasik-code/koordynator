import { describe, expect, it } from "vitest";
import { OmniRouteRuntimeTelemetry } from "../src/api/omniroute-runtime-telemetry.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("OmniRoute runtime telemetry", () => {
  it("normalizes model catalog, latency, pricing, rate limits and token health without exposing raw payloads", async () => {
    const seen: string[] = [];
    const telemetry = new OmniRouteRuntimeTelemetry({
      endpoint: "http://127.0.0.1:20128/v1",
      apiKey: "test-only",
      now: () => "2026-09-10T10:00:00.000Z",
      fetchImpl: async (input) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith("/api/v1/models")) return json({ data: [
          { id: "openai/gpt-5.6-sol" },
          { id: "anthropic/claude-sonnet-5" },
          { id: "deepseek/forbidden" }
        ] });
        if (url.endsWith("/api/usage/model-latency-stats")) return json({ models: [
          { model: "openai/gpt-5.6-sol", avgLatencyMs: 1200 },
          { model: "anthropic/claude-sonnet-5", avgLatencyMs: 900 }
        ] });
        if (url.endsWith("/api/pricing/models")) return json({ models: [
          { modelId: "openai/gpt-5.6-sol", inputCost: 0.2, outputCost: 0.4 },
          { modelId: "anthropic/claude-sonnet-5", inputCost: 0.1, outputCost: 0.2 }
        ] });
        if (url.endsWith("/api/rate-limits")) return json({ models: [
          { model: "openai/gpt-5.6-sol", remaining: 12 },
          { model: "anthropic/claude-sonnet-5", remaining: 0 }
        ] });
        if (url.endsWith("/api/token-health")) return json({ models: [
          { model: "openai/gpt-5.6-sol", healthy: true },
          { model: "anthropic/claude-sonnet-5", healthy: true }
        ] });
        if (url.endsWith("/api/usage/budget")) return json({ limit: 10, used: 3, remaining: 7 });
        return json({}, 404);
      }
    });

    const snapshot = await telemetry.snapshot();
    expect(snapshot.takenAt).toBe("2026-09-10T10:00:00.000Z");
    expect(snapshot.budget).toEqual({ exhausted: false, remaining: 7, limit: 10, used: 3 });
    expect(snapshot.models).toContainEqual({
      modelId: "openai/gpt-5.6-sol",
      latencyMs: 1200,
      estimatedCost: 0.6000000000000001,
      rateLimited: false,
      tokenHealthy: true
    });
    expect(snapshot.models).toContainEqual({
      modelId: "anthropic/claude-sonnet-5",
      latencyMs: 900,
      estimatedCost: 0.30000000000000004,
      rateLimited: true,
      tokenHealthy: true
    });
    expect(snapshot.sources.models.available).toBe(true);
    expect(seen).toContain("http://127.0.0.1:20128/api/v1/models");
    expect(JSON.stringify(snapshot)).not.toContain("test-only");
  });

  it("falls back to the proven /v1/models alias and tolerates unavailable optional management telemetry", async () => {
    const seen: string[] = [];
    const telemetry = new OmniRouteRuntimeTelemetry({
      apiKey: "test-only",
      fetchImpl: async (input) => {
        const url = String(input);
        seen.push(url);
        if (url.endsWith("/api/v1/models")) return json({}, 404);
        if (url.endsWith("/v1/models")) return json({ data: [{ id: "openai/gpt-5.6-sol" }] });
        return json({ error: "not permitted" }, 403);
      }
    });

    const snapshot = await telemetry.snapshot();
    expect(snapshot.models).toEqual([{ modelId: "openai/gpt-5.6-sol" }]);
    expect(snapshot.sources.models.available).toBe(true);
    expect(snapshot.sources.pricing).toEqual({ available: false, status: 403 });
    expect(snapshot.sources.latency).toEqual({ available: false, status: 403 });
    expect(seen).toContain("http://127.0.0.1:20128/v1/models");
  });

  it("fails closed before network access when the inference credential is missing", async () => {
    let calls = 0;
    const previous = process.env.OMNIROUTE_API_KEY;
    delete process.env.OMNIROUTE_API_KEY;
    try {
      const telemetry = new OmniRouteRuntimeTelemetry({
        fetchImpl: async () => {
          calls += 1;
          return json({});
        }
      });
      await expect(telemetry.snapshot()).rejects.toThrow("OMNIROUTE_TELEMETRY_AUTH_REQUIRED");
      expect(calls).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.OMNIROUTE_API_KEY;
      else process.env.OMNIROUTE_API_KEY = previous;
    }
  });
});
