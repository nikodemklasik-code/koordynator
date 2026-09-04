import { artifactFingerprint, buildKey, type BuildInputVector } from "./build-input.js";
import type { ArtifactRegistry, StoredArtifact } from "./artifact-registry.js";
import type { HermeticBuilder } from "./hermetic-builder.js";
import { expectedAttestationFp, verifyStoredArtifactAttestation } from "./attestation.js";

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
  const stored: StoredArtifact = {
    ...attestationBase,
    signedAttestationFp: expectedAttestationFp(attestationBase),
    revoked: false,
    bytes: built.bytes.slice()
  };
  await registry.put(stored);
  return { mode: "BUILD", artifact: stored };
}
