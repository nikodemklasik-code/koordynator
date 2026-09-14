import { describe, expect, it } from "vitest";
import { buildProductOwnerContract, formatLiveChatAnswerStyle, formatProductOwnerContract } from "../src/control/product-owner-pack.js";
import { normalizeTaskEnvelope, type TaskEnvelope } from "../src/domain/task-envelope.js";
import { workerCapabilities, workerForRole } from "../src/domain/worker-registry.js";
import { normalizeConstitutionalMandate } from "../src/domain/constitutional-mandate.js";

describe("Product Owner pack", () => {
  it("keeps the request thread and emits bounded packs for later roles", () => {
    const contract = buildProductOwnerContract("kontynuuj popraw picker Claude Gemini GPT i nie gub watku");
    expect(contract.role).toBe("product-owner");
    expect(contract.goal.toLowerCase()).toContain("picker");
    expect(contract.thread.toLowerCase()).toMatch(/thread|wątek|session/);
    expect(contract.packs.map((pack) => pack.role)).toEqual(["researcher", "developer", "qc-pre-build"]);
    expect(contract.packs.every((pack) => pack.acceptance.length > 0)).toBe(true);
    expect(formatProductOwnerContract(contract)).toContain("PRODUCT OWNER CONTRACT");
    expect(formatProductOwnerContract(contract)).toContain("developer:");
    expect(formatLiveChatAnswerStyle()).toContain("ANSWER FORMAT FOR LIVE CHAT");
    expect(formatLiveChatAnswerStyle()).toContain("bullet lists");
  });

  it("is a read-only envelope role that cannot write code", () => {
    expect(workerForRole("product-owner")).toBe("hermes");
    expect(workerCapabilities(workerForRole("product-owner")).write).toBe(false);
    const envelope = normalizeTaskEnvelope({
      taskId: "TASK-PO",
      role: "product-owner",
      objective: "Package the live request",
      allowedPaths: ["docs/**"],
      allowedTools: ["web.search"],
      dataClass: "internal",
      budgetPolicy: "FREE_CONFIRMED",
      constitutionalMandate: normalizeConstitutionalMandate({
        constitutionVersion: "harmonia-founding.1",
        mandateId: "MANDATE-PO",
        mandateState: "enabled",
        allowedEffects: ["fs.read"],
        forbiddenEffects: ["fs.write"],
        riskClass: "internal",
        gateRequirements: ["integrity_gate"],
        issuedAt: "2026-09-14T00:00:00.000Z"
      }),
      writeLease: {
        repository: "nikodemklasik-code/koordynator",
        branch: "fix/frontend-v5-e2e",
        paths: ["src/"]
      },
      idempotencyKey: "product-owner:pack:v1",
      acceptanceChecks: ["packs exist", "no code written"]
    } satisfies TaskEnvelope);
    expect(envelope.role).toBe("product-owner");
    expect("writeLease" in envelope).toBe(false);
  });
});
