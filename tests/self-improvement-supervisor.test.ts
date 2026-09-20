import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SelfImprovementSupervisor } from "../src/control/self-improvement-supervisor.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "koord-self-improve-"));
  roots.push(root);
  return root;
}

describe("SelfImprovementSupervisor", () => {
  it("detects a stopped Hermes instance and safely self-heals it with a verified receipt", async () => {
    const root = await fixture();
    let running = false;
    let starts = 0;

    const supervisor = new SelfImprovementSupervisor({
      stateDir: root,
      enabled: true,
      autoRepairLowRisk: true,
      githubStatus: async () => ({ state: "CONNECTED", repositoryAccess: true, connectionMethod: "GH_CLI" }),
      hermesStatus: () => ({ running, sessionId: running ? "session-1" : null, pid: running ? 1234 : null }),
      hermesGrant: async () => ({ terminal: true, localFiles: true }),
      omniRoutes: async () => [{
        providerId: "omni-opencode-free",
        family: "opencode-free",
        label: "OpenCode Free",
        model: "oc/big-pickle",
        health: "HEALTHY",
        connectAction: "READY",
        detail: "Live inference probe passed",
        checkedAt: new Date().toISOString()
      }],
      startHermes: async () => {
        starts += 1;
        running = true;
        return { sessionId: "session-1", pid: 1234 };
      }
    });

    const snapshot = await supervisor.scan(true);
    const incident = snapshot.incidents.find((item) => item.kind === "HERMES_STOPPED");

    expect(starts).toBe(1);
    expect(incident?.status).toBe("VERIFIED");
    expect(snapshot.receipts[0]?.status).toBe("PASS");
    expect(snapshot.receipts[0]?.action).toBe("START_HERMES");

    const persisted = JSON.parse(await readFile(join(root, "self-improvement", "state.json"), "utf8"));
    expect(persisted.receipts[0].status).toBe("PASS");
  });

  it("never auto-authorizes GitHub and surfaces free-tier opportunities as approval items", async () => {
    const root = await fixture();

    const supervisor = new SelfImprovementSupervisor({
      stateDir: root,
      enabled: true,
      githubStatus: async () => ({ state: "AUTH_REQUIRED", repositoryAccess: false, connectionMethod: "NONE" }),
      hermesStatus: () => ({ running: true, sessionId: "session-2", pid: 2222 }),
      hermesGrant: async () => ({ terminal: true, localFiles: true }),
      omniRoutes: async () => [{
        providerId: "omni-gemini",
        family: "gemini",
        label: "Gemini CLI",
        model: "-",
        health: "AUTH_REQUIRED",
        connectAction: "AUTH",
        detail: "Login required",
        checkedAt: new Date().toISOString()
      }]
    });

    const snapshot = await supervisor.scan(true);
    const github = snapshot.incidents.find((item) => item.kind === "GITHUB_AUTH");

    expect(github?.approvalRequired).toBe(true);
    expect(github?.repairAction).toBe("NONE");
    expect(snapshot.opportunities).toHaveLength(1);
    expect(snapshot.opportunities[0]?.family).toBe("gemini");
    expect(snapshot.opportunities[0]?.requiresApproval).toBe(true);
    expect(snapshot.policy.paidFallbackAutoEnable).toBe(false);
    expect(snapshot.policy.secretScraping).toBe(false);
  });

  it("pauses background-style scans but permits an explicit forced scan", async () => {
    const root = await fixture();
    let probes = 0;

    const supervisor = new SelfImprovementSupervisor({
      stateDir: root,
      enabled: true,
      githubStatus: async () => {
        probes += 1;
        return { state: "CONNECTED", repositoryAccess: true };
      },
      hermesStatus: () => ({ running: true }),
      hermesGrant: async () => ({ terminal: true }),
      omniRoutes: async () => []
    });

    await supervisor.setPaused(true);
    const paused = await supervisor.scan(false);
    expect(paused.paused).toBe(true);
    expect(probes).toBe(0);

    const forced = await supervisor.scan(true);
    expect(forced.lastScanAt).not.toBeNull();
    expect(probes).toBe(1);
  });

  it("enforces a single bounded repair lease and refuses unavailable repairs", async () => {
    const root = await fixture();

    const supervisor = new SelfImprovementSupervisor({
      stateDir: root,
      enabled: true,
      autoRepairLowRisk: false,
      githubStatus: async () => ({ state: "AUTH_REQUIRED", repositoryAccess: false }),
      hermesStatus: () => ({ running: true }),
      hermesGrant: async () => ({ terminal: true }),
      omniRoutes: async () => [{
        providerId: "omni-opencode-free",
        family: "opencode-free",
        label: "OpenCode Free",
        model: "oc/big-pickle",
        health: "HEALTHY",
        connectAction: "READY",
        detail: "ok",
        checkedAt: new Date().toISOString()
      }]
    });

    const snapshot = await supervisor.scan(true);
    const incident = snapshot.incidents.find((item) => item.kind === "GITHUB_AUTH");
    expect(incident).toBeDefined();

    await expect(supervisor.repair(incident!.incidentId, false))
      .rejects.toMatchObject({ code: "SELF_IMPROVEMENT_APPROVAL_REQUIRED" });

    await expect(supervisor.repair(incident!.incidentId, true))
      .rejects.toMatchObject({ code: "SELF_IMPROVEMENT_REPAIR_NOT_AVAILABLE" });
  });
});
