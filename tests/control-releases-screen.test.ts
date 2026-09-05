import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import { createControlServer } from "../src/control/server.js";
import { FileReleaseStore } from "../src/release/file-release-store.js";
import { ReleaseController } from "../src/release/release-controller.js";
import { freezeCandidate } from "../src/domain/candidate.js";

const d = (value: string) => canonicalDigest(value);

function candidate(revision: number, artifact: string) {
  return freezeCandidate({ taskId: "TASK-RELEASE-UI", workspaceId: "WS-RELEASE-UI", buildId: `BUILD-RELEASE-UI-R${revision}`, revision }, {
    sourceFp: d(`source-${revision}`), dependencyFp: d("deps"), configFp: d("config"), toolchainFp: d("toolchain"), buildEnvironmentFp: d("env"), moduleManifestFp: d("module"), artifactFp: d(artifact)
  }, `2026-09-05T10:0${revision}:00.000Z`);
}

describe("Control Releases screen", () => {
  it("projects production identity, signed manifest integrity and rollback chain from durable release state", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-releases-"));
    const releaseStore = new FileReleaseStore(join(root, "release"));
    let tick = 0;
    const controller = new ReleaseController(releaseStore, (digest) => ({ signatureFp: d(`sig:${digest}`) }), () => `2026-09-05T10:${String(tick++).padStart(2,"0")}:00.000Z`);
    const server = createControlServer({ stateDir: root, webRoot: join(process.cwd(), "web", "control"), environment: "TEST", version: "0.3.0" });
    try {
      const r0 = await controller.promote((await controller.canary(candidate(0, "artifact-0"), d("approval-0"), d("policy"))).release.releaseSha);
      const r1 = await controller.promote((await controller.canary(candidate(1, "artifact-1"), d("approval-1"), d("policy"))).release.releaseSha);
      expect(r1.previousProductionSha).toBe(r0.release.releaseSha);

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("CONTROL_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;

      const response = await fetch(`${base}/api/releases`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.currentProduction.releaseSha).toBe(r1.release.releaseSha);
      expect(payload.currentProduction.artifactFp).toBe(candidate(1, "artifact-1").artifactFp);
      expect(payload.currentProduction.manifestIntegrity).toBe("PASS");
      expect(payload.counts.production).toBe(1);
      expect(payload.counts.rolledBack).toBe(1);
      expect(payload.releases.every((release: { manifestIntegrity: string }) => release.manifestIntegrity === "PASS")).toBe(true);

      const exact = await fetch(`${base}/api/releases/${encodeURIComponent(r1.release.releaseSha)}`);
      expect(exact.status).toBe(200);
      expect((await exact.json()).previousProductionSha).toBe(r0.release.releaseSha);

      const current = await fetch(`${base}/api/releases/current`).then((item) => item.json());
      expect(current.currentProduction.releaseSha).toBe(r1.release.releaseSha);

      const page = await fetch(`${base}/releases`).then((item) => item.text());
      expect(page).toContain("CURRENT PRODUCTION");
      expect(page).toContain("Release ledger");
      expect(page).toContain("Rollback chain");

      const denied = await fetch(`${base}/api/releases`, { method: "POST" });
      expect(denied.status).toBe(405);
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
      await rm(root, { recursive: true, force: true });
    }
  });
});
