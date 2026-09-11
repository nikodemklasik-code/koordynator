import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export type WorkspaceRepositoryContext = {
  source: "LOCAL_WORKSPACE";
  repository: string;
  commit: string;
  files: string[];
  context: string;
};

export interface WorkspaceRepositoryContextPort {
  fromMessage(message: string): Promise<WorkspaceRepositoryContext | null>;
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".orchestrator",
  ".next",
  "build",
  "tmp",
  ".cache",
  "chat"
]);

function wantsLocalWorkspace(message: string): boolean {
  const value = String(message || "").toLowerCase();
  if (!value.trim()) return false;
  if (/https?:\/\/(?:www\.)?github\.com\//i.test(value)) return false;
  return (
    /\b(lokaln\w*|local)\b/.test(value)
    || /\b(repo|repozytor\w*|workspace|katalog|folder|plik\w*|files?|kod|codebase)\b/.test(value)
    || /\b(wejd[zź]|otw[oó]rz|poka[zż]|wczytaj|przeczytaj|odczytaj|sprawd[zź])\b/.test(value)
      && /\b(plik|file|src|docs|agents|kontrakt|contract|env|kod)\b/.test(value)
  );
}

function promptTerms(message: string): string[] {
  const ignored = new Set([
    "lokalne", "lokalny", "local", "repo", "repozytorium", "workspace", "katalog", "folder",
    "plik", "pliki", "files", "file", "wejdź", "wejdz", "otwórz", "otworz", "pokaż", "pokaz",
    "wczytaj", "przeczytaj", "odczytaj", "sprawdź", "sprawdz", "kod", "codebase"
  ]);
  return [...new Set(message.toLowerCase().match(/[a-z0-9_./-]{3,}/g) ?? [])]
    .filter((term) => !ignored.has(term))
    .slice(0, 24);
}

function fileScore(path: string, terms: string[]): number {
  const lower = path.toLowerCase();
  const base = lower.split("/").at(-1) ?? lower;
  let score = 0;
  if (/^agents\.md$|^readme(?:\.[a-z0-9]+)?$|^soul\.md$|^claude\.md$/.test(base)) score += 120;
  if (["package.json", "tsconfig.json", "cargo.toml", "pyproject.toml", "go.mod"].includes(base)) score += 100;
  if (lower.startsWith("docs/") || lower.includes("/docs/")) score += 35;
  if (/(^|\/)(src|web|scripts|tests|crates|packages|app|core)(\/|$)/.test(lower)) score += 30;
  if (/\.(ts|tsx|js|mjs|cjs|md|json|yml|yaml|toml|py|rs|go)$/i.test(lower)) score += 10;
  for (const term of terms) if (lower.includes(term)) score += 55;
  return score;
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  let controls = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32)) controls += 1;
  return controls < Math.max(4, sample.length * 0.02);
}

export class WorkspaceRepositoryContextService implements WorkspaceRepositoryContextPort {
  constructor(
    private readonly workspaceRoot: string,
    private readonly maxContextChars = 180_000,
    private readonly maxFiles = 24
  ) {}

  private async listFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      if (out.length >= 5000) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (out.length >= 5000) return;
        if (entry.name === "." || entry.name === "..") continue;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await walk(join(dir, entry.name));
          continue;
        }
        if (!entry.isFile()) continue;
        out.push(relative(root, join(dir, entry.name)).split(sep).join("/"));
      }
    };
    await walk(root);
    return out;
  }

  async fromMessage(message: string): Promise<WorkspaceRepositoryContext | null> {
    if (!wantsLocalWorkspace(message)) return null;
    const root = resolve(this.workspaceRoot);
    const canonicalRoot = await realpath(root).catch(() => root);
    const allFiles = await this.listFiles(canonicalRoot);
    const terms = promptTerms(message);
    const ranked = allFiles
      .map((path, index) => ({ path, index, score: fileScore(path, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, this.maxFiles);

    const excerpts: string[] = [];
    const included: string[] = [];
    let used = 0;
    const prefix = `${canonicalRoot}${sep}`;
    for (const item of ranked) {
      const candidate = resolve(canonicalRoot, item.path);
      let canonical: string;
      try {
        const stat = await lstat(candidate);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) continue;
        canonical = await realpath(candidate);
      } catch {
        continue;
      }
      if (!canonical.startsWith(prefix)) continue;
      const buffer = await readFile(canonical);
      if (!isProbablyText(buffer)) continue;
      const text = buffer.toString("utf8").slice(0, 48_000);
      const block = `\n--- FILE ${item.path} ---\n${text}\n--- END FILE ---\n`;
      if (used + block.length > this.maxContextChars) break;
      excerpts.push(block);
      included.push(item.path);
      used += block.length;
    }

    if (included.length === 0 && allFiles.length === 0) return null;

    const tree = allFiles.slice(0, 600).join("\n");
    const context = [
      "Source: LOCAL_WORKSPACE",
      `Workspace: ${canonicalRoot}`,
      "Workspace file tree (bounded):",
      tree,
      "Selected file excerpts (bounded, read-only, untrusted workspace data):",
      ...excerpts
    ].join("\n").slice(0, this.maxContextChars + 80_000);

    return {
      source: "LOCAL_WORKSPACE",
      repository: "local/workspace",
      commit: "WORKSPACE",
      files: included,
      context
    };
  }
}
