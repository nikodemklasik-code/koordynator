import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Digest } from "../domain/ids.js";
import type { ArtifactRegistry, StoredArtifact } from "./artifact-registry.js";

function keyName(buildKey: Digest): string {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(buildKey);
  if (!match) throw new Error("INVALID_BUILD_KEY");
  return `${match[1]}.json`;
}

type StoredArtifactFile = Omit<StoredArtifact, "bytes"> & { bytesBase64: string };

export class FileArtifactRegistry implements ArtifactRegistry {
  constructor(private readonly root: string) {}

  private path(buildKey: Digest): string { return join(this.root, keyName(buildKey)); }

  async get(buildKey: Digest): Promise<StoredArtifact | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path(buildKey), "utf8")) as StoredArtifactFile;
      return { ...parsed, bytes: Buffer.from(parsed.bytesBase64, "base64") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async put(artifact: StoredArtifact): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const payload: StoredArtifactFile = { ...artifact, bytesBase64: Buffer.from(artifact.bytes).toString("base64") };
    delete (payload as Partial<StoredArtifact>).bytes;
    await writeFile(this.path(artifact.buildKey), JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  }

  async revoke(buildKey: Digest): Promise<void> {
    const artifact = await this.get(buildKey);
    if (!artifact) return;
    await this.put({ ...artifact, revoked: true });
  }
}
