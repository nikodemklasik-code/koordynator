import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { ChatModelCatalogService, type ChatModelCatalogPort } from "../src/control/chat-model-catalog.js";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Live Chat model catalog", () => {
  it("separates requested free routing from confirmed free billing and paid API evidence", async () => {
    const requested: string[] = [];
    let authorization = "";
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requested.push(url);
      authorization = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
      if (url.endsWith("/api/pricing/models")) {
        return new Response(JSON.stringify({ models: [
          { id: "openai/gpt-5.6-sol", estimatedCost: 1 },
          { id: "google/gemini-2.5-pro", estimatedCost: 0 }
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/usage/budget")) {
        return new Response(JSON.stringify({ remaining: 8, limit: 10, used: 2 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        data: [
          { id: "auto/best-free" },
          { id: "openai/gpt-5.6-sol" },
          { id: "google/gemini-2.5-pro" },
          { id: "deepseek/deepseek-r1" },
          { id: "google/gemini-2.5-pro" },
          { id: "anthropic/claude-opus-5" }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const catalog = new ChatModelCatalogService({
      endpoint: "http://127.0.0.1:20128/v1/",
      apiKey: "catalog-secret",
      fetchImpl,
      now: () => "2026-09-10T12:00:00.000Z"
    });

    const result = await catalog.list();
    expect(result.models).toEqual(["auto/best-free", "openai/gpt-5.6-sol", "google/gemini-2.5-pro", "anthropic/claude-opus-5"]);
    expect(result.billing).toEqual({
      liveChatTransport: "OMNIROUTE_API",
      subscriptionHarnessUsed: false,
      subscriptionHarnessPath: "NOT_WIRED_TO_LIVE_CHAT",
      modelSources: {
        "auto/best-free": "FREE_REQUESTED",
        "openai/gpt-5.6-sol": "PAID_API",
        "google/gemini-2.5-pro": "FREE_CONFIRMED",
        "anthropic/claude-opus-5": "UNKNOWN"
      },
      budget: { exhausted: false, remaining: 8, limit: 10, used: 2 }
    });
    expect(requested[0]).toBe("http://127.0.0.1:20128/v1/models");
    expect(authorization).toBe("Bearer catalog-secret");
  });

  it("accepts explicit free evidence from the model catalog itself", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "auto/best-free", free: true }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const catalog = new ChatModelCatalogService({ endpoint: "http://127.0.0.1:20128/v1", apiKey: "key", fetchImpl });
    const result = await catalog.list();
    expect(result.billing?.modelSources["auto/best-free"]).toBe("FREE_CONFIRMED");
  });

  it("falls back from /v1/models to /api/v1/models when the first catalog path is absent", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/v1/models") && !url.endsWith("/api/v1/models")) return new Response("", { status: 404 });
      if (url.endsWith("/api/v1/models")) return new Response(JSON.stringify({ models: [{ id: "auto/best-free" }, { id: "openai/gpt-5.6-sol" }] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const catalog = new ChatModelCatalogService({ endpoint: "http://127.0.0.1:20128/v1", apiKey: "key", fetchImpl });
    const result = await catalog.list();
    expect(result.models).toEqual(["auto/best-free", "openai/gpt-5.6-sol"]);
    expect(result.billing?.modelSources["auto/best-free"]).toBe("FREE_REQUESTED");
    expect(requested.filter((url) => url.endsWith("/models") && !url.includes("pricing"))).toEqual([
      "http://127.0.0.1:20128/v1/models",
      "http://127.0.0.1:20128/api/v1/models"
    ]);
  });

  it("fails closed when no server-side OmniRoute credential is available", async () => {
    const catalog = new ChatModelCatalogService({ apiKey: " " });
    await expect(catalog.list()).rejects.toThrow("CHAT_MODEL_CATALOG_AUTH_REQUIRED");
  });

  it("serves the dynamic catalog and browser provenance loader without exposing credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-models-"));
    roots.push(root);
    const modelCatalog: ChatModelCatalogPort = {
      async list() {
        return {
          models: ["auto/best-free", "openai/gpt-5.6-sol", "google/gemini-2.5-pro", "anthropic/claude-opus-5"],
          source: "OMNIROUTE",
          checkedAt: "2026-09-10T12:00:00.000Z",
          billing: {
            liveChatTransport: "OMNIROUTE_API",
            subscriptionHarnessUsed: false,
            subscriptionHarnessPath: "NOT_WIRED_TO_LIVE_CHAT",
            modelSources: { "auto/best-free": "FREE_CONFIRMED", "openai/gpt-5.6-sol": "PAID_API", "google/gemini-2.5-pro": "UNKNOWN", "anthropic/claude-opus-5": "UNKNOWN" }
          }
        };
      }
    };
    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control"),
      chatApiKey: "browser-must-not-see-this",
      chatModelCatalog: modelCatalog
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("CHAT_MODELS_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;

      const response = await fetch(`${base}/api/chat/models`);
      expect(response.status).toBe(200);
      const payload = await response.json() as { models: string[]; billing?: { subscriptionHarnessUsed?: boolean } };
      expect(payload.models[0]).toBe("auto/best-free");
      expect(payload.billing?.subscriptionHarnessUsed).toBe(false);

      const loader = await fetch(`${base}/chat-models.js`).then((item) => item.text());
      expect(loader).toContain("/api/chat/models");
      expect(loader).toContain("FREE CONFIRMED");
      expect(loader).toContain("Subscription harness used by Live Chat: NO");
      expect(loader).not.toContain("browser-must-not-see-this");

      const page = await fetch(`${base}/chat`).then((item) => item.text());
      expect(page).toContain('value="auto/best-free"');
      expect(page).toContain("STRICT: PAID + UNKNOWN + UNCONFIRMED FREE BLOCKED");
      expect(page).toContain('src="/chat-usage.js"');
      expect(page).not.toContain("browser-must-not-see-this");
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
