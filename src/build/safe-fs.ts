import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { Digest } from "../domain/ids.js";

export type WorkspaceFile = { path: string; bytes: Uint8Array };
export type WorkspaceTreeFile = { path: string; sha256: Digest; size: number };

const DEFAULT_SKIP = new Set([".git", "node_modules", ".orchestrator", "dist"]);

function assertRelativePath(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new Error(`UNSAFE_ARTIFACT_PATH:${path}`);
  }
}

function posixPath(rel: string): string {
  return rel.split(sep).join("/");
}

async function assertInsideWorkspace(workspaceRoot: string, candidate: string, rel: string): Promise<string> {
  const canonicalRoot = await realpath(workspaceRoot);
  const prefix = `${canonicalRoot}${sep}`;
  const canonical = await realpath(candidate);
  if (canonical !== canonicalRoot && !canonical.startsWith(prefix)) {
    throw new Error(`ARTIFACT_ESCAPES_WORKSPACE:${rel}`);
  }
  return canonical;
}

export async function collectWorkspaceFiles(workspace: string, relPath: string): Promise<WorkspaceFile[]> {
  assertRelativePath(relPath);
  const root = resolve(workspace);
  const full = resolve(root, relPath);
  const rel = relative(root, full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`ARTIFACT_ESCAPES_WORKSPACE:${relPath}`);

  const out: WorkspaceFile[] = [];

  async function walk(rel: string): Promise<void> {
    const candidate = resolve(root, rel);
    const st = await lstat(candidate);
    if (st.isSymbolicLink()) throw new Error(`SYMLINK_REJECTED:${posixPath(rel)}`);
    const canonical = await assertInsideWorkspace(root, candidate, rel);
    if (st.isFile()) {
      out.push({ path: posixPath(rel), bytes: await readFile(canonical) });
      return;
    }
    if (!st.isDirectory()) throw new Error(`UNSUPPORTED_ARTIFACT_TYPE:${rel}`);
    for (const name of (await readdir(candidate)).sort()) {
      await walk(join(rel, name));
    }
  }

  await walk(rel);
  return out;
}

export async function listWorkspaceTree(
  rootDir: string,
  skip: ReadonlySet<string> = DEFAULT_SKIP
): Promise<WorkspaceTreeFile[]> {
  const root = resolve(rootDir);
  const out: WorkspaceTreeFile[] = [];

  async function walk(dir: string): Promise<void> {
    const names = (await readdir(dir)).sort();
    for (const name of names) {
      if (skip.has(name)) continue;
      const full = join(dir, name);
      const rel = posixPath(relative(root, full));
      const st = await lstat(full);
      if (st.isSymbolicLink()) throw new Error(`SOURCE_SYMLINK_REJECTED:${rel}`);
      if (st.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      const canonical = await assertInsideWorkspace(root, full, rel);
      const bytes = await readFile(canonical);
      out.push({
        path: rel,
        sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        size: bytes.byteLength
      });
    }
  }

  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
