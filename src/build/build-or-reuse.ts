import { canonicalDigest } from "../crypto/canonical-digest.js";
import { artifactFingerprint, buildKey, type BuildInputVector } from "./build-input.js";
import type { ArtifactRegistry, StoredArtifact } from "./artifact-registry.js";
import type { HermeticBuilder } from "./hermetic-builder.js";

export type BuildDecision = { mode: "REUSE" | "BUILD"; artifact: StoredArtifact };

export async function buildOrReuse(
  vector: BuildInputVector,
  registry: ArtifactRegistry,
  builder: HermeticBuilder,
  verifyAttestation: (artifact: StoredArtifact) => boolean
): Promise<BuildDecision> {
  const key = buildKey(vector);
  const cached = await registry.get(key);
  if (cached && !cached.revoked && verifyAttestation(cached) && cached.artifactFp === artifactFingerprint(cached.bytes)) {
    return { mode: "REUSE", artifact: cached };
  }

  const built = await builder.build(vector);
  const artifactFp = artifactFingerprint(built.bytes);
  const stored: StoredArtifact = {
    buildKey: key,
    artifactFp,
    builderIdentityFp: built.builderIdentityFp,
    sbomFp: built.sbomFp,
    provenanceFp: built.provenanceFp,
    signedAttestationFp: canonicalDigest({
      buildKey: key,
      artifactFp,
      builderIdentityFp: built.builderIdentityFp,
      sbomFp: built.sbomFp,
      provenanceFp: built.provenanceFp
    }),
    revoked: false,
    bytes: built.bytes.slice()
  };
  await registry.put(stored);
  return { mode: "BUILD", artifact: stored };
}
