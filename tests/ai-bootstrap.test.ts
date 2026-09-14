import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AI_TARGETS, firstLiveRoute, mergeEnvText, selectChatModels } from "../src/runtime/ai-bootstrap.js";
import { evaluateChatBilling } from "../src/control/chat-billing-policy.js";
import type { ChatModelCatalog } from "../src/control/chat-model-catalog.js";

function catalog(model: string): ChatModelCatalog {
  return {
    models: [model],
    source: "OMNIROUTE",
    checkedAt: "2026-09-11T00:00:00.000Z",
    billing: {
      liveChatTransport: "OMNIROUTE_API",
      subscriptionHarnessUsed: false,
      subscriptionHarnessPath: "NOT_AVAILABLE",
      modelSources: {}
    }
  };
}

describe("AI bootstrap", () => {
  it("updates only requested model slots and never needs the OmniRoute key persisted", () => {
    const input = [
      "OMNIROUTE_ENDPOINT=http://127.0.0.1:20128/v1",
      "OMNIROUTE_API_KEY=",
      "KOORDYNATOR_OPENAI_MODEL=old",
      "KEEP_ME=yes",
      ""
    ].join("\n");
    const output = mergeEnvText(input, {
      KOORDYNATOR_OPENAI_MODEL: "cx/gpt-5.5",
      KOORDYNATOR_ANTHROPIC_MODEL: "cc/claude-opus-5"
    });
    expect(output).toContain("KOORDYNATOR_OPENAI_MODEL=cx/gpt-5.5");
    expect(output).toContain("KOORDYNATOR_ANTHROPIC_MODEL=cc/claude-opus-5");
    expect(output).toContain("OMNIROUTE_API_KEY=");
    expect(output).toContain("KEEP_ME=yes");
    expect(output).not.toContain("hermes-omniroute-api-key");
  });

  it("covers the currently supported central OmniRoute provider families", () => {
    const keys = AI_TARGETS.map(target => target.key);
    expect(keys).toEqual(expect.arrayContaining([
      "openai", "anthropic", "github", "grok", "gemini", "kimi", "qoder",
      "cursor", "kilocode", "cline", "amazonq", "antigravity", "kiro", "qwen", "astra"
    ]));
  });

  it.each([
    ["kmc/kimi-k2.6", "ALLOW_SUBSCRIPTION_HARNESS"],
    ["cu/cursor-model", "ALLOW_SUBSCRIPTION_HARNESS"],
    ["kc/kilo-model", "ALLOW_SUBSCRIPTION_HARNESS"],
    ["cl/cline-model", "ALLOW_SUBSCRIPTION_HARNESS"],
    ["aq/amazon-q-model", "ALLOW_FREE_OAUTH"],
    ["agy/gemini-model", "ALLOW_FREE_OAUTH"],
    ["kr/kiro-model", "ALLOW_FREE_OAUTH"]
  ])("allows protected OAuth route %s without paid-API override", (model, decision) => {
    expect(evaluateChatBilling(model, catalog(model))).toMatchObject({ allowed: true, decision });
  });

  it("exposes one-command app startup and provider launchers", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson.scripts.start).toBe("npm run app");
    expect(packageJson.scripts.app).toContain("runtime/app-launch.js");
    expect(packageJson.scripts["ai:bootstrap"]).toContain("runtime/main.js bootstrap");
    expect(packageJson.scripts["ai:always-on"]).toContain("scripts/ai-always-on.mjs");
    for (const key of ["kimi", "cursor", "kilocode", "cline", "amazonq", "antigravity", "astra"]) {
      expect(packageJson.scripts[`hermes:${key}`]).toContain(`hermes ${key}`);
    }
  });

  it("never starts OAuth/device login during bootstrap or app launch", async () => {
    const bootstrap = await readFile(new URL("../src/runtime/ai-bootstrap.ts", import.meta.url), "utf8");
    const appLaunch = await readFile(new URL("../src/runtime/app-launch.ts", import.meta.url), "utf8");
    expect(bootstrap).not.toContain('"oauth", "start"');
    expect(bootstrap).not.toContain("/device-code");
    expect(appLaunch).not.toContain("oauth");
    expect(appLaunch).not.toContain("device-code");
  });

  it("prefers the known live Cline Claude route within the Cline family", () => {
    const target = AI_TARGETS.find(item => item.key === "cline");
    expect(target?.preferred[0]).toBe("cl/anthropic/claude-opus-4.8");
  });

  it("picks free/subscription routes before Codex for the chat primary", () => {
    expect(selectChatModels({
      KOORDYNATOR_OPENAI_MODEL: "cx/gpt-5.5",
      KOORDYNATOR_ANTHROPIC_MODEL: "cc/claude-opus-5",
      KOORDYNATOR_GROK_MODEL: "gc/grok-4.5",
      KOORDYNATOR_KIRO_MODEL: "kr/kiro-claude"
    })).toEqual({
      primary: "kr/kiro-claude",
      fallbacks: ["cc/claude-opus-5", "gc/grok-4.5", "cx/gpt-5.5"]
    });
    expect(selectChatModels({
      KOORDYNATOR_GEMINI_MODEL: "gemini-cli/gemini-2.5-pro",
      KOORDYNATOR_ANTHROPIC_MODEL: "cc/claude-sonnet-5",
      KOORDYNATOR_OPENAI_MODEL: "cx/gpt-5.6-sol"
    })).toEqual({
      primary: "gemini-cli/gemini-2.5-pro",
      fallbacks: ["cc/claude-sonnet-5", "cx/gpt-5.6-sol"]
    });
  });

  it("does not keep a 429 family slot as chat primary when a later route is live", async () => {
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body ?? "{}")).model as string;
      if (model.startsWith("cc/")) return new Response("rate limit", { status: 429 });
      if (model.startsWith("cx/")) return new Response("quota", { status: 429 });
      if (model.startsWith("gc/")) return Response.json({ choices: [{ message: { content: "PONG" } }] });
      return new Response("nope", { status: 400 });
    }) as typeof fetch;
    await expect(firstLiveRoute(
      "http://127.0.0.1:20128/v1",
      "gateway-key",
      ["cc/claude-opus-5", "gc/grok-4.6", "cx/gpt-5.6-sol"],
      fetchImpl
    )).resolves.toEqual({
      primary: "gc/grok-4.6",
      fallbacks: ["cc/claude-opus-5", "cx/gpt-5.6-sol"]
    });
  });

  it("keeps the ranked family slot when every probe is 429", async () => {
    const fetchImpl = (async () => new Response("rate limit", { status: 429 })) as typeof fetch;
    await expect(firstLiveRoute(
      "http://127.0.0.1:20128/v1",
      "gateway-key",
      ["cc/claude-opus-5", "gc/grok-4.6"],
      fetchImpl
    )).resolves.toEqual({
      primary: "cc/claude-opus-5",
      fallbacks: ["gc/grok-4.6"]
    });
  });
});
