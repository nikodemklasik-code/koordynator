import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export type HermesGrantName = "terminal";

export type HermesGrantStatus = {
  terminal: boolean;
  localFiles?: boolean;
  localRoots?: string[];
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

function safeRoots(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const roots: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || !isAbsolute(trimmed)) continue;
    const absolute = resolve(trimmed);
    if (!roots.includes(absolute)) roots.push(absolute);
    if (roots.length >= 16) break;
  }
  return roots;
}

export class HermesGrantStore {
  constructor(private readonly root: string) {}

  async status(): Promise<HermesGrantStatus> {
    try {
      const raw = await readFile(grantsFile(this.root), "utf8");
      const parsed = JSON.parse(raw) as { terminal?: unknown; localFiles?: unknown; localRoots?: unknown; updatedAt?: unknown };
      return {
        terminal: parsed.terminal === true,
        localFiles: parsed.localFiles === true,
        localRoots: safeRoots(parsed.localRoots),
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { terminal: false, localFiles: false, localRoots: [], updatedAt: null };
      }
      throw error;
    }
  }

  async grant(name: HermesGrantName, approved: boolean): Promise<HermesGrantStatus> {
    if (name !== "terminal") throw new HermesGrantError("HERMES_GRANT_UNKNOWN", 400);
    if (approved !== true) throw new HermesGrantError("HERMES_GRANT_CONSENT_REQUIRED", 400);
    const current = await this.status();
    const next: HermesGrantStatus = {
      ...current,
      terminal: true,
      updatedAt: new Date().toISOString()
    };
    if (current.terminal) return next;
    await mkdir(resolve(this.root), { recursive: true, mode: 0o700 });
    await writeFile(grantsFile(this.root), `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return next;
  }
}

export async function loadHermesGrants(root: string): Promise<HermesGrantStatus> {
  return new HermesGrantStore(root).status();
}
