import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type OwnerPushGrant = {
  id: string;
  repository: string;
  branch: string;
  issuedAt: string;
  expiresAt: string;
  source: "chat" | "terminal";
};

type GrantFile = { grants: OwnerPushGrant[] };

export class OwnerPushGrantStore {
  readonly path: string;
  constructor(path: string) {
    this.path = resolve(path);
  }

  async grant(input: { repository: string; branch: string; source: "chat" | "terminal"; ttlMs?: number }): Promise<OwnerPushGrant> {
    const now = new Date();
    const ttlMs = Math.min(Math.max(input.ttlMs ?? 5 * 60_000, 30_000), 15 * 60_000);
    const grant: OwnerPushGrant = {
      id: randomUUID(),
      repository: input.repository,
      branch: input.branch,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      source: input.source
    };
    const current = await this.load();
    const grants = current.grants
      .filter((item) => Date.parse(item.expiresAt) > now.getTime())
      .filter((item) => !(item.repository.toLowerCase() === grant.repository.toLowerCase() && item.branch === grant.branch));
    grants.push(grant);
    await this.save({ grants });
    return grant;
  }

  async list(): Promise<OwnerPushGrant[]> {
    const now = Date.now();
    return (await this.load()).grants.filter((item) => Date.parse(item.expiresAt) > now);
  }

  private async load(): Promise<GrantFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as GrantFile;
      return { grants: Array.isArray(parsed.grants) ? parsed.grants : [] };
    } catch {
      return { grants: [] };
    }
  }

  private async save(value: GrantFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, this.path);
  }
}
