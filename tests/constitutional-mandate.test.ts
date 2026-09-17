import { describe, expect, it } from "vitest";
import {
  assertMandateAllowsEffect,
  assertMandateUnchanged,
  evaluateGovernanceChange,
  normalizeConstitutionalMandate,
  type ConstitutionalMandate
} from "../src/domain/constitutional-mandate.js";
import {
  normalizeTaskEnvelope,
  taskEnvelopeFingerprint,
  validateTaskEnvelope,
  type TaskEnvelope
} from "../src/domain/task-envelope.js";
import { SideEffectRegistry } from "../src/domain/side-effect-idempotency.js";

function mandate(overrides: Partial<ConstitutionalMandate> = {}): ConstitutionalMandate {
  return normalizeConstitutionalMandate({
    constitutionVersion: "harmonia-founding.1",
    mandateId: "MANDATE-40",
    mandateState: "enabled",
    allowedEffects: ["payment", "migration", "publish", "deploy", "message", "fs.write"],
    forbiddenEffects: ["git.merge"],
    riskClass: "internal",
    gateRequirements: ["integrity_gate"],
    issuedAt: "2026-09-11T15:00:00.000Z",
    ...overrides
  });
}

function envelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    taskId: "TASK-40",
    role: "code",
    objective: "Implement issue 40 contracts",
    allowedPaths: ["src/domain/**", "tests/**"],
    allowedTools: ["fs.write", "git.commit"],
    dataClass: "internal",
    budgetPolicy: "FREE_CONFIRMED",
    constitutionalMandate: mandate(),
    writeLease: {
      repository: "nikodemklasik-code/koordynator",
      branch: "feat/issue-40-contracts",
      paths: ["src/domain/", "tests/"]
    },
    idempotencyKey: "issue-40:contracts:v1",
    acceptanceChecks: ["envelope fingerprints", "overlapping leases block"],
    ...overrides
  };
}

describe("ConstitutionalMandate (issue 40 update)", () => {
  it("rejects an envelope without a constitutional mandate", () => {
    const { constitutionalMandate: _dropped, ...bare } = envelope();
    expect(() => validateTaskEnvelope(bare as TaskEnvelope)).toThrow(/TASK_ENVELOPE_SCHEMA:MISSING:constitutionalMandate/);
  });

  it("folds the mandate into the envelope fingerprint so a governance change invalidates retry", () => {
    const base = taskEnvelopeFingerprint(envelope());
    const limited = taskEnvelopeFingerprint(envelope({
      constitutionalMandate: mandate({ mandateState: "limited" })
    }));
    expect(limited).not.toBe(base);
    expect(base).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("computes governanceFingerprint and rejects a caller-supplied mismatch", () => {
    const issued = mandate();
    expect(issued.governanceFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() => normalizeConstitutionalMandate({
      ...issued,
      governanceFingerprint: `sha256:${"0".repeat(64)}` as const
    })).toThrow(/MANDATE_FINGERPRINT_MISMATCH/);
  });

  it("blocks side effects when the mandate is suspended or revoked, before the effect starts", async () => {
    const registry = new SideEffectRegistry();
    let runs = 0;
    const exec = async () => {
      runs += 1;
      return { id: "pay-1" };
    };
    await expect(registry.run(
      { key: "pay:invoice-9", kind: "payment", mandate: mandate({ mandateState: "suspended" }) },
      exec
    )).rejects.toThrow(/MANDATE_NOT_ENABLED/);
    await expect(registry.run(
      { key: "pay:invoice-9", kind: "payment", mandate: mandate({ mandateState: "revoked" }) },
      exec
    )).rejects.toThrow(/MANDATE_NOT_ENABLED/);
    expect(runs).toBe(0);
  });

  it("lets an enabled mandate run a payment once, and a limited mandate only for allowed effects", async () => {
    const registry = new SideEffectRegistry();
    const paid = await registry.run(
      { key: "pay:invoice-9", kind: "payment", mandate: mandate() },
      async () => ({ id: "pay-1" })
    );
    expect(paid).toEqual({ id: "pay-1" });
    expect(() => assertMandateAllowsEffect(mandate({
      mandateState: "limited",
      allowedEffects: ["message"]
    }), "payment")).toThrow(/MANDATE_EFFECT_FORBIDDEN/);
    expect(() => assertMandateAllowsEffect(mandate(), "git.merge")).toThrow(/MANDATE_EFFECT_FORBIDDEN/);
  });

  it("forbids Koordynator from mutating its own sealed mandate", () => {
    const issued = mandate();
    const mutated = { ...issued, mandateState: "enabled" as const, allowedEffects: [...issued.allowedEffects, "git.merge"] };
    expect(() => assertMandateUnchanged(issued, mutated)).toThrow(/MANDATE_SELF_MUTATION_FORBIDDEN/);
    const same = normalizeTaskEnvelope(envelope()).constitutionalMandate;
    expect(() => assertMandateUnchanged(issued, same!)).not.toThrow();
  });

  it("marks a change to the judge or integrity gate as SELF_REFERENCE and requires owner approval", () => {
    const advisory = evaluateGovernanceChange({
      subject: "constitution_judge",
      evidenceRefs: ["docs/DOGFOODING.md#self-reference"]
    });
    expect(advisory.selfReference).toBe(true);
    expect(advisory.verdict).toBe("advisory");
    expect(advisory.ownerApprovalRequired).toBe(true);

    const admitted = evaluateGovernanceChange({
      subject: "integrity_gate",
      evidenceRefs: ["docs/FOUNDING.md#integrity-gate"],
      ownerOverride: { decision: "admit", at: "2026-09-11T16:00:00.000Z" }
    });
    expect(admitted.verdict).toBe("allow");
    expect(admitted.priorVerdict).toBe("advisory");
  });

  it("refuses a block or unblock that has no evidence refs", () => {
    expect(() => evaluateGovernanceChange({ subject: "execution", evidenceRefs: [] }))
      .toThrow(/GOVERNANCE_EVIDENCE_REQUIRED/);
  });
});
