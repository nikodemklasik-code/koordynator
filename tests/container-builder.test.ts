import { describe, expect, it } from "vitest";
import { containerRunArgs, ContainerHermeticBuilder, type ContainerHermeticBuildPlan } from "../src/build/container-hermetic-builder.js";

const pinnedImage = `node@sha256:${"a".repeat(64)}`;

function plan(): ContainerHermeticBuildPlan {
  return {
    kind: "container",
    runtime: "docker",
    image: pinnedImage,
    sourceDir: ".",
    command: "node",
    args: ["build.mjs"],
    artifactPaths: ["dist"],
    timeoutMs: 10_000,
    maxOutputBytes: 128_000,
    memoryMb: 512,
    cpus: 1,
    pidsLimit: 64
  };
}

describe("container hermetic builder contract", () => {
  it("forces pinned image, no network, no capabilities and no-new-privileges", () => {
    const args = containerRunArgs(plan(), "/tmp/workspace");
    expect(args).toContain("--network=none");
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("--security-opt=no-new-privileges");
    expect(args).toContain("--read-only");
    expect(args).toContain(pinnedImage);
  });

  it("refuses unpinned container images before execution", () => {
    expect(() => new ContainerHermeticBuilder({ ...plan(), image: "node:22" })).toThrow("CONTAINER_IMAGE_MUST_BE_PINNED_BY_SHA256");
  });
});
