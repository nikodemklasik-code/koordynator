import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest, TaskRef } from "./ids.js";

export type CandidateManifest = TaskRef & {
  sourceFp: Digest;
  dependencyFp: Digest;
  configFp: Digest;
  toolchainFp: Digest;
  buildEnvironmentFp: Digest;
  moduleManifestFp: Digest;
  artifactFp: Digest;
  frozenAt: string;
};

export type FrozenCandidate = CandidateManifest & {
  candidateSha: Digest;
  status: "FROZEN";
};

export function freezeCandidate(
  ref: TaskRef,
  manifestInput: Omit<CandidateManifest, keyof TaskRef | "frozenAt">,
  frozenAt: string
): FrozenCandidate {
  const manifest: CandidateManifest = { ...ref, ...manifestInput, frozenAt };
  return { ...manifest, candidateSha: canonicalDigest(manifest), status: "FROZEN" };
}
