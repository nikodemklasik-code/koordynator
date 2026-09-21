import { describe, expect, it } from "vitest";
import { isGenericAutoRoute, resolveExecutableChatModel } from "../src/control/chat-route-selection.js";
import type { ChatModelCatalog } from "../src/control/chat-model-catalog.js";

function catalog(): ChatModelCatalog {
  return {
    source: "OMNIROUTE",
    checkedAt: "2026-09-21T10:00:00.000Z",
    models: ["kiro/auto", "gc/grok-4.6", "cx/gpt-5.6-sol"],
    billing: {
      liveChatTransport: "OMNIROUTE_API",
      subscriptionHarnessUsed: true,
      subscriptionHarnessPath: "OMNIROUTE_OAUTH_MODEL_ROUTES",
      modelSources: {
        "kiro/auto": "FREE_OAUTH",
        "gc/grok-4.6": "SUBSCRIPTION_HARNESS",
        "cx/gpt-5.6-sol": "SUBSCRIPTION_HARNESS"
      }
    }
  };
}

describe("chat route selection", () => {
  it("distinguishes generic auto aliases from provider-specific auto routes", () => {
    expect(isGenericAutoRoute("auto")).toBe(true);
    expect(isGenericAutoRoute("best-free")).toBe(true);
    expect(isGenericAutoRoute("auto/best-free")).toBe(true);
    expect(isGenericAutoRoute("kiro/auto")).toBe(false);
    expect(isGenericAutoRoute("gc/auto")).toBe(false);
    expect(isGenericAutoRoute("cc/auto")).toBe(false);
    expect(isGenericAutoRoute("cx/gpt-5.6-sol")).toBe(false);
  });

  it("recovers an unlisted stale session model to a verified executable route", () => {
    expect(resolveExecutableChatModel({
      requestedModel: "auto/best-free",
      catalog: catalog(),
      preferredModels: ["kiro/auto"]
    })).toMatchObject({
      model: "kiro/auto",
      recoveredFrom: "auto/best-free",
      billing: {
        allowed: true,
        decision: "ALLOW_FREE_OAUTH"
      }
    });
  });

  it("does not bypass billing policy for a listed blocked route", () => {
    const blocked: ChatModelCatalog = {
      source: "OMNIROUTE",
      checkedAt: "2026-09-21T10:00:00.000Z",
      models: ["paid/model", "kiro/auto"],
      billing: {
        liveChatTransport: "OMNIROUTE_API",
        subscriptionHarnessUsed: false,
        subscriptionHarnessPath: "NOT_AVAILABLE",
        modelSources: {
          "paid/model": "PAID_API",
          "kiro/auto": "FREE_OAUTH"
        }
      }
    };

    expect(resolveExecutableChatModel({
      requestedModel: "paid/model",
      catalog: blocked,
      preferredModels: ["kiro/auto"]
    })?.billing).toMatchObject({
      allowed: false,
      decision: "BLOCK_PAID_API"
    });
  });
});
