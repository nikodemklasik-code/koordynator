import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import { SealedHermeticBuilder } from "../src/build/sealed-hermetic-builder.js";
import { artifactFingerprint, buildKey } from "../src/build/build-input.js";
import { buildOrReuse } from "../src/build/build-or-reuse.js";
import { MemoryArtifactRegistry } from "../src/build/memory-artifact-registry.js";
import { verifyStoredArtifactAttestation } from "../src/build/attestation.js";
import {
  environmentFingerprint,
  measureBuildVector,
  toolchainFingerprint
} from "../src/build/tree-fingerprint.js";

const empty = canonicalDigest("none");

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sealed-src-"));
  await writeFile(join(root, "build.mjs"), "import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('dist',{recursive:true}); writeFileSync('dist/app.txt','ok');\n");
  await mkdir(join(root, "dist"), { recursive: true });
  return root;
}

function fingerprints(command: string, args: string[]) {
  return {
    toolchainFp: toolchainFingerprint({ nodeVersion: process.version, builder: "process", command, args }),
    buildEnvironmentFp: environmentFingerprint({
      platform: process.platform,
      arch: process.arch,
      hermetic: true,
      network: "host-process",
      envAllowList: []
    })
  };
}

describe("SealedHermeticBuilder", () => {
  it("refuses a declared source fingerprint that does not match source bytes", async () => {
    const sourceDir = await fixture();
    try {
      const args = ["build.mjs"];
      const fp = fingerprints(process.execPath, args);
      const builder = new SealedHermeticBuilder({
        sourceDir, command: process.execPath, args, artifactPaths: ["dist"], timeoutMs: 10_000, maxOutputBytes: 1_000_000
      });
      await expect(builder.build({
        sourceFp: canonicalDigest("wrong-tree"),
        dependencyFp: empty,
        configFp: empty,
        generatedSourcesFp: empty,
        ...fp
      })).rejects.toThrow(/SOURCE_FP_MISMATCH/);
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("builds measured source, signs attestation and reuses only under the trusted public key", async () => {
    const sourceDir = await fixture();
    try {
      const keys = generateKeyPairSync("ed25519");
      const args = ["build.mjs"];
      const fp = fingerprints(process.execPath, args);
      const measured = await measureBuildVector(sourceDir, {
        dependencyFp: empty,
        configFp: empty,
        generatedSourcesFp: empty,
        ...fp
      });
      const builder = new SealedHermeticBuilder({
        sourceDir, command: process.execPath, args, artifactPaths: ["dist"], timeoutMs: 10_000, maxOutputBytes: 1_000_000
      }, keys.privateKey, "builder-test");
      const registry = new MemoryArtifactRegistry();
      const verifier = (artifact: Parameters<typeof verifyStoredArtifactAttestation>[0]) =>
        verifyStoredArtifactAttestation(artifact, (keyId) => {
          if (keyId !== "builder-test") throw new Error("UNKNOWN_BUILDER_KEY");
          return keys.publicKey;
        });

      const first = await buildOrReuse(measured.vector, registry, builder, verifier);
      expect(first.mode).toBe("BUILD");
      expect(first.artifact.artifactFp).toBe(artifactFingerprint(first.artifact.bytes));
      expect(first.artifact.attestationKeyId).toBe("builder-test");
      expect(verifier(first.artifact)).toBe(true);
      expect((await buildOrReuse(measured.vector, registry, builder, verifier)).mode).toBe("REUSE");

      await registry.revoke(buildKey(measured.vector));
      expect((await buildOrReuse(measured.vector, registry, builder, verifier)).mode).toBe("BUILD");
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("changes source fingerprint after one byte changes", async () => {
    const sourceDir = await fixture();
    try {
      const args = ["build.mjs"];
      const fp = fingerprints(process.execPath, args);
      const before = await measureBuildVector(sourceDir, { dependencyFp: empty, configFp: empty, generatedSourcesFp: empty, ...fp });
      await writeFile(join(sourceDir, "input.txt"), "a");
      const after = await measureBuildVector(sourceDir, { dependencyFp: empty, configFp: empty, generatedSourcesFp: empty, ...fp });
      expect(after.vector.sourceFp).not.toBe(before.vector.sourceFp);
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("rejects an unpinned container image before execution", () => {
    expect(() => new SealedHermeticBuilder({
      kind: "container",
      runtime: "docker",
      image: "node:22",
      sourceDir: ".",
      command: "node",
      args: ["build.mjs"],
      artifactPaths: ["dist"],
      timeoutMs: 10_000,
      maxOutputBytes: 100_000
    })).toThrow("CONTAINER_IMAGE_MUST_BE_PINNED_BY_SHA256");
  });
});
