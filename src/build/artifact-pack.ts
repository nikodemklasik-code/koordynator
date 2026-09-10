import { isAbsolute, relative, resolve } from "node:path";
import { canonicalDigest, canonicalJson } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import { collectWorkspaceFiles } from "./safe-fs.js";

export type PackedFile = { path: string; sha256: Digest; base64: string };

function assertSafe(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error(`UNSAFE_ARTIFACT_PATH:${path}`);
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
    const collected = await collectWorkspaceFiles(workspace, path);
    for (const file of collected) {
      files.push({
        path: file.path,
        sha256: canonicalDigest(file.bytes),
        base64: Buffer.from(file.bytes).toString("base64")
      });
    }
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
