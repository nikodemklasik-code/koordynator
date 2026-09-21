import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { CorporateEvent, CorporationSnapshot } from "./domain.js";
import type { CorporateEventStore, CorporationStateStore } from "./ports.js";

export class FileCorporationStateStore implements CorporationStateStore {
  private readonly path: string;

  constructor(stateDir: string) {
    this.path = join(resolve(stateDir), "corporation-v2", "state.json");
  }

  async load(): Promise<CorporationSnapshot | null> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as CorporationSnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(snapshot: CorporationSnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(tmp, this.path);
  }
}

export class FileCorporateEventStore implements CorporateEventStore {
  private readonly path: string;

  constructor(stateDir: string) {
    this.path = join(resolve(stateDir), "corporation-v2", "events.jsonl");
  }

  async append(event: CorporateEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const existing = await readFile(this.path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const next = `${existing}${JSON.stringify(event)}\n`;
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, next, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, this.path);
  }

  async list(limit = 200): Promise<CorporateEvent[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text
        .split("\n")
        .filter(Boolean)
        .slice(-Math.max(1, Math.min(5000, Math.floor(limit))))
        .map((line) => JSON.parse(line) as CorporateEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
