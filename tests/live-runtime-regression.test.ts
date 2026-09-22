import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { LiveChatModelCatalogService } from "../src/control/live-chat-model-catalog.js";

describe("live runtime regressions", () => {
  it("keeps executable chat models anchored to /v1/models while preserving inventory counts", async () => {
    const managementModels = Array.from({ length: 500 }, (_, index) => ({
      id: `inventory/model-${index}`,
      type: "chat",
      free: index < 200
    }));

    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ data: [
          { id: "cohere/command-a-03-2025" },
          { id: "groq/openai/gpt-oss-120b" }
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/models/catalog")) {
        return new Response(JSON.stringify({ models: managementModels }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/pricing/models")) {
        return new Response(JSON.stringify({ models: [
          { id: "cohere/command-a-03-2025", estimatedCost: 0 },
          { id: "groq/openai/gpt-oss-120b", estimatedCost: 0 }
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;

    const catalog = await new LiveChatModelCatalogService({
      endpoint: "http://127.0.0.1:20128/v1",
      apiKey: "test",
      fetchImpl
    }).list();

    expect(catalog.models).toEqual([
      "cohere/command-a-03-2025",
      "groq/openai/gpt-oss-120b"
    ]);
    expect(catalog.models.some((id) => id.startsWith("inventory/"))).toBe(false);
    expect(catalog.inventory).toEqual({
      totalModels: 502,
      verifiedFreeModels: 2,
      freeCandidates: 202,
      executableModels: 2
    });
  });

  it("keeps default-on Hermes execution wiring and OmniRoute recovery visible in runtime config", async () => {
    const [main, packageJson, chatModels, chatUsage] = await Promise.all([
      readFile("src/control/main.ts", "utf8"),
      readFile("package.json", "utf8"),
      readFile("web/control/chat-models.js", "utf8"),
      readFile("web/control/chat-usage.js", "utf8")
    ]);

    expect(main).toContain('chatHermesSkillsEveryTurn: process.env.KOORDYNATOR_CHAT_HERMES_SKILLS !== "0"');
    expect(main).toContain('chatAllowRepositoryExecution: process.env.KOORDYNATOR_CHAT_REPO_EXECUTION !== "0"');
    expect(main).toContain("omniroute-keeper.mjs");
    expect(main).toContain("WorkingChatModelCatalogService");
    expect(main).toContain("KOORDYNATOR_CHAT_WORKING_SET");
    expect(chatModels).toContain('"✓ LIVE"');
    expect(chatModels).toContain("dataset.workingSet");
    expect(chatUsage).toContain("FREE TOKENS USED 24H");
    expect(chatUsage).toContain("Remaining FREE token quota is not fabricated");
    expect(packageJson).toContain("hermes-managed.mjs");
  });
});
