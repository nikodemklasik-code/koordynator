import { canonicalDigest, canonicalJson } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import type { BuildInputVector } from "./build-input.js";
import { listWorkspaceTree } from "./safe-fs.js";

export type TreeFile = { path: string; sha256: Digest; size: number };

export async function listSourceFiles(root: string): Promise<TreeFile[]> {
  return listWorkspaceTree(root);
}

export function sourceFingerprint(files: TreeFile[]): Digest {
  return canonicalDigest({ kind: "source-tree-v1", files });
}

export function toolchainFingerprint(input: {
  nodeVersion: string;
  builder: "process" | "container";
  image?: string;
  command: string;
  args: string[];
}): Digest {
  return canonicalDigest({ kind: "toolchain-v1", ...input, args: [...input.args] });
}

export function environmentFingerprint(input: {
  platform: NodeJS.Platform;
  arch: string;
  hermetic: true;
  network: "none" | "host-process";
  envAllowList: string[];
}): Digest {
  return canonicalDigest({ kind: "environment-v1", ...input, envAllowList: [...input.envAllowList].sort() });
}

export async function measureBuildVector(sourceDir: string, extras: {
  dependencyFp: Digest;
  configFp: Digest;
  generatedSourcesFp: Digest;
  toolchainFp: Digest;
  buildEnvironmentFp: Digest;
}): Promise<{ files: TreeFile[]; vector: BuildInputVector; treeJson: string }> {
  const files = await listSourceFiles(sourceDir);
  const vector: BuildInputVector = {
    sourceFp: sourceFingerprint(files),
    dependencyFp: extras.dependencyFp,
    configFp: extras.configFp,
    generatedSourcesFp: extras.generatedSourcesFp,
    toolchainFp: extras.toolchainFp,
    buildEnvironmentFp: extras.buildEnvironmentFp
  };
  return { files, vector, treeJson: canonicalJson({ kind: "source-tree-v1", files }) };
}

export function assertVectorMatchesSource(vector: BuildInputVector, files: TreeFile[]): void {
  const actual = sourceFingerprint(files);
  if (vector.sourceFp !== actual) throw new Error(`SOURCE_FP_MISMATCH:declared=${vector.sourceFp}:actual=${actual}`);
}
