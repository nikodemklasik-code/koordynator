import { createHash } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";

export type BuildInputVector = {
  sourceFp: Digest;
  dependencyFp: Digest;
  configFp: Digest;
  toolchainFp: Digest;
  buildEnvironmentFp: Digest;
  generatedSourcesFp: Digest;
};

export function buildKey(vector: BuildInputVector): Digest {
  return canonicalDigest(vector);
}

export function artifactFingerprint(bytes: Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
