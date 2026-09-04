import type { Digest } from "../domain/ids.js";

export type ArtifactAttestation = {
  buildKey: Digest;
  artifactFp: Digest;
  builderIdentityFp: Digest;
  sbomFp: Digest;
  provenanceFp: Digest;
  signedAttestationFp: Digest;
  revoked: boolean;
};

export type StoredArtifact = ArtifactAttestation & { bytes: Uint8Array };

export interface ArtifactRegistry {
  get(buildKey: Digest): Promise<StoredArtifact | null>;
  put(artifact: StoredArtifact): Promise<void>;
  revoke(buildKey: Digest): Promise<void>;
}
