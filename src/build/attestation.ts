import { sign as cryptoSign, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import type { StoredArtifact } from "./artifact-registry.js";

export type BuilderAttestationBase = {
  buildKey: Digest;
  artifactFp: Digest;
  builderIdentityFp: Digest;
  sbomFp: Digest;
  provenanceFp: Digest;
};

export type BuilderAttestation = {
  keyId: string;
  statementFp: Digest;
  signatureBase64: string;
};

export function attestationStatementFp(base: BuilderAttestationBase): Digest {
  return canonicalDigest({
    kind: "builder-attestation-v1",
    buildKey: base.buildKey,
    artifactFp: base.artifactFp,
    builderIdentityFp: base.builderIdentityFp,
    sbomFp: base.sbomFp,
    provenanceFp: base.provenanceFp
  });
}

export function signBuilderAttestation(base: BuilderAttestationBase, keyId: string, privateKey: KeyObject): BuilderAttestation {
  const statementFp = attestationStatementFp(base);
  const signatureBase64 = cryptoSign(null, Buffer.from(statementFp, "utf8"), privateKey).toString("base64");
  return { keyId, statementFp, signatureBase64 };
}

export function signedAttestationFingerprint(attestation: BuilderAttestation): Digest {
  return canonicalDigest({
    kind: "signed-builder-attestation-v1",
    keyId: attestation.keyId,
    statementFp: attestation.statementFp,
    signatureBase64: attestation.signatureBase64
  });
}

export function verifyBuilderAttestation(
  base: BuilderAttestationBase,
  attestation: BuilderAttestation,
  resolvePublicKey: (keyId: string) => KeyObject
): boolean {
  if (attestation.statementFp !== attestationStatementFp(base)) return false;
  try {
    return cryptoVerify(
      null,
      Buffer.from(attestation.statementFp, "utf8"),
      resolvePublicKey(attestation.keyId),
      Buffer.from(attestation.signatureBase64, "base64")
    );
  } catch {
    return false;
  }
}

export function expectedAttestationFp(base: BuilderAttestationBase): Digest {
  return canonicalDigest({ kind: "legacy-attestation-v1", ...base });
}

export function verifyStoredArtifactAttestation(
  artifact: StoredArtifact,
  resolvePublicKey?: (keyId: string) => KeyObject
): boolean {
  if (artifact.revoked || !resolvePublicKey) return false;
  if (!artifact.attestationKeyId || !artifact.attestationStatementFp || !artifact.attestationSignature) return false;
  const base: BuilderAttestationBase = {
    buildKey: artifact.buildKey,
    artifactFp: artifact.artifactFp,
    builderIdentityFp: artifact.builderIdentityFp,
    sbomFp: artifact.sbomFp,
    provenanceFp: artifact.provenanceFp
  };
  const attestation: BuilderAttestation = {
    keyId: artifact.attestationKeyId,
    statementFp: artifact.attestationStatementFp,
    signatureBase64: artifact.attestationSignature
  };
  if (artifact.signedAttestationFp !== signedAttestationFingerprint(attestation)) return false;
  return verifyBuilderAttestation(base, attestation, resolvePublicKey);
}
