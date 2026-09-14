import { describe, expect, it } from "vitest";
import { agentGroup, buildModelFamilies, familyCandidates, familyKey, FAMILY_PREFIX } from "../src/control/model-family-router.js";
import type { ChatModelEntry } from "../src/control/chat-model-catalog.js";

function entry(id: string, billingSource: ChatModelEntry["billingSource"], provider: string, family = "ANTHROPIC"): ChatModelEntry {
  return {
    id,
    name: id,
    provider,
    family,
    transport: billingSource === "SUBSCRIPTION_HARNESS" || billingSource === "FREE_OAUTH" ? "OMNIROUTE_OAUTH" : "OMNIROUTE_API",
    subscriptionHarnessUsed: billingSource === "SUBSCRIPTION_HARNESS",
    billingSource
  };
}

describe("familyKey", () => {
  it("collapses the same model behind different provider prefixes to one key", () => {
    expect(familyKey("cc/claude-opus-4-8")).toBe("claude-opus-4.8");
    expect(familyKey("cl/anthropic/claude-opus-4.8")).toBe("claude-opus-4.8");
    expect(familyKey("gh/claude-opus-4.8")).toBe("claude-opus-4.8");
    expect(familyKey("kc/anthropic/claude-opus-4.8")).toBe("claude-opus-4.8");
  });

  it("keeps genuinely different models apart", () => {
    expect(familyKey("cc/claude-opus-5")).not.toBe(familyKey("cc/claude-opus-4-8"));
    expect(familyKey("gc/grok-4.6")).toBe("grok-4.6");
    expect(familyKey("openrouter/x-ai/grok-4.6")).toBe("grok-4.6");
  });

  it("strips vendor effort/thinking suffixes that are not separate models", () => {
    expect(familyKey("cc/claude-opus-5-high")).toBe("claude-opus-5");
    expect(familyKey("agy/claude-opus-4-6-thinking")).toBe("claude-opus-4.6");
  });

  it("ignores free markers so a :free route joins its paid twin", () => {
    expect(familyKey("openrouter/nex-agi/nex-n2.5-mini:free")).toBe(familyKey("openrouter/nex-agi/nex-n2.5-mini"));
  });
});

describe("buildModelFamilies", () => {
  it("orders candidates free-first so provider X substitutes the same model from provider Y", () => {
    const families = buildModelFamilies([
      entry("cc/claude-opus-4-8", "SUBSCRIPTION_HARNESS", "claude-code"),
      entry("openrouter/anthropic/claude-opus-4.8", "PAID_API", "openrouter"),
      entry("cl/anthropic/claude-opus-4.8", "SUBSCRIPTION_HARNESS", "cline"),
      entry("llm7/claude-opus-4.8", "FREE_CONFIRMED", "llm7")
    ]);
    const family = families.find((item) => item.key === "claude-opus-4.8");
    expect(family).toBeDefined();
    expect(family?.id).toBe(`${FAMILY_PREFIX}claude-opus-4.8`);
    expect(family?.candidates.map((candidate) => candidate.id)).toEqual([
      "llm7/claude-opus-4.8",
      "cc/claude-opus-4-8",
      "cl/anthropic/claude-opus-4.8",
      "openrouter/anthropic/claude-opus-4.8"
    ]);
    expect(family?.providers).toEqual(["llm7", "claude-code", "cline", "openrouter"]);
    expect(family?.billingSource).toBe("FREE_CONFIRMED");
  });

  it("does not merge different families and keeps a stable label", () => {
    const families = buildModelFamilies([
      entry("gc/grok-4.6", "SUBSCRIPTION_HARNESS", "grok-cli", "XAI / GROK"),
      entry("gh/grok-4.6", "SUBSCRIPTION_HARNESS", "github-copilot", "GITHUB COPILOT"),
      entry("cc/claude-opus-5", "SUBSCRIPTION_HARNESS", "claude-code")
    ]);
    expect(families.map((item) => item.key).sort()).toEqual(["claude-opus-5", "grok-4.6"]);
    const grok = families.find((item) => item.key === "grok-4.6");
    expect(grok?.candidates).toHaveLength(2);
    expect(grok?.candidates.map((candidate) => candidate.id)).toEqual(["gc/grok-4.6", "gh/grok-4.6"]);
    expect(grok?.family).toBe("Grok");
    expect(families.find((item) => item.key === "claude-opus-5")?.family).toBe("Claude");
  });

  it("groups picker rows by agent name, not by whichever provider answered first", () => {
    expect(agentGroup("gh/grok-4.6")).toBe("Grok");
    expect(agentGroup("gc/grok-4.6")).toBe("Grok");
    expect(agentGroup("cc/claude-opus-4-8")).toBe("Claude");
    expect(agentGroup("agy/gemini-3.1-pro")).toBe("Gemini");
    expect(agentGroup("cx/gpt-5.6-sol")).toBe("GPT");
    const families = buildModelFamilies([
      entry("gh/grok-4.6", "SUBSCRIPTION_HARNESS", "github-copilot", "GITHUB COPILOT"),
      entry("agy/gemini-3.1-pro", "FREE_OAUTH", "antigravity", "GOOGLE / ANTIGRAVITY"),
      entry("cx/gpt-5.6-sol", "SUBSCRIPTION_HARNESS", "codex", "OPENAI")
    ]);
    expect(families.map((item) => item.family)).toEqual(["Gemini", "GPT", "Grok"]);
  });
});

describe("familyCandidates", () => {
  const families = buildModelFamilies([
    entry("cc/claude-opus-4-8", "SUBSCRIPTION_HARNESS", "claude-code"),
    entry("llm7/claude-opus-4.8", "FREE_CONFIRMED", "llm7"),
    entry("openrouter/anthropic/claude-opus-4.8", "PAID_API", "openrouter")
  ]);

  it("expands a family id into its ordered concrete routes", () => {
    expect(familyCandidates(`${FAMILY_PREFIX}claude-opus-4.8`, families)).toEqual([
      "llm7/claude-opus-4.8",
      "cc/claude-opus-4-8",
      "openrouter/anthropic/claude-opus-4.8"
    ]);
  });

  it("returns an empty chain for a concrete model id or an unknown family", () => {
    expect(familyCandidates("cc/claude-opus-4-8", families)).toEqual([]);
    expect(familyCandidates(`${FAMILY_PREFIX}nope`, families)).toEqual([]);
  });
});
