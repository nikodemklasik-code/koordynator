import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { evaluateChatBilling } from "../src/control/chat-billing-policy.js";
import type { ChatModelCatalog } from "../src/control/chat-model-catalog.js";
import {
  FREE_SWARM_TARGETS,
  mergeSwarmSelection,
  modelsForFreeTarget
} from "../src/runtime/free-swarm.js";

function catalog(model: string, source: "UNKNOWN" | "PAID_API" = "UNKNOWN"): ChatModelCatalog {
  return {
    models: [model],
    source: "OMNIROUTE",
    checkedAt: "2026-09-11T00:00:00.000Z",
    billing: {
      liveChatTransport: "OMNIROUTE_API",
      subscriptionHarnessUsed: false,
      subscriptionHarnessPath: "NOT_AVAILABLE",
      modelSources: { [model]: source }
    }
  };
}

describe("free no-auth swarm", () => {
  it("covers only explicit no-auth/free OmniRoute aliases", () => {
    expect(FREE_SWARM_TARGETS.map(target => target.prefixes[0])).toEqual([
      "oc/",
      "ddgw/",
      "unc/",
      "horde/"
    ]);
  });

  it("prefers coding-oriented OpenCode models and filters DeepSeek", () => {
    const target = FREE_SWARM_TARGETS[0]!;
    expect(modelsForFreeTarget(target, [
      "oc/zeta",
      "oc/deepseek-v4",
      "oc/qwen-coder",
      "oc/kimi-k2"
    ])).toEqual([
      "oc/kimi-k2",
      "oc/qwen-coder",
      "oc/zeta"
    ]);
  });

  it("puts proven free routes before the existing quota-limited route", () => {
    expect(mergeSwarmSelection(
      ["oc/kimi-k2", "ddgw/gpt-4o-mini"],
      "gc/grok-4.6",
      ["cc/claude-opus-5", "cx/gpt-5.5"]
    )).toEqual({
      primary: "oc/kimi-k2",
      fallbacks: ["ddgw/gpt-4o-mini", "gc/grok-4.6", "cc/claude-opus-5", "cx/gpt-5.5"]
    });
  });

  it.each(["oc/model", "ddgw/model", "unc/model", "horde/model"])(
    "allows audited no-auth route %s when live catalog billing is UNKNOWN",
    model => {
      expect(evaluateChatBilling(model, catalog(model))).toMatchObject({
        allowed: true,
        source: "FREE_CONFIRMED",
        transport: "OMNIROUTE_API",
        decision: "ALLOW_FREE_CONFIRMED"
      });
    }
  );

  it("never overrides an explicit paid billing signal", () => {
    expect(evaluateChatBilling("oc/model", catalog("oc/model", "PAID_API"))).toMatchObject({
      allowed: false,
      source: "PAID_API",
      decision: "BLOCK_PAID_API"
    });
  });

  it("wires free swarm into app startup without any login flow", async () => {
    const app = await readFile(new URL("../src/runtime/app-launch.ts", import.meta.url), "utf8");
    const swarm = await readFile(new URL("../src/runtime/free-swarm.ts", import.meta.url), "utf8");
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    expect(app).toContain("bootstrapFreeSwarm");
    expect(packageJson.scripts["ai:swarm"]).toContain("free-swarm-cli.js");
    expect(swarm).not.toContain('"oauth", "start"');
    expect(swarm).not.toContain('"/device-code"');
    expect(swarm).not.toContain("openUrl(");
  });
});
