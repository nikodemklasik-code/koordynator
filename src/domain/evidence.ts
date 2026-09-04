import type { Digest } from "./ids.js";
import type { GateName } from "../engine/impact-engine.js";
import type { EvidenceKind } from "./work-order.js";

export type EvidenceReceipt = {
  gate: GateName;
  kind: EvidenceKind;
  status: "PASS" | "FAIL" | "UNEXECUTED" | "EXPIRED";
  candidateSha?: Digest;
  componentFp: Digest;
  dependencyFp: Digest;
  configFp: Digest;
  toolchainFp: Digest;
  policyFp: Digest;
  testDefinitionFp: Digest;
  fixtureFp: Digest;
  validatorVersionFp: Digest;
  scannerDbFp?: Digest;
  environmentFp: Digest;
  validUntil: string;
  revoked: boolean;
  receiptFp: Digest;
};

export type EvidenceContext = Pick<
  EvidenceReceipt,
  | "componentFp"
  | "dependencyFp"
  | "configFp"
  | "toolchainFp"
  | "policyFp"
  | "testDefinitionFp"
  | "fixtureFp"
  | "validatorVersionFp"
  | "scannerDbFp"
  | "environmentFp"
>;
