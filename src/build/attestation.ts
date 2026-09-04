import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { StoredArtifact } from "./artifact-registry.js";

export function expectedAttestationFp(artifact: Omit<StoredArtifact, "bytes" | "signedAttestationFp" | "revoked">): `sha256:${string}` {
  return canonicalDigest({
    buildKey: artifact.buildKey,
    artifactFp: artifact.artifactFp,
    builderIdentityFp: artifact.builderIdentityFp,
    sbomFp: artifact.sbomFp,
    provenanceFp: artifact.provenanceFp
  });
}

export function verifyStoredArtifactAttestation(artifact: StoredArtifact): boolean {
  if (artifact.revoked) return false;
  if (!artifact.signedAttestationFp?.startsWith("sha256:")) return false;
  const expected = expectedAttestationFp(artifact);
  return artifact.signedAttestationFp === expected;
}
