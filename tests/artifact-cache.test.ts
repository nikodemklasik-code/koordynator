import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import { buildOrReuse } from "../src/build/build-or-reuse.js";
import { MemoryArtifactRegistry } from "../src/build/memory-artifact-registry.js";
import type { BuildInputVector } from "../src/build/build-input.js";
import type { HermeticBuilder } from "../src/build/hermetic-builder.js";

const d = (x: string) => canonicalDigest(x);
const vector: BuildInputVector = { sourceFp: d("s"), dependencyFp: d("d"), configFp: d("c"), toolchainFp: d("t"), buildEnvironmentFp: d("e"), generatedSourcesFp: d("g") };

it("reuses only a valid, non-revoked artifact with matching bytes", async () => {
  let builds = 0;
  const builder: HermeticBuilder = {
    async build() {
      builds += 1;
      return { bytes: new TextEncoder().encode("artifact"), sbomFp: d("sbom"), provenanceFp: d("prov"), builderIdentityFp: d("builder") };
    }
  };
  const registry = new MemoryArtifactRegistry();
  const first = await buildOrReuse(vector, registry, builder, () => true);
  const second = await buildOrReuse(vector, registry, builder, () => true);
  await registry.revoke(first.artifact.buildKey);
  const third = await buildOrReuse(vector, registry, builder, () => true);
  expect([first.mode, second.mode, third.mode]).toEqual(["BUILD", "REUSE", "BUILD"]);
  expect(builds).toBe(2);
});
