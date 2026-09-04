import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Digest } from "../domain/ids.js";
import type { ArtifactRegistry, StoredArtifact } from "./artifact-registry.js";

function keyName(buildKey: Digest): string {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(buildKey);
  if (!match) throw new Error("INVALID_BUILD_KEY");
  return `${match[1]}.json`;
}

function keyStem(buildKey: Digest): string {
  return keyName(buildKey).replace(/\.json$/, "");
}

type StoredArtifactFile = Omit<StoredArtifact, "bytes"> & { bytesBase64: string };

export class FileArtifactRegistry implements ArtifactRegistry {
  constructor(private readonly root: string) {}

  private path(buildKey: Digest): string { return join(this.root, keyName(buildKey)); }
  private freezePath(buildKey: Digest): string { return join(this.root, `${keyStem(buildKey)}.frozen.json`); }

  async get(buildKey: Digest): Promise<StoredArtifact | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path(buildKey), "utf8")) as StoredArtifactFile;
      const { bytesBase64, ...metadata } = parsed;
      return { ...metadata, bytes: Buffer.from(bytesBase64, "base64") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async isFrozen(buildKey: Digest): Promise<boolean> {
    try {
      await access(this.freezePath(buildKey));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async put(artifact: StoredArtifact): Promise<void> {
    if (await this.isFrozen(artifact.buildKey)) throw new Error("FROZEN_ARTIFACT_MUTATION_DENIED");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const { bytes, ...metadata } = artifact;
    const payload: StoredArtifactFile = {
      ...metadata,
      bytesBase64: Buffer.from(bytes).toString("base64")
    };
    await writeFile(this.path(artifact.buildKey), JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  }

  async revoke(buildKey: Digest): Promise<void> {
    if (await this.isFrozen(buildKey)) throw new Error("FROZEN_ARTIFACT_MUTATION_DENIED");
    const artifact = await this.get(buildKey);
    if (!artifact) return;
    await this.put({ ...artifact, revoked: true });
  }

  async freeze(buildKey: Digest, artifactFp: Digest): Promise<void> {
    const artifact = await this.get(buildKey);
    if (!artifact) throw new Error("ARTIFACT_NOT_FOUND_FOR_FREEZE");
    if (artifact.artifactFp !== artifactFp) throw new Error("FREEZE_ARTIFACT_FP_MISMATCH");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (await this.isFrozen(buildKey)) {
      const existing = JSON.parse(await readFile(this.freezePath(buildKey), "utf8")) as { artifactFp: Digest };
      if (existing.artifactFp !== artifactFp) throw new Error("FROZEN_ARTIFACT_FP_MISMATCH");
      return;
    }
    await writeFile(this.freezePath(buildKey), JSON.stringify({ artifactFp }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
}
