import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalDigest, canonicalJson } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";

export type PackedFile = { path: string; sha256: Digest; base64: string };

function assertSafe(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error(`UNSAFE_ARTIFACT_PATH:${path}`);
}

async function collect(root: string, relPath: string): Promise<PackedFile[]> {
  const target = join(root, relPath);
  const info = await stat(target);
  if (info.isFile()) {
    const bytes = await readFile(target);
    return [{
      path: relPath.split(sep).join("/"),
      sha256: canonicalDigest(bytes),
      base64: Buffer.from(bytes).toString("base64")
    }];
  }
  if (!info.isDirectory()) throw new Error(`UNSUPPORTED_ARTIFACT_TYPE:${relPath}`);
  const names = (await readdir(target)).sort();
  const out: PackedFile[] = [];
  for (const name of names) out.push(...await collect(root, join(relPath, name)));
  return out;
}

export async function packWorkspace(workspace: string, artifactPaths: string[]): Promise<{
  bytes: Uint8Array;
  files: PackedFile[];
  sbomFp: Digest;
}> {
  const files: PackedFile[] = [];
  for (const path of [...artifactPaths].sort()) {
    assertSafe(path);
    const full = resolve(workspace, path);
    const rel = relative(workspace, full);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`ARTIFACT_ESCAPES_WORKSPACE:${path}`);
    files.push(...await collect(workspace, path));
  }

  const unique = new Map<string, PackedFile>();
  for (const file of files) unique.set(file.path, file);
  const ordered = [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
  const bytes = Buffer.from(canonicalJson({ format: "orchestrator-artifact-v1", files: ordered }), "utf8");
  return {
    bytes,
    files: ordered,
    sbomFp: canonicalDigest({
      format: "sbom-v1",
      files: ordered.map(({ path, sha256 }) => ({ path, sha256 }))
    })
  };
}
