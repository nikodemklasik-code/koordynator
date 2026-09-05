import { artifactFingerprint, buildKey, type BuildInputVector } from "./build-input.js";
import type { ArtifactRegistry, StoredArtifact } from "./artifact-registry.js";
import type { HermeticBuilder } from "./hermetic-builder.js";
import { expectedAttestationFp, signedAttestationFingerprint, verifyStoredArtifactAttestation } from "./attestation.js";

export type BuildDecision = { mode: "REUSE" | "BUILD"; artifact: StoredArtifact };

export async function buildOrReuse(
  vector: BuildInputVector,
  registry: ArtifactRegistry,
  builder: HermeticBuilder,
  verifyAttestation: (artifact: StoredArtifact) => boolean = verifyStoredArtifactAttestation
): Promise<BuildDecision> {
  const key = buildKey(vector);
  const cached = await registry.get(key);
  if (cached && !cached.revoked && verifyAttestation(cached) && cached.artifactFp === artifactFingerprint(cached.bytes)) {
    return { mode: "REUSE", artifact: cached };
  }

  const built = await builder.build(vector);
  const artifactFp = artifactFingerprint(built.bytes);
  const attestationBase = {
    buildKey: key,
    artifactFp,
    builderIdentityFp: built.builderIdentityFp,
    sbomFp: built.sbomFp,
    provenanceFp: built.provenanceFp
  };

  const stored: StoredArtifact = built.builderAttestation ? {
    ...attestationBase,
    signedAttestationFp: signedAttestationFingerprint(built.builderAttestation),
    attestationKeyId: built.builderAttestation.keyId,
    attestationStatementFp: built.builderAttestation.statementFp,
    attestationSignature: built.builderAttestation.signatureBase64,
    revoked: false,
    bytes: built.bytes.slice()
  } : {
    ...attestationBase,
    signedAttestationFp: expectedAttestationFp(attestationBase),
    revoked: false,
    bytes: built.bytes.slice()
  };

  if (built.builderAttestation && !verifyAttestation(stored)) throw new Error("BUILDER_ATTESTATION_INVALID");
  await registry.put(stored);
  return { mode: "BUILD", artifact: stored };
}
