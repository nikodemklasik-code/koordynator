import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "../src/control/server.js";
import { SelfImprovementSupervisor } from "../src/control/self-improvement-supervisor.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("self-improvement Control HTTP boundary", () => {
  it("exposes scan, pause/resume and bounded repair receipts", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-self-http-"));
    roots.push(root);

    let hermesRunning = false;
    const supervisor = new SelfImprovementSupervisor({
      stateDir: root,
      enabled: true,
      autoRepairLowRisk: false,
      githubStatus: async () => ({ state: "CONNECTED", repositoryAccess: true, connectionMethod: "GH_CLI" }),
      hermesStatus: () => ({ running: hermesRunning, sessionId: hermesRunning ? "session" : null, pid: hermesRunning ? 4321 : null }),
      hermesGrant: async () => ({ terminal: true, localFiles: true }),
      omniRoutes: async () => [{
        providerId: "omni-opencode-free",
        family: "opencode-free",
        label: "OpenCode Free",
        model: "oc/big-pickle",
        health: "HEALTHY",
        connectAction: "READY",
        detail: "ok",
        checkedAt: new Date().toISOString()
      }],
      startHermes: async () => {
        hermesRunning = true;
        return { sessionId: "session", pid: 4321 };
      }
    });

    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control"),
      selfImprovement: supervisor
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("SELF_IMPROVEMENT_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;

      const initial = await fetch(`${base}/api/self-improvement`);
      expect(initial.status).toBe(200);

      const scan = await fetch(`${base}/api/self-improvement/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true })
      });
      expect(scan.status).toBe(200);
      const snapshot = await scan.json() as any;
      const incident = snapshot.incidents.find((item: any) => item.kind === "HERMES_STOPPED");
      expect(incident?.status).toBe("OPEN");

      const repair = await fetch(`${base}/api/self-improvement/incidents/${incident.incidentId}/repair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: false })
      });
      expect(repair.status).toBe(200);
      expect((await repair.json() as any).status).toBe("PASS");

      const paused = await fetch(`${base}/api/self-improvement/pause`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(paused.status).toBe(200);
      expect((await paused.json() as any).paused).toBe(true);

      const resumed = await fetch(`${base}/api/self-improvement/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(resumed.status).toBe(200);
      expect((await resumed.json() as any).paused).toBe(false);

      const providersPage = await fetch(`${base}/providers`).then((response) => response.text());
      expect(providersPage).toContain('id="selfImprovementCard"');
      expect(providersPage).toContain('id="selfImprovementScanButton"');

      const providersJs = await fetch(`${base}/providers.js`).then((response) => response.text());
      expect(providersJs).toContain("/api/self-improvement/scan");
      expect(providersJs).toContain("repairSelfImprovementIncident");
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
