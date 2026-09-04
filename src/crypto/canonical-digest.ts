import { createHash } from "node:crypto";
import type { Digest } from "../domain/ids.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonicalize(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_CANONICAL_NUMBER");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, Json> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item === undefined) throw new Error("UNDEFINED_NOT_CANONICAL");
      result[key] = canonicalize(item);
    }
    return result;
  }
  throw new Error("UNSUPPORTED_CANONICAL_VALUE");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalDigest(value: unknown): Digest {
  const hash = createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  return `sha256:${hash}`;
}
