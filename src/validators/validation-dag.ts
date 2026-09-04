import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { FrozenCandidate } from "../domain/candidate.js";
import type { EvidenceReceipt } from "../domain/evidence.js";
import type { Digest } from "../domain/ids.js";
import type { EvidenceKind } from "../domain/work-order.js";
import type { GateName } from "../engine/impact-engine.js";

export type ValidationContext = {
  candidate: FrozenCandidate;
  artifactBytes: Uint8Array;
  policyFp: Digest;
  componentFp: Digest;
  dependencyFp: Digest;
  configFp: Digest;
  toolchainFp: Digest;
  environmentFp: Digest;
  now: string;
};

export type ValidatorResult = {
  status: "PASS" | "FAIL" | "UNEXECUTED" | "EXPIRED";
  kind: EvidenceKind;
  validUntil: string;
  testDefinitionFp: Digest;
  fixtureFp: Digest;
  validatorVersionFp: Digest;
  scannerDbFp?: Digest;
};

export type Validator = {
  gate: GateName;
  dependsOn?: GateName[];
  validate(context: ValidationContext): Promise<ValidatorResult>;
};

export type ValidationDagResult = {
  receipts: EvidenceReceipt[];
  passed: boolean;
};

function receiptFor(gate: GateName, result: ValidatorResult, context: ValidationContext): EvidenceReceipt {
  const base = {
    gate,
    kind: result.kind,
    status: result.status,
    candidateSha: context.candidate.candidateSha,
    componentFp: context.componentFp,
    dependencyFp: context.dependencyFp,
    configFp: context.configFp,
    toolchainFp: context.toolchainFp,
    policyFp: context.policyFp,
    testDefinitionFp: result.testDefinitionFp,
    fixtureFp: result.fixtureFp,
    validatorVersionFp: result.validatorVersionFp,
    ...(result.scannerDbFp === undefined ? {} : { scannerDbFp: result.scannerDbFp }),
    environmentFp: context.environmentFp,
    validUntil: result.validUntil,
    revoked: false
  };
  return { ...base, receiptFp: canonicalDigest(base) };
}

export async function executeValidationDag(
  validators: Validator[],
  requiredGates: GateName[],
  context: ValidationContext
): Promise<ValidationDagResult> {
  const byGate = new Map(validators.map((validator) => [validator.gate, validator]));
  const required = new Set(requiredGates);
  const pending = new Set(requiredGates);
  const receipts = new Map<GateName, EvidenceReceipt>();

  for (const gate of requiredGates) {
    if (!byGate.has(gate)) {
      const result: ValidatorResult = {
        status: "UNEXECUTED",
        kind: gate === "security" ? "security" : gate === "contract" ? "contract" : gate === "performance" ? "performance" : gate === "integration" ? "integration" : gate === "resilience" ? "resilience" : gate === "migration" ? "migration" : "dependency",
        validUntil: context.now,
        testDefinitionFp: canonicalDigest({ gate, missing: true }),
        fixtureFp: canonicalDigest("missing-validator"),
        validatorVersionFp: canonicalDigest("missing-validator")
      };
      receipts.set(gate, receiptFor(gate, result, context));
      pending.delete(gate);
    }
  }

  while (pending.size > 0) {
    const ready = [...pending].filter((gate) => {
      const validator = byGate.get(gate)!;
      const deps = validator.dependsOn ?? [];
      return deps.every((dep) => !required.has(dep) || receipts.has(dep));
    });

    if (ready.length === 0) {
      for (const gate of pending) {
        const result: ValidatorResult = {
          status: "UNEXECUTED",
          kind: "dependency",
          validUntil: context.now,
          testDefinitionFp: canonicalDigest({ gate, cycle: true }),
          fixtureFp: canonicalDigest("validation-cycle"),
          validatorVersionFp: canonicalDigest("validation-dag-v1")
        };
        receipts.set(gate, receiptFor(gate, result, context));
      }
      break;
    }

    await Promise.all(ready.map(async (gate) => {
      const validator = byGate.get(gate)!;
      const deps = validator.dependsOn ?? [];
      const dependencyFailed = deps.some((dep) => {
        const receipt = receipts.get(dep);
        return receipt !== undefined && receipt.status !== "PASS";
      });

      const result = dependencyFailed
        ? {
            status: "UNEXECUTED" as const,
            kind: "dependency" as const,
            validUntil: context.now,
            testDefinitionFp: canonicalDigest({ gate, blockedBy: deps }),
            fixtureFp: canonicalDigest("blocked-by-dependency"),
            validatorVersionFp: canonicalDigest("validation-dag-v1")
          }
        : await validator.validate(context);

      receipts.set(gate, receiptFor(gate, result, context));
      pending.delete(gate);
    }));
  }

  const ordered = requiredGates.map((gate) => receipts.get(gate)!).filter(Boolean);
  return { receipts: ordered, passed: ordered.length === requiredGates.length && ordered.every((receipt) => receipt.status === "PASS") };
}
