import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { open } from "node:fs/promises";
import { rename } from "node:fs/promises";
import {
  WriteLeaseRegistry,
  type WriteLease,
  type WriteLeaseClock,
  type WriteLeaseRequest
} from "../domain/write-lease.js";

async function durableWrite(path: string, content: string): Promise<void> {
  const handle = await open(path, "w", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class FileWriteLeaseStore {
  private readonly file: string;
  private readonly registry: WriteLeaseRegistry;
  private hydrated = false;

  constructor(root: string, clock: WriteLeaseClock = { now: () => new Date() }) {
    this.file = join(root, "write-leases.json");
    this.registry = new WriteLeaseRegistry(clock);
  }

  async grant(request: WriteLeaseRequest): Promise<WriteLease> {
    await this.hydrate();
    const lease = this.registry.grant(request);
    await this.flush();
    return lease;
  }

  async release(leaseId: string): Promise<void> {
    await this.hydrate();
    this.registry.release(leaseId);
    await this.flush();
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as { leases?: WriteLease[] };
      if (Array.isArray(raw.leases)) this.registry.restore(raw.leases);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async flush(): Promise<void> {
    await mkdir(join(this.file, ".."), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    await durableWrite(temp, `${JSON.stringify({ leases: this.registry.snapshot() }, null, 2)}\n`);
    await rename(temp, this.file);
  }
}
