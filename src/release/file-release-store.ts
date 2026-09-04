import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import type { ReleaseRecord, ReleaseStore } from "./release-controller.js";

export class FileReleaseStore implements ReleaseStore {
  constructor(private readonly root: string) {}

  private path(): string { return join(this.root, "releases.jsonl"); }

  private async latest(): Promise<Map<Digest, ReleaseRecord>> {
    try {
      const raw = await readFile(this.path(), "utf8");
      const map = new Map<Digest, ReleaseRecord>();
      for (const line of raw.split("\n").filter(Boolean)) {
        const record = JSON.parse(line) as ReleaseRecord;
        map.set(record.release.releaseSha, record);
      }
      return map;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
      throw error;
    }
  }

  async put(record: ReleaseRecord): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const handle = await open(this.path(), "a", 0o600);
    try {
      await handle.writeFile(`${canonicalJson(record)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async get(releaseSha: Digest): Promise<ReleaseRecord | null> {
    return (await this.latest()).get(releaseSha) ?? null;
  }

  async currentProduction(): Promise<ReleaseRecord | null> {
    const records = [...(await this.latest()).values()].filter((record) => record.state === "PRODUCTION");
    records.sort((a, b) => a.changedAt.localeCompare(b.changedAt));
    return records.at(-1) ?? null;
  }

  async all(): Promise<ReleaseRecord[]> {
    return [...(await this.latest()).values()].sort((a, b) => a.changedAt.localeCompare(b.changedAt));
  }
}
