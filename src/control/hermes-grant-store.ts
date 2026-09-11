import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type HermesGrantName = "terminal";

export type HermesGrantStatus = {
  terminal: boolean;
  updatedAt: string | null;
};

export class HermesGrantError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function grantsFile(root: string): string {
  return join(resolve(root), "hermes-grants.json");
}

export class HermesGrantStore {
  constructor(private readonly root: string) {}

  async status(): Promise<HermesGrantStatus> {
    try {
      const raw = await readFile(grantsFile(this.root), "utf8");
      const parsed = JSON.parse(raw) as { terminal?: unknown; updatedAt?: unknown };
      return {
        terminal: parsed.terminal === true,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { terminal: false, updatedAt: null };
      }
      throw error;
    }
  }

  async grant(name: HermesGrantName, approved: boolean): Promise<HermesGrantStatus> {
    if (name !== "terminal") throw new HermesGrantError("HERMES_GRANT_UNKNOWN", 400);
    if (approved !== true) throw new HermesGrantError("HERMES_GRANT_CONSENT_REQUIRED", 400);
    const current = await this.status();
    const next: HermesGrantStatus = {
      terminal: true,
      updatedAt: new Date().toISOString()
    };
    if (current.terminal) return { ...current, terminal: true };
    await mkdir(resolve(this.root), { recursive: true, mode: 0o700 });
    await writeFile(grantsFile(this.root), `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return next;
  }
}

export async function loadHermesGrants(root: string): Promise<HermesGrantStatus> {
  return new HermesGrantStore(root).status();
}
