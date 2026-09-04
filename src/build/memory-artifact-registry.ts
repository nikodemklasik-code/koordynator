import type { Digest } from "../domain/ids.js";
import type { ArtifactRegistry, StoredArtifact } from "./artifact-registry.js";

export class MemoryArtifactRegistry implements ArtifactRegistry {
  private readonly items = new Map<Digest, StoredArtifact>();
  private readonly frozen = new Map<Digest, Digest>();

  async get(buildKey: Digest): Promise<StoredArtifact | null> {
    const item = this.items.get(buildKey);
    return item ? { ...item, bytes: item.bytes.slice() } : null;
  }

  async put(artifact: StoredArtifact): Promise<void> {
    if (this.frozen.has(artifact.buildKey)) throw new Error("FROZEN_ARTIFACT_MUTATION_DENIED");
    this.items.set(artifact.buildKey, { ...artifact, bytes: artifact.bytes.slice() });
  }

  async revoke(buildKey: Digest): Promise<void> {
    const item = this.items.get(buildKey);
    if (!item) return;
    if (this.frozen.has(buildKey)) throw new Error("FROZEN_ARTIFACT_MUTATION_DENIED");
    this.items.set(buildKey, { ...item, revoked: true });
  }

  async freeze(buildKey: Digest, artifactFp: Digest): Promise<void> {
    const item = this.items.get(buildKey);
    if (!item) throw new Error("ARTIFACT_NOT_FOUND_FOR_FREEZE");
    if (item.artifactFp !== artifactFp) throw new Error("FREEZE_ARTIFACT_FP_MISMATCH");
    const existing = this.frozen.get(buildKey);
    if (existing && existing !== artifactFp) throw new Error("FROZEN_ARTIFACT_FP_MISMATCH");
    this.frozen.set(buildKey, artifactFp);
  }

  async isFrozen(buildKey: Digest): Promise<boolean> {
    return this.frozen.has(buildKey);
  }
}
