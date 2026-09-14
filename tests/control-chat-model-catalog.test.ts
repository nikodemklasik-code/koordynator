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
  it("discovers OpenAI, Anthropic, Gemini, Grok and other executable routes with billing provenance", async () => {
    const requested: string[] = [];
    let authorization = "";
    let xApiKey = "";
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requested.push(url);
      const headers = init?.headers as Record<string, string> | undefined;
      authorization = String(headers?.authorization ?? authorization);
      xApiKey = String(headers?.["x-api-key"] ?? xApiKey);

      if (url.endsWith("/api/models") && !url.includes("/api/models/")) {
        return new Response(JSON.stringify({ models: [
          { fullModel: "cx/gpt-5.6-sol", name: "GPT-5.6 Sol via Codex", available: true },
          { fullModel: "cc/claude-opus-5", name: "Claude Opus 5 via Claude Code", available: true },
          { fullModel: "gemini-cli/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", available: true },
          { fullModel: "xao/grok-4.5", name: "Grok 4.5", available: true },
          { fullModel: "cl/anthropic/claude-opus-4.8", name: "Claude Opus 4.8 via Cline", available: true },
          { fullModel: "kc/openrouter/free", name: "Kilo free router", available: true },
          { fullModel: "aq/amazon-q", name: "Amazon Q", available: true },
          { fullModel: "agy/gemini-pro", name: "Antigravity Gemini", available: true },
          { fullModel: "oc/big-pickle", name: "OpenCode free", available: true },
          { fullModel: "dva/claude-sonnet", name: "Devin bridge Claude", available: true },
          { fullModel: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol API", available: true },
          { fullModel: "openrouter/example-free", name: "Example free", available: true },
          { fullModel: "cohere/embed-english-v3.0", available: true },
          { fullModel: "xai/grok-imagine-image", available: true },
          { fullModel: "deepseek/deepseek-r1", available: true }
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ data: [
          { id: "cx/gpt-5.6-sol", name: "GPT-5.6 Sol via Codex" },
          { id: "cc/claude-opus-5", name: "Claude Opus 5 via Claude Code" },
          { id: "gemini-cli/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
          { id: "xao/grok-4.5", name: "Grok 4.5" },
          { id: "cl/anthropic/claude-opus-4.8", name: "Claude Opus 4.8 via Cline" },
          { id: "kc/openrouter/free", name: "Kilo free router" },
          { id: "aq/amazon-q", name: "Amazon Q" },
          { id: "agy/gemini-pro", name: "Antigravity Gemini" },
          { id: "oc/big-pickle", name: "OpenCode free" },
          { id: "dva/claude-sonnet", name: "Devin bridge Claude" },
          { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol API" },
          { id: "openrouter/example-free", name: "Example free" },
          { id: "cohere/embed-english-v3.0" },
          { id: "xai/grok-imagine-image" },
          { id: "deepseek/deepseek-r1" }
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/models/catalog")) {
        return new Response(JSON.stringify({ providers: { openrouter: { models: [{ id: "openrouter/example-free", type: "chat", free: true }] } } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/models/availability")) {
        return new Response(JSON.stringify({ models: [
          { id: "cx/gpt-5.6-sol", available: true },
          { id: "cc/claude-opus-5", available: true },
          { id: "gemini-cli/gemini-3.1-pro-preview", available: true },
          { id: "xao/grok-4.5", available: true }
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/pricing/models")) {
        return new Response(JSON.stringify({ models: [
          { id: "openai/gpt-5.6-sol", estimatedCost: 1 },
          { id: "openrouter/example-free", estimatedCost: 0 }
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/pricing")) return new Response("", { status: 404 });
      if (url.endsWith("/api/usage/budget")) {
        return new Response(JSON.stringify({ remaining: 8, limit: 10, used: 2 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/v1/embeddings")) {
        return new Response(JSON.stringify({ data: [{ id: "cohere/embed-english-v3.0" }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/v1/images/generations")) {
        return new Response(JSON.stringify({ data: [{ id: "xai/grok-imagine-image" }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;

    const catalog = new ChatModelCatalogService({
      endpoint: "http://127.0.0.1:20128/v1/",
      apiKey: "catalog-secret",
      fetchImpl,
      now: () => "2026-09-10T12:00:00.000Z"
    });

    const result = await catalog.list();
    expect(result.models).toEqual([
      "cx/gpt-5.6-sol",
      "cc/claude-opus-5",
      "gemini-cli/gemini-3.1-pro-preview",
      "xao/grok-4.5",
      "cl/anthropic/claude-opus-4.8",
      "kc/openrouter/free",
      "aq/amazon-q",
      "agy/gemini-pro",
      "oc/big-pickle",
      "dva/claude-sonnet",
      "openai/gpt-5.6-sol",
      "openrouter/example-free"
    ]);
    expect(result.billing?.modelSources).toEqual({
      "cx/gpt-5.6-sol": "SUBSCRIPTION_HARNESS",
      "cc/claude-opus-5": "SUBSCRIPTION_HARNESS",
      "gemini-cli/gemini-3.1-pro-preview": "FREE_OAUTH",
      "xao/grok-4.5": "SUBSCRIPTION_HARNESS",
      "cl/anthropic/claude-opus-4.8": "SUBSCRIPTION_HARNESS",
      "kc/openrouter/free": "SUBSCRIPTION_HARNESS",
      "aq/amazon-q": "FREE_OAUTH",
      "agy/gemini-pro": "FREE_OAUTH",
      "oc/big-pickle": "FREE_REQUESTED",
      "dva/claude-sonnet": "FREE_REQUESTED",
      "openai/gpt-5.6-sol": "PAID_API",
      "openrouter/example-free": "FREE_CONFIRMED"
    });
    expect(result.billing?.subscriptionHarnessUsed).toBe(true);
    expect(result.billing?.subscriptionHarnessPath).toBe("OMNIROUTE_OAUTH_MODEL_ROUTES");
    expect(result.billing?.modelRoutes?.["cx/gpt-5.6-sol"]).toMatchObject({
      provider: "codex",
      family: "OPENAI",
      transport: "OMNIROUTE_OAUTH",
      subscriptionHarnessUsed: true
    });
    expect(result.entries?.find((entry) => entry.id === "xao/grok-4.5")).toMatchObject({ family: "XAI / GROK", billingSource: "SUBSCRIPTION_HARNESS" });
    expect(result.families?.find((family) => family.key === "gpt-5.6-sol")).toMatchObject({ family: "GPT" });
    expect(result.families?.find((family) => family.key === "claude-opus-4.8")).toMatchObject({ family: "Claude" });
    expect(result.families?.find((family) => family.key === "gpt-5.6-sol")?.candidates).toEqual(expect.arrayContaining(["cx/gpt-5.6-sol", "openai/gpt-5.6-sol"]));
    expect(result.families?.find((family) => family.key === "claude-opus-4.8")?.candidates).toContain("cl/anthropic/claude-opus-4.8");
    expect(result.billing?.budget).toEqual({ exhausted: false, remaining: 8, limit: 10, used: 2 });
    expect(requested).toContain("http://127.0.0.1:20128/api/models");
    expect(authorization).toBe("Bearer catalog-secret");
    expect(xApiKey).toBe("catalog-secret");
  });

  it("falls back from /api/models to /api/v1/models when the compact catalog path is absent", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/api/v1/models")) return new Response(JSON.stringify({ models: [{ id: "gemini-cli/gemini-3-flash-preview" }] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const catalog = new ChatModelCatalogService({ endpoint: "http://127.0.0.1:20128/v1", apiKey: "catalog-secret", fetchImpl });
    const result = await catalog.list();
    expect(result.models).toEqual(["gemini-cli/gemini-3-flash-preview"]);
    expect(result.billing?.modelSources["gemini-cli/gemini-3-flash-preview"]).toBe("FREE_OAUTH");
    expect(requested).toContain("http://127.0.0.1:20128/api/models");
    expect(requested).toContain("http://127.0.0.1:20128/api/v1/models");
  });

  it("fails closed when no server-side OmniRoute credential is available", async () => {
    const catalog = new ChatModelCatalogService({ apiKey: " " });
    await expect(catalog.list()).rejects.toThrow("CHAT_MODEL_CATALOG_AUTH_REQUIRED");
  });

  it("serves the dynamic catalog and browser route loader without exposing credentials or dead fallback models", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-models-"));
    roots.push(root);
    const modelCatalog: ChatModelCatalogPort = {
      async list() {
        return {
          models: ["cx/gpt-5.6-sol", "gemini-cli/gemini-3-flash-preview"],
          entries: [
            { id: "cx/gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "codex", family: "OPENAI", transport: "OMNIROUTE_OAUTH", subscriptionHarnessUsed: true, billingSource: "SUBSCRIPTION_HARNESS" },
            { id: "gemini-cli/gemini-3-flash-preview", name: "Gemini 3 Flash", provider: "gemini-cli", family: "GOOGLE / GEMINI", transport: "OMNIROUTE_OAUTH", subscriptionHarnessUsed: false, billingSource: "FREE_OAUTH" }
          ],
          source: "OMNIROUTE",
          checkedAt: "2026-09-10T12:00:00.000Z",
          billing: {
            liveChatTransport: "OMNIROUTE_API",
            subscriptionHarnessUsed: true,
            subscriptionHarnessPath: "OMNIROUTE_OAUTH_MODEL_ROUTES",
            modelSources: { "cx/gpt-5.6-sol": "SUBSCRIPTION_HARNESS", "gemini-cli/gemini-3-flash-preview": "FREE_OAUTH" },
            modelRoutes: {
              "cx/gpt-5.6-sol": { provider: "codex", family: "OPENAI", transport: "OMNIROUTE_OAUTH", subscriptionHarnessUsed: true, billingSource: "SUBSCRIPTION_HARNESS" },
              "gemini-cli/gemini-3-flash-preview": { provider: "gemini-cli", family: "GOOGLE / GEMINI", transport: "OMNIROUTE_OAUTH", subscriptionHarnessUsed: false, billingSource: "FREE_OAUTH" }
            }
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
      expect(payload.models[0]).toBe("cx/gpt-5.6-sol");
      expect(payload.billing?.subscriptionHarnessUsed).toBe(true);

      const loader = await fetch(`${base}/chat-models.js`).then((item) => item.text());
      expect(loader).toContain("SUBSCRIPTION HARNESS");
      expect(loader).toContain("FREE OAUTH");
      expect(loader).toContain("No static fallback models are shown");
      expect(loader).not.toContain("browser-must-not-see-this");

      const page = await fetch(`${base}/chat`).then((item) => item.text());
      // Restyled Live Chat: model picker moved to the composer; the loading
      // placeholder and the "unexecutable routes are hidden" contract survive.
      expect(page).toContain("Loading…");
      expect(page).toContain("Models that cannot execute under the active billing policy are not shown");
      expect(page).not.toContain('value="openai/gpt-5.6-sol"');
      expect(page).not.toContain("browser-must-not-see-this");
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });

  it("serves one picker row per model family and keeps concrete routes as substitutes", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-families-"));
    roots.push(root);
    const modelCatalog: ChatModelCatalogPort = {
      async list() {
        return {
          models: ["llm7/claude-opus-4.8", "cc/claude-opus-4-8"],
          entries: [
            { id: "llm7/claude-opus-4.8", name: "Claude Opus 4.8", provider: "llm7", family: "ANTHROPIC", transport: "OMNIROUTE_API", subscriptionHarnessUsed: false, billingSource: "FREE_CONFIRMED" },
            { id: "cc/claude-opus-4-8", name: "Claude Opus 4.8", provider: "claude-code", family: "ANTHROPIC", transport: "OMNIROUTE_OAUTH", subscriptionHarnessUsed: true, billingSource: "SUBSCRIPTION_HARNESS" }
          ],
          families: [{
            id: "family/claude-opus-4.8",
            key: "claude-opus-4.8",
            label: "Claude Opus 4.8",
            family: "ANTHROPIC",
            billingSource: "FREE_CONFIRMED",
            providers: ["llm7", "claude-code"],
            candidates: ["llm7/claude-opus-4.8", "cc/claude-opus-4-8"]
          }],
          source: "OMNIROUTE",
          checkedAt: "2026-09-10T12:00:00.000Z",
          billing: {
            liveChatTransport: "OMNIROUTE_API",
            subscriptionHarnessUsed: true,
            subscriptionHarnessPath: "OMNIROUTE_OAUTH_MODEL_ROUTES",
            modelSources: { "llm7/claude-opus-4.8": "FREE_CONFIRMED", "cc/claude-opus-4-8": "SUBSCRIPTION_HARNESS" }
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
      const picker = await fetch(`http://127.0.0.1:${address.port}/api/chat/models`).then((item) => item.json()) as { models: string[]; families?: Array<{ candidates: string[] }> };
      expect(picker.models).toEqual(["family/claude-opus-4.8"]);
      expect(picker.families?.[0]?.candidates).toEqual(["llm7/claude-opus-4.8", "cc/claude-opus-4-8"]);
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
