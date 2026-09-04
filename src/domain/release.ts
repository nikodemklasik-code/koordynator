import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { FrozenCandidate } from "./candidate.js";
import type { Digest } from "./ids.js";

export type ReleaseManifest = {
  candidateSha: Digest;
  artifactFp: Digest;
  approvalFp: Digest;
  releasePolicyFp: Digest;
  channel: "internal" | "canary" | "production";
  createdAt: string;
};

export type SignedRelease = {
  manifest: ReleaseManifest;
  releaseManifestFp: Digest;
  signatureFp: Digest;
  releaseSha: Digest;
};

export function assertReleaseMatchesCandidate(candidate: FrozenCandidate, manifest: ReleaseManifest): void {
  if (manifest.candidateSha !== candidate.candidateSha) throw new Error("RELEASE_CANDIDATE_MISMATCH");
  if (manifest.artifactFp !== candidate.artifactFp) throw new Error("RELEASE_ARTIFACT_MISMATCH");
}

export function createSignedRelease(
  candidate: FrozenCandidate,
  manifest: ReleaseManifest,
  sign: (digest: Digest) => { signatureFp: Digest }
): SignedRelease {
  assertReleaseMatchesCandidate(candidate, manifest);
  const releaseManifestFp = canonicalDigest(manifest);
  const { signatureFp } = sign(releaseManifestFp);
  const releaseSha = canonicalDigest({ releaseManifestFp, signatureFp });
  return { manifest, releaseManifestFp, signatureFp, releaseSha };
}
