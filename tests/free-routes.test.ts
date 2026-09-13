import { describe, expect, it } from "vitest";
import { freeRouteCandidates, freeRouteGuard, selectWorkingFreeRoutes } from "../src/runtime/free-routes.js";
import { ChatModelCatalogService, type ChatModelCatalog } from "../src/control/chat-model-catalog.js";
import { evaluateChatBilling } from "../src/control/chat-billing-policy.js";

const catalog: ChatModelCatalog = {
  source: "OMNIROUTE", checkedAt: "2026-09-13T00:00:00Z",
  models: ["oc/free", "qw/tool", "oc/text", "paid/free", "cx/plan", "unknown/free"],
  billing: { liveChatTransport: "OMNIROUTE_API", subscriptionHarnessUsed: false, subscriptionHarnessPath: "NOT_AVAILABLE",
    modelSources: { "oc/free": "FREE_CONFIRMED", "qw/tool": "FREE_OAUTH", "oc/text": "FREE_CONFIRMED", "paid/free": "PAID_API", "cx/plan": "SUBSCRIPTION_HARNESS", "unknown/free": "FREE_REQUESTED" } }
};

describe("Shared free routes", () => {
  it("excludes subscriptions, paid routes, unconfirmed names and missing models even with paid overrides", async () => {
    expect(freeRouteCandidates(catalog, "qw/tool")).toEqual(["qw/tool", "oc/free", "oc/text"]);
    for (const model of ["paid/free", "cx/plan", "unknown/free", "qw/missing"]) {
      expect(evaluateChatBilling(model, catalog, { freeOnly: true, allowPaidApi: true, allowUnknown: true, allowFreeRequested: true }).allowed).toBe(false);
    }
    const guard = freeRouteGuard({ endpoint: "http://gateway/v1", apiKey: "secret" }, { list: async () => catalog });
    expect(await guard("oc/free")).toBe(true);
    expect(await guard("cx/plan")).toBe(false);
  });

  it("skips 429 and HTTP-200 text-only routes; only tool-capable free routes become primary/fallback", async () => {
    const requested: string[] = [];
    const result = await selectWorkingFreeRoutes({ endpoint: "http://gateway/v1", apiKey: "secret", model: "oc/free" }, {
      catalog: { list: async () => catalog },
      fetchImpl: (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        requested.push(body.model);
        if (body.model === "oc/free") return new Response("quota", { status: 429 });
        if (body.model === "oc/text") return Response.json({ choices: [{ message: { content: "done" } }] });
        return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: "koordynator_probe", arguments: "{}" } }] } }] });
      }) as typeof fetch
    });
    expect(requested).toEqual(["oc/free", "oc/text", "qw/tool"]);
    expect(result.primary).toBe("qw/tool");
    expect(result.fallbacks).toEqual([]);
    expect(result.probes.filter(row => row.status === "PASS")).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("returns no primary when no free route works instead of preserving a subscription fallback", async () => {
    const result = await selectWorkingFreeRoutes({ endpoint: "http://gateway/v1", apiKey: "secret", model: "cx/plan" }, {
      catalog: { list: async () => catalog }, fetchImpl: (async () => new Response("offline", { status: 503 })) as typeof fetch
    });
    expect(result.primary).toBeNull();
    expect(result.fallbacks).toEqual([]);
  });

  it("recognizes nested zero pricing, but not a free name or input-only zero", async () => {
    const service = new ChatModelCatalogService({ endpoint: "http://gateway/v1", apiKey: "secret", fetchImpl: (async url => {
      if (String(url) === "http://gateway/v1/models") return Response.json({ data: [
        { id: "oc/proven", pricing: { prompt: "0", completion: "0" } },
        { id: "oc/partial", pricing: { prompt: "0" } },
        { id: "oc/free", pricing: { input: 0, output: 2 } }
      ] });
      return new Response("", { status: 404 });
    }) as typeof fetch });
    const result = await service.list();
    expect(freeRouteCandidates(result)).toEqual(["oc/proven"]);
    expect(result.entries?.find(entry => entry.id === "oc/proven")?.transport).toBe("OMNIROUTE_API");
    expect(result.billing?.modelSources).toEqual({ "oc/proven": "FREE_CONFIRMED", "oc/partial": "FREE_REQUESTED", "oc/free": "PAID_API" });
  });
});
