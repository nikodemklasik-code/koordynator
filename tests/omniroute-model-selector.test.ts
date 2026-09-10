import { describe, expect, it } from "vitest";
import {
  DeterministicOmniRouteModelSelector,
  isForbiddenModel
} from "../src/api/omniroute-model-selector.js";
import type { OmniRouteRuntimeSnapshot } from "../src/api/omniroute-runtime-telemetry.js";

function source(snapshot: OmniRouteRuntimeSnapshot) {
  return { async snapshot() { return snapshot; } };
}

function snapshot(models: OmniRouteRuntimeSnapshot["models"], exhausted = false): OmniRouteRuntimeSnapshot {
  return {
    takenAt: "2026-09-10T10:15:00.000Z",
    models,
    budget: { exhausted },
    sources: {
      models: { available: true, status: 200 },
      tokenHealth: { available: true, status: 200 },
      rateLimits: { available: true, status: 200 },
      budget: { available: true, status: 200 },
      latency: { available: true, status: 200 },
      pricing: { available: true, status: 200 }
    }
  };
}

describe("OmniRoute deterministic model selector", () => {
  it("prefers instruction-fidelity for exact packs while using live latency and cost as secondary signals", async () => {
    const selector = new DeterministicOmniRouteModelSelector(source(snapshot([
      { modelId: "openai/gpt-5.6-sol", latencyMs: 2000, estimatedCost: 0.7, rateLimited: false, tokenHealthy: true },
      { modelId: "anthropic/claude-sonnet-5", latencyMs: 700, estimatedCost: 0.2, rateLimited: false, tokenHealthy: true },
      { modelId: "local/qwen2.5:1.5b", latencyMs: 100, estimatedCost: 0, rateLimited: false, tokenHealthy: true }
    ])));

    const selected = await selector.select({ purpose: "EXACT_PACK", maxLatencyMs: 5000 });
    expect(selected.modelId).toBe("openai/gpt-5.6-sol");
    expect(selected.reasons).toContain("fidelity=100");
    expect(selected.selectionFp).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("never selects DeepSeek and skips rate-limited or unhealthy models", async () => {
    const selector = new DeterministicOmniRouteModelSelector(source(snapshot([
      { modelId: "deepseek/super-code", latencyMs: 1, estimatedCost: 0 },
      { modelId: "openai/gpt-5.6-sol", latencyMs: 900, rateLimited: true, tokenHealthy: true },
      { modelId: "anthropic/claude-sonnet-5", latencyMs: 1200, rateLimited: false, tokenHealthy: true }
    ])));

    const selected = await selector.select({ purpose: "EXACT_PACK" });
    expect(selected.modelId).toBe("anthropic/claude-sonnet-5");
    expect(isForbiddenModel("router/DeepSeek-R1")).toBe(true);
  });

  it("honours measured latency ceilings rather than routing to a known-slow model", async () => {
    const selector = new DeterministicOmniRouteModelSelector(source(snapshot([
      { modelId: "openai/gpt-5.6-sol", latencyMs: 9000, tokenHealthy: true },
      { modelId: "anthropic/claude-sonnet-5", latencyMs: 2500, tokenHealthy: true }
    ])));

    await expect(selector.select({ purpose: "EXACT_PACK", maxLatencyMs: 3000 }))
      .resolves.toMatchObject({ modelId: "anthropic/claude-sonnet-5" });
  });

  it("when the runtime budget is exhausted, only a free-like route remains eligible", async () => {
    const selector = new DeterministicOmniRouteModelSelector(source(snapshot([
      { modelId: "openai/gpt-5.6-sol", estimatedCost: 0.1 },
      { modelId: "oc/nemotron-3.5-lightning-free" }
    ], true)));

    const selected = await selector.select({ purpose: "CODE" });
    expect(selected.modelId).toBe("oc/nemotron-3.5-lightning-free");
  });

  it("fails closed when budget is exhausted and there is no eligible free route", async () => {
    const selector = new DeterministicOmniRouteModelSelector(source(snapshot([
      { modelId: "openai/gpt-5.6-sol", estimatedCost: 0.2 }
    ], true)));

    await expect(selector.select({ purpose: "EXACT_PACK" })).rejects.toThrow("OMNIROUTE_RUNTIME_BUDGET_EXHAUSTED");
  });
});
