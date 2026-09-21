import { describe, expect, it } from "vitest";
import type {
  ChatModelBillingSource,
  ChatModelCatalog,
  ChatModelCatalogPort
} from "../src/control/chat-model-catalog.js";
import { WorkingChatModelCatalogService } from "../src/control/working-chat-model-catalog.js";

function fixtureCatalog(): ChatModelCatalog {
  const active = [
    "gh/gpt-6-astra",
    "github/gpt-6-astra",
    "gh/claude-fable-5.1",
    "gh/claude-sonnet-5",
    "gh/claude-opus-4.8-fast",
    "oc/free-a",
    "ddgw/free-a",
    "kiro/auto",
    "gh/quota-model"
  ];
  const inventory = Array.from({ length: 1_000 }, (_, index) => `inventory/model-${index}`);
  const models = [...active, "paid/model", "unknown/model", ...inventory];
  const modelSources: Record<string, ChatModelBillingSource> = {};
  for (const model of models) modelSources[model] = "UNKNOWN";
  for (const model of active) modelSources[model] = "SUBSCRIPTION_HARNESS";
  modelSources["oc/free-a"] = "FREE_CONFIRMED";
  modelSources["ddgw/free-a"] = "FREE_OAUTH";
  modelSources["kiro/auto"] = "FREE_OAUTH";
  modelSources["paid/model"] = "PAID_API";

  return {
    models,
    source: "OMNIROUTE",
    checkedAt: "2026-09-20T20:00:00.000Z",
    entries: active.map((id) => ({
      id,
      name: id.split("/").at(-1) ?? id,
      provider: id.split("/")[0] ?? "omniroute",
      family: id.includes("claude") ? "ANTHROPIC" : id.includes("gpt") ? "OPENAI" : "OTHER",
      transport: id.startsWith("oc/") ? "OMNIROUTE_API" : "OMNIROUTE_OAUTH",
      subscriptionHarnessUsed: !id.startsWith("oc/") && id !== "kiro/auto",
      billingSource: modelSources[id]!
    })),
    billing: {
      liveChatTransport: "OMNIROUTE_API",
      subscriptionHarnessUsed: true,
      subscriptionHarnessPath: "OMNIROUTE_OAUTH_MODEL_ROUTES",
      modelSources
    }
  };
}

function fixturePort(): ChatModelCatalogPort {
  return { list: async () => fixtureCatalog() };
}

describe("WorkingChatModelCatalogService", () => {
  it("returns a compact exact-model live set and never leaks the huge inventory into the picker", async () => {
    const probed: string[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      const model = String(body.model ?? "");
      probed.push(model);
      if (model === "gh/quota-model") {
        return new Response(JSON.stringify({ error: { message: "quota exhausted" } }), {
          status: 429,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "PONG" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const catalog = await new WorkingChatModelCatalogService({
      endpoint: "http://127.0.0.1:20128/v1",
      apiKey: "test-key",
      catalog: fixturePort(),
      fetchImpl,
      preferredModels: ["kiro/auto"],
      maxCandidates: 20,
      targetActive: 20,
      probeConcurrency: 3,
      cacheTtlMs: 5_000
    }).list();

    expect(catalog.models).toEqual(expect.arrayContaining([
      "gh/gpt-6-astra",
      "gh/claude-fable-5.1",
      "gh/claude-sonnet-5",
      "gh/claude-opus-4.8-fast",
      "oc/free-a",
      "ddgw/free-a",
      "kiro/auto"
    ]));
    expect(catalog.models).not.toContain("github/gpt-6-astra");
    expect(catalog.models.some((model) => model.startsWith("inventory/"))).toBe(false);
    expect(catalog.models).not.toContain("paid/model");
    expect(catalog.models).not.toContain("unknown/model");
    expect(catalog.models).not.toContain("gh/quota-model");
    expect(catalog.workingSet.limitedModels).toContain("gh/quota-model");
    expect(catalog.workingSet.freeModels).toEqual(expect.arrayContaining(["oc/free-a", "ddgw/free-a", "kiro/auto"]));
    expect(catalog.workingSet.subscriptionModels).toEqual(expect.arrayContaining([
      "gh/gpt-6-astra",
      "gh/claude-fable-5.1",
      "gh/claude-sonnet-5"
    ]));
    expect(probed).not.toContain("paid/model");
    expect(probed).not.toContain("unknown/model");
    expect(probed.some((model) => model.startsWith("inventory/"))).toBe(false);
    expect(catalog.inventory.totalModels).toBeGreaterThan(1_000);
    expect(catalog.inventory.activeModels).toBe(catalog.models.length);
  });

  it("fails closed when catalogued routes exist but none passes a live probe", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "quota" } }), {
      status: 429,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const service = new WorkingChatModelCatalogService({
      endpoint: "http://127.0.0.1:20128/v1",
      apiKey: "test-key",
      catalog: fixturePort(),
      fetchImpl,
      maxCandidates: 8,
      targetActive: 8,
      probeConcurrency: 2
    });

    await expect(service.list()).rejects.toThrow("CHAT_MODEL_WORKING_SET_EMPTY");
  });
});
