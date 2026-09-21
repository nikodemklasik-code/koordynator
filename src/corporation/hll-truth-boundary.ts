import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { HllDecision, HllStatement } from "./domain.js";
import type {
  AuthorityEpoch,
  DecisionReceipt,
  HllRecordReceipt
} from "./receipts.js";
import {
  verifyDecisionReceipt,
  verifyHllRecordReceipt
} from "./receipts.js";

/**
 * Corporation projection of the shared truth-boundary pattern already used on
 * Harmonia-Legal-Platform/develop (R25 hll_truth_bridge.py).
 *
 * This is a validator/consumer only. It cannot assess, ratify or mint HLL truth.
 * CONFIRMED without its exact Harmonia decision receipt and canonical-write
 * receipt is unusable at a downstream Corporation boundary.
 */
export type CanonicalHllBinding = {
  managed: true;
  truthState: "CONFIRMED";
  decisionHash: string;
  recordHash: string;
  semanticHash?: string;
  hllVersion: string;
  authorityId: string;
  authorityEpoch: string;
};

export function assertCanonicalHllFact(input: {
  statement: HllStatement;
  decision: HllDecision;
  decisionReceipt: DecisionReceipt;
  recordReceipt: HllRecordReceipt;
  expectedAuthority?: AuthorityEpoch;
}): CanonicalHllBinding {
  verifyDecisionReceipt({
    statement: input.statement,
    decision: input.decision,
    receipt: input.decisionReceipt,
    ...(input.expectedAuthority === undefined
      ? {}
      : { expectedAuthority: input.expectedAuthority })
  });

  verifyHllRecordReceipt({
    statement: input.statement,
    decision: input.decision,
    receipt: input.recordReceipt,
    expectedAuthority: input.expectedAuthority ?? {
      authorityId: input.decisionReceipt.authorityId,
      epoch: input.decisionReceipt.authorityEpoch
    }
  });

  if (input.decision.truthState !== "CONFIRMED") {
    throw new Error(`HLL_CANONICAL_FACT_NOT_CONFIRMED:${input.decision.truthState}`);
  }
  if (!input.decision.eligibleForFact) {
    throw new Error("HLL_CANONICAL_FACT_NOT_ELIGIBLE");
  }
  if (input.decision.blockers.length) {
    throw new Error("HLL_CANONICAL_FACT_HAS_BLOCKERS");
  }
  if (!input.recordReceipt.canonicalRecordHash.trim()) {
    throw new Error("HLL_CANONICAL_FACT_RECORD_HASH_MISSING");
  }

  return {
    managed: true,
    truthState: "CONFIRMED",
    decisionHash: input.decision.decisionId,
    recordHash: input.recordReceipt.canonicalRecordHash,
    ...(input.decisionReceipt.semanticHash?.trim() ? { semanticHash: input.decisionReceipt.semanticHash } : {}),
    hllVersion: input.decision.hllVersion,
    authorityId: input.decisionReceipt.authorityId,
    authorityEpoch: input.decisionReceipt.authorityEpoch
  };
}

export function canonicalHllFactUsable(input: {
  statement: HllStatement;
  decision: HllDecision;
  decisionReceipt: DecisionReceipt;
  recordReceipt: HllRecordReceipt;
  expectedAuthority?: AuthorityEpoch;
}): boolean {
  try {
    assertCanonicalHllFact(input);
    return true;
  } catch {
    return false;
  }
}

export function semanticProvenanceFromBindings(
  bindings: CanonicalHllBinding[]
): {
  hllVersion: string;
  harmoniaDecisionHashes: string[];
  canonicalRecordHashes: string[];
  factSemanticHashes: string[];
  authorityEpochs: string[];
  semanticStateHash: string;
} {
  if (!bindings.length) throw new Error("HLL_SEMANTIC_BINDINGS_REQUIRED");

  const versions = [...new Set(bindings.map((binding) => binding.hllVersion))].sort();
  if (versions.length !== 1) throw new Error("HLL_SEMANTIC_VERSION_MISMATCH");

  const payload = {
    hllVersion: versions[0]!,
    harmoniaDecisionHashes: [...new Set(bindings.map((binding) => binding.decisionHash))].sort(),
    canonicalRecordHashes: [...new Set(bindings.map((binding) => binding.recordHash))].sort(),
    factSemanticHashes: [...new Set(bindings.map((binding) => binding.semanticHash).filter((value): value is string => Boolean(value)))].sort(),
    authorityEpochs: [...new Set(bindings.map((binding) =>
      `${binding.authorityId}@${binding.authorityEpoch}`
    ))].sort()
  };

  return {
    ...payload,
    semanticStateHash: canonicalDigest(payload)
  };
}
