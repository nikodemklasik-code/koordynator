import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";

export type ExactFileOperation =
  | {
      kind: "create";
      path: string;
      content: string;
      afterFp: Digest;
    }
  | {
      kind: "replace";
      path: string;
      content: string;
      beforeFp: Digest;
      afterFp: Digest;
    };

export type ExactMaterializationPack = {
  packFp: Digest;
  operations: ExactFileOperation[];
};

export type ExactMaterializationReceipt = {
  path: string;
  kind: ExactFileOperation["kind"];
  beforeFp?: Digest;
  afterFp: Digest;
};

function bytesDigest(value: Buffer | string): Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeRelativePath(path: string): string {
  if (!path.trim()) throw new Error("MATERIALIZATION_PATH_REQUIRED");
  if (path.includes("\\")) throw new Error(`MATERIALIZATION_PATH_NOT_PORTABLE:${path}`);
  if (path.startsWith("/")) throw new Error(`MATERIALIZATION_PATH_ABSOLUTE:${path}`);
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`MATERIALIZATION_PATH_INVALID:${path}`);
  }
  return parts.join("/");
}

function scopePatternAllows(pattern: string, path: string): boolean {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "**" || normalized === "**/*") return true;
  if (normalized.endsWith("/**")) {
    const base = normalized.slice(0, -3).replace(/\/$/, "");
    return path === base || path.startsWith(`${base}/`);
  }
  if (normalized.endsWith("/*")) {
    const base = normalized.slice(0, -2).replace(/\/$/, "");
    if (!path.startsWith(`${base}/`)) return false;
    return !path.slice(base.length + 1).includes("/");
  }
  if (normalized.includes("*")) throw new Error(`UNSUPPORTED_SCOPE_PATTERN:${pattern}`);
  return path === normalized;
}

function assertAllowed(path: string, allowedPaths: readonly string[]): void {
  if (allowedPaths.length === 0) throw new Error("MATERIALIZATION_SCOPE_REQUIRED");
  if (!allowedPaths.some((pattern) => scopePatternAllows(pattern, path))) {
    throw new Error(`MATERIALIZATION_PATH_OUT_OF_SCOPE:${path}`);
  }
}

export function exactMaterializationPackFingerprint(operations: readonly ExactFileOperation[]): Digest {
  return canonicalDigest({ kind: "exact-materialization-pack-v1", operations });
}

export function createExactMaterializationPack(operations: ExactFileOperation[]): ExactMaterializationPack {
  return {
    packFp: exactMaterializationPackFingerprint(operations),
    operations
  };
}

export function validateExactMaterializationPack(pack: Readonly<ExactMaterializationPack>): void {
  if (pack.operations.length === 0) throw new Error("MATERIALIZATION_PACK_EMPTY");
  if (pack.packFp !== exactMaterializationPackFingerprint(pack.operations)) {
    throw new Error("MATERIALIZATION_PACK_FINGERPRINT_MISMATCH");
  }

  const seen = new Set<string>();
  for (const operation of pack.operations) {
    const path = normalizeRelativePath(operation.path);
    if (seen.has(path)) throw new Error(`MATERIALIZATION_DUPLICATE_PATH:${path}`);
    seen.add(path);
    if (operation.afterFp !== bytesDigest(operation.content)) {
      throw new Error(`MATERIALIZATION_AFTER_FINGERPRINT_MISMATCH:${path}`);
    }
  }
}

async function readExisting(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function resolveInside(root: string, relativePath: string): string {
  const base = resolve(root);
  const full = resolve(base, relativePath);
  if (!full.startsWith(`${base}${sep}`)) throw new Error(`MATERIALIZATION_PATH_ESCAPE:${relativePath}`);
  return full;
}

async function atomicWrite(path: string, content: Buffer | string, nonce: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.koordynator-${nonce}.tmp`;
  await writeFile(temp, content);
  await rename(temp, path);
}

export async function applyExactMaterializationPack(
  root: string,
  allowedPaths: readonly string[],
  pack: Readonly<ExactMaterializationPack>
): Promise<ExactMaterializationReceipt[]> {
  validateExactMaterializationPack(pack);

  const planned: Array<{
    operation: ExactFileOperation;
    path: string;
    fullPath: string;
    before?: Buffer;
  }> = [];

  for (const operation of pack.operations) {
    const path = normalizeRelativePath(operation.path);
    assertAllowed(path, allowedPaths);
    const fullPath = resolveInside(root, path);
    const before = await readExisting(fullPath);

    if (operation.kind === "create") {
      if (before !== undefined) throw new Error(`MATERIALIZATION_CREATE_ALREADY_EXISTS:${path}`);
    } else {
      if (before === undefined) throw new Error(`MATERIALIZATION_REPLACE_MISSING:${path}`);
      if (bytesDigest(before) !== operation.beforeFp) {
        throw new Error(`MATERIALIZATION_BEFORE_FINGERPRINT_MISMATCH:${path}`);
      }
    }

    planned.push({ operation, path, fullPath, ...(before === undefined ? {} : { before }) });
  }

  const applied: typeof planned = [];
  const receipts: ExactMaterializationReceipt[] = [];

  try {
    for (const [index, item] of planned.entries()) {
      const nonce = `${process.pid}-${Date.now()}-${index}`;
      await atomicWrite(item.fullPath, item.operation.content, nonce);
      const actual = await readFile(item.fullPath);
      const actualFp = bytesDigest(actual);
      if (actualFp !== item.operation.afterFp) {
        throw new Error(`MATERIALIZATION_WRITE_VERIFICATION_FAILED:${item.path}`);
      }
      applied.push(item);
      receipts.push({
        path: item.path,
        kind: item.operation.kind,
        ...(item.before === undefined ? {} : { beforeFp: bytesDigest(item.before) }),
        afterFp: actualFp
      });
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const [index, item] of [...applied].reverse().entries()) {
      try {
        if (item.before === undefined) {
          await rm(item.fullPath, { force: true });
        } else {
          await atomicWrite(item.fullPath, item.before, `rollback-${process.pid}-${Date.now()}-${index}`);
        }
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) throw Object.assign(new Error("MATERIALIZATION_ROLLBACK_FAILED"), { cause: error });
    throw error;
  }

  return receipts;
}
