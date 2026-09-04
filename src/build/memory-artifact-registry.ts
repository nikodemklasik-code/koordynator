import type { Digest } from "../domain/ids.js";
import type { ArtifactRegistry, StoredArtifact } from "./artifact-registry.js";

export class MemoryArtifactRegistry implements ArtifactRegistry {
  private readonly items = new Map<Digest, StoredArtifact>();

  async get(buildKey: Digest): Promise<StoredArtifact | null> {
    const item = this.items.get(buildKey);
    return item ? { ...item, bytes: item.bytes.slice() } : null;
  }

  async put(artifact: StoredArtifact): Promise<void> {
    this.items.set(artifact.buildKey, { ...artifact, bytes: artifact.bytes.slice() });
  }

  async revoke(buildKey: Digest): Promise<void> {
    const item = this.items.get(buildKey);
    if (item) this.items.set(buildKey, { ...item, revoked: true });
  }
}
