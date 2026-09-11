import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AI_TARGETS, mergeEnvText } from "../src/runtime/ai-bootstrap.js";
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
      "cursor", "kilocode", "cline", "amazonq", "antigravity"
    ]));
  });

  it.each([
    ["kmc/kimi-k2.6", "ALLOW_SUBSCRIPTION_HARNESS"],
    ["cu/cursor-model", "ALLOW_SUBSCRIPTION_HARNESS"],
    ["kc/kilo-model", "ALLOW_SUBSCRIPTION_HARNESS"],
    ["cl/cline-model", "ALLOW_SUBSCRIPTION_HARNESS"],
    ["aq/amazon-q-model", "ALLOW_FREE_OAUTH"],
    ["agy/gemini-model", "ALLOW_FREE_OAUTH"]
  ])("allows protected OAuth route %s without paid-API override", (model, decision) => {
    expect(evaluateChatBilling(model, catalog(model))).toMatchObject({ allowed: true, decision });
  });

  it("exposes one-command app startup and provider launchers", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson.scripts.start).toBe("npm run app");
    expect(packageJson.scripts.app).toContain("runtime/app-launch.js");
    expect(packageJson.scripts["ai:bootstrap"]).toContain("runtime/main.js bootstrap");
    for (const key of ["kimi", "cursor", "kilocode", "cline", "amazonq", "antigravity"]) {
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
});
