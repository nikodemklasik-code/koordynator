import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import { ProcessHermeticBuilder } from "../src/build/process-hermetic-builder.js";
import type { BuildInputVector } from "../src/build/build-input.js";
import { freezeCandidate } from "../src/domain/candidate.js";
import { ArtifactCommandValidator } from "../src/validators/command-validator.js";
import { executeValidationDag } from "../src/validators/validation-dag.js";
import { DagScheduler } from "../src/scheduler/scheduler.js";
import { MemoryReleaseStore, ReleaseController } from "../src/release/release-controller.js";

const d = (value: unknown) => canonicalDigest(value);
const vector: BuildInputVector = {
  sourceFp: d("source"), dependencyFp: d("deps"), configFp: d("config"), toolchainFp: d("toolchain"),
  buildEnvironmentFp: d("env"), generatedSourcesFp: d("generated")
};

describe("runtime components", () => {
  it("builds in an ephemeral workspace and validates the exact packaged artifact", async () => {
    const source = await mkdtemp(join(tmpdir(), "orch-source-"));
    try {
      await writeFile(join(source, "build.mjs"), `import { mkdir, writeFile } from 'node:fs/promises';\nawait mkdir('dist',{recursive:true});\nawait writeFile('dist/app.mjs',\"process.exit(process.env.ORCHESTRATOR_VALIDATION==='1'?0:7)\\n\");\n`, "utf8");
      const builder = new ProcessHermeticBuilder({
        sourceDir: source, command: process.execPath, args: ["build.mjs"], artifactPaths: ["dist"], timeoutMs: 10_000, maxOutputBytes: 128_000
      });
      const artifact = await builder.build(vector);
      expect(artifact.bytes.length).toBeGreaterThan(0);
      expect(builder.lastReceipt?.exitCode).toBe(0);

      const candidate = freezeCandidate(
        { taskId: "TASK-RUNTIME", workspaceId: "WS-RUNTIME", buildId: "BUILD-RUNTIME", revision: 0 },
        { sourceFp: vector.sourceFp, dependencyFp: vector.dependencyFp, configFp: vector.configFp, toolchainFp: vector.toolchainFp,
          buildEnvironmentFp: vector.buildEnvironmentFp, moduleManifestFp: d("module"), artifactFp: d(artifact.bytes) },
        "2026-09-04T20:00:00.000Z"
      );
      const validation = await executeValidationDag([
        new ArtifactCommandValidator({ gate: "unit", kind: "dependency", command: process.execPath, args: ["dist/app.mjs"] })
      ], ["unit"], {
        candidate, artifactBytes: artifact.bytes, policyFp: d("policy"), componentFp: vector.sourceFp,
        dependencyFp: vector.dependencyFp, configFp: vector.configFp, toolchainFp: vector.toolchainFp,
        environmentFp: vector.buildEnvironmentFp, now: "2026-09-04T20:01:00.000Z"
      });
      expect(validation.passed).toBe(true);
      expect(validation.receipts[0]?.status).toBe("PASS");
    } finally { await rm(source, { recursive: true, force: true }); }
  });

  it("marks a missing required validator UNEXECUTED and fail-closed", async () => {
    const candidate = freezeCandidate(
      { taskId: "TASK-MISSING", workspaceId: "WS-MISSING", buildId: "BUILD-MISSING", revision: 0 },
      { sourceFp: d("s"), dependencyFp: d("d"), configFp: d("c"), toolchainFp: d("t"), buildEnvironmentFp: d("e"), moduleManifestFp: d("m"), artifactFp: d("a") },
      "2026-09-04T20:00:00.000Z"
    );
    const result = await executeValidationDag([], ["security"], {
      candidate, artifactBytes: Buffer.from("x"), policyFp: d("p"), componentFp: d("s"), dependencyFp: d("d"),
      configFp: d("c"), toolchainFp: d("t"), environmentFp: d("e"), now: "2026-09-04T20:00:00.000Z"
    });
    expect(result.passed).toBe(false);
    expect(result.receipts[0]?.status).toBe("UNEXECUTED");
  });

  it("schedules by dependencies with bounded resources and tenant concurrency", async () => {
    const scheduler = new DagScheduler({ cpu: 2, memoryMb: 512, maxConcurrent: 2, maxConcurrentPerTenant: 1 });
    const seen: string[] = [];
    const result = await scheduler.run([
      { id: "a", deps: [], tenantId: "t1", priority: 1, securityClass: "S1", resources: { cpu: 1, memoryMb: 64 }, run: async () => { seen.push("a"); return "A"; } },
      { id: "b", deps: [], tenantId: "t2", priority: 3, securityClass: "S5", resources: { cpu: 1, memoryMb: 64 }, run: async () => { seen.push("b"); return "B"; } },
      { id: "c", deps: ["a", "b"], tenantId: "t1", priority: 2, securityClass: "S2", resources: { cpu: 1, memoryMb: 64 }, run: async () => { seen.push("c"); return "C"; } }
    ]);
    expect(new Set(result.executionOrder.slice(0, 2))).toEqual(new Set(["a", "b"]));
    expect(result.executionOrder.at(-1)).toBe("c");
    expect(result.results.get("c")).toBe("C");
  });

  it("promotes canary and rolls back to the exact previous production release", async () => {
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 8, 4, 21, 0, tick++)).toISOString();
    const store = new MemoryReleaseStore();
    const controller = new ReleaseController(store, (digest) => ({ signatureFp: d({ digest, key: "release" }) }), clock);
    const makeCandidate = (revision: number) => freezeCandidate(
      { taskId: "TASK-REL", workspaceId: "WS-REL", buildId: `BUILD-REL-${revision}` as `BUILD-${string}`, revision },
      { sourceFp: d(`s${revision}`), dependencyFp: d("d"), configFp: d("c"), toolchainFp: d("t"), buildEnvironmentFp: d("e"), moduleManifestFp: d("m"), artifactFp: d(`a${revision}`) },
      clock()
    );
    const r1 = await controller.promote((await controller.canary(makeCandidate(0), d("ap1"), d("p"))).release.releaseSha);
    const r2 = await controller.promote((await controller.canary(makeCandidate(1), d("ap2"), d("p"))).release.releaseSha);
    expect((await store.get(r1.release.releaseSha))?.state).toBe("ROLLED_BACK");
    expect(r2.state).toBe("PRODUCTION");
    const restored = await controller.rollback(r2.release.releaseSha);
    expect(restored.release.releaseSha).toBe(r1.release.releaseSha);
    expect(restored.state).toBe("PRODUCTION");
  });
});
