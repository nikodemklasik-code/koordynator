import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type RegisteredRepository = {
  repositoryId: string;
  owner: string;
  name: string;
  url: string;
  defaultBranch?: string;
  notes?: string;
  registeredAt: string;
};

export type RepositoryRegistration = {
  repository: string;
  defaultBranch?: string;
  notes?: string;
};

export class RepositoryRegistryError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "RepositoryRegistryError";
  }
}

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,180}$/;
const MAX_REPOSITORIES = 100;

function invalid(): never {
  throw new RepositoryRegistryError("REPOSITORY_INVALID", 400);
}

function checkSegment(value: string | undefined): string {
  const segment = (value ?? "").trim();
  if (!segment || segment === "." || segment === ".." || segment.length > 100) invalid();
  if (!SEGMENT_RE.test(segment)) invalid();
  return segment;
}

/** Accepts `owner/name`, `https://github.com/owner/name(.git)` and `git@github.com:owner/name(.git)`. */
export function parseRepositoryReference(raw: string): { owner: string; name: string } {
  const value = String(raw ?? "").trim();
  if (!value || value.length > 300) invalid();

  let slug = value;
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try { url = new URL(value); } catch { invalid(); }
    if (url.hostname.toLowerCase() !== "github.com" && url.hostname.toLowerCase() !== "www.github.com") invalid();
    slug = url.pathname.replace(/^\/+/, "");
  } else if (/^git@/i.test(value)) {
    const match = /^git@github\.com:(.+)$/i.exec(value);
    if (!match?.[1]) invalid();
    slug = match[1];
  }

  slug = slug.replace(/\.git$/i, "").replace(/\/+$/, "");
  const parts = slug.split("/");
  if (parts.length !== 2) invalid();
  return { owner: checkSegment(parts[0]), name: checkSegment(parts[1]) };
}

function normalizeBranch(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new RepositoryRegistryError("REPOSITORY_BRANCH_INVALID", 400);
  const branch = value.trim();
  if (!branch) return undefined;
  if (!BRANCH_RE.test(branch) || branch.includes("..")) {
    throw new RepositoryRegistryError("REPOSITORY_BRANCH_INVALID", 400);
  }
  return branch;
}

function normalizeNotes(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new RepositoryRegistryError("REPOSITORY_NOTES_INVALID", 400);
  const notes = value.trim();
  if (!notes) return undefined;
  if (notes.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(notes)) {
    throw new RepositoryRegistryError("REPOSITORY_NOTES_INVALID", 400);
  }
  return notes;
}

function registryFile(root: string): string {
  return join(resolve(root), "repositories.json");
}

/**
 * Durable list of repositories an operator declared as sources/targets for future WorkOrders.
 * Registration is metadata only: nothing is cloned, executed or pushed here.
 */
export class RepositoryRegistry {
  constructor(private readonly root: string) {}

  async list(): Promise<RegisteredRepository[]> {
    let raw: string;
    try {
      raw = await readFile(registryFile(this.root), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return []; }
    const items = Array.isArray((parsed as { repositories?: unknown })?.repositories)
      ? (parsed as { repositories: unknown[] }).repositories
      : [];
    return items
      .filter((item): item is RegisteredRepository =>
        typeof item === "object" && item !== null && typeof (item as RegisteredRepository).repositoryId === "string")
      .sort((a, b) => a.repositoryId.localeCompare(b.repositoryId));
  }

  async register(input: RepositoryRegistration): Promise<RegisteredRepository> {
    const { owner, name } = parseRepositoryReference(input.repository);
    const defaultBranch = normalizeBranch(input.defaultBranch);
    const notes = normalizeNotes(input.notes);
    const repositoryId = `${owner}/${name}`;

    const current = await this.list();
    if (current.some((item) => item.repositoryId.toLowerCase() === repositoryId.toLowerCase())) {
      throw new RepositoryRegistryError("REPOSITORY_ALREADY_REGISTERED", 409);
    }
    if (current.length >= MAX_REPOSITORIES) {
      throw new RepositoryRegistryError("REPOSITORY_REGISTRY_FULL", 409);
    }

    const entry: RegisteredRepository = {
      repositoryId,
      owner,
      name,
      url: `https://github.com/${owner}/${name}`,
      ...(defaultBranch === undefined ? {} : { defaultBranch }),
      ...(notes === undefined ? {} : { notes }),
      registeredAt: new Date().toISOString()
    };
    await this.write([...current, entry]);
    return entry;
  }

  async remove(repository: string): Promise<RegisteredRepository[]> {
    const { owner, name } = parseRepositoryReference(repository);
    const repositoryId = `${owner}/${name}`.toLowerCase();
    const current = await this.list();
    const next = current.filter((item) => item.repositoryId.toLowerCase() !== repositoryId);
    if (next.length === current.length) throw new RepositoryRegistryError("REPOSITORY_NOT_REGISTERED", 404);
    await this.write(next);
    return next;
  }

  private async write(repositories: RegisteredRepository[]): Promise<void> {
    const sorted = [...repositories].sort((a, b) => a.repositoryId.localeCompare(b.repositoryId));
    const directory = resolve(this.root);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = registryFile(this.root);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ repositories: sorted }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }
}
