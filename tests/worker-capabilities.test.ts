import { describe, expect, it } from "vitest";
import {
  assertWorkerAction,
  workerCapabilities,
  workerForRole,
  type WorkerKind
} from "../src/domain/worker-registry.js";

describe("Worker capability registry", () => {
  it("gives Hermes, OpenCode, Playwright, audit and deploy disjoint capabilities", () => {
    const hermes = workerCapabilities("hermes");
    const opencode = workerCapabilities("opencode");
    const playwright = workerCapabilities("playwright");
    const audit = workerCapabilities("audit");
    const deploy = workerCapabilities("deploy");

    expect(hermes.write).toBe(false);
    expect(opencode.write).toBe(true);
    expect(playwright.write).toBe(false);
    expect(audit.write).toBe(false);
    expect(deploy.write).toBe(false);

    expect(hermes.tools).not.toEqual(opencode.tools);
    expect(playwright.tools).toEqual(["browser"]);
    expect(audit.tools).toEqual(["fs.read"]);
    expect(deploy.tools).toEqual(["release"]);
    expect(playwright.tools).not.toContain("shell");
    expect(playwright.tools).not.toContain("vault");
  });

  it("keeps Harmonia's cognitive senses out of building — no reading role may write (constitutional invariant)", () => {
    // Roles that read/perceive for Harmonia's cognition must NOT have a hand in building.
    // "A subject able to think an error must not hold the path to execute it."
    const readingWorkers: Exclude<WorkerKind, "coordinator">[] = ["hermes", "playwright", "audit"];
    for (const worker of readingWorkers) {
      const caps = workerCapabilities(worker);
      expect(caps.write, `${worker} must not write`).toBe(false);
      expect(caps.writeLease, `${worker} must not hold a write lease`).toBe(false);
      expect(caps.tools, `${worker} must not carry fs.write`).not.toContain("fs.write");
      expect(() => assertWorkerAction(worker, "fs.write")).toThrow(/WORKER_CAPABILITY_DENIED/);
    }
    // Only the code role (OpenCode) builds.
    expect(workerCapabilities("opencode").write).toBe(true);
    // The reading task roles map only to non-writing workers.
    expect(workerCapabilities(workerForRole("research")).write).toBe(false);
    expect(workerCapabilities(workerForRole("browser")).write).toBe(false);
    expect(workerCapabilities(workerForRole("audit")).write).toBe(false);
    expect(workerCapabilities(workerForRole("code")).write).toBe(true);
  });

  it("forbids a worker from spawning another worker — only the coordinator assigns", () => {
    for (const worker of ["hermes", "opencode", "playwright", "audit", "deploy"] as WorkerKind[]) {
      expect(() => assertWorkerAction(worker, "spawn.hermes")).toThrow(/WORKER_DELEGATION_FORBIDDEN/);
      expect(() => assertWorkerAction(worker, "spawn.opencode")).toThrow(/WORKER_DELEGATION_FORBIDDEN/);
      expect(() => assertWorkerAction(worker, "assign.task")).toThrow(/WORKER_DELEGATION_FORBIDDEN/);
    }
    expect(() => assertWorkerAction("coordinator", "assign.task")).not.toThrow();
  });

  it("blocks Playwright from shell, repo write and Vault", () => {
    expect(() => assertWorkerAction("playwright", "shell")).toThrow(/WORKER_CAPABILITY_DENIED/);
    expect(() => assertWorkerAction("playwright", "fs.write")).toThrow(/WORKER_CAPABILITY_DENIED/);
    expect(() => assertWorkerAction("playwright", "vault.read")).toThrow(/WORKER_CAPABILITY_DENIED/);
    expect(() => assertWorkerAction("playwright", "browser")).not.toThrow();
  });

  it("blocks OpenCode from merge and deploy, and audit from writes", () => {
    expect(() => assertWorkerAction("opencode", "git.merge")).toThrow(/WORKER_CAPABILITY_DENIED/);
    expect(() => assertWorkerAction("opencode", "deploy")).toThrow(/WORKER_CAPABILITY_DENIED/);
    expect(() => assertWorkerAction("opencode", "fs.write")).not.toThrow();
    expect(() => assertWorkerAction("audit", "fs.write")).toThrow(/WORKER_CAPABILITY_DENIED/);
    expect(() => assertWorkerAction("audit", "fs.read")).not.toThrow();
  });

  it("does not let Hermes deploy or hold a write lease", () => {
    expect(() => assertWorkerAction("hermes", "deploy")).toThrow(/WORKER_CAPABILITY_DENIED/);
    expect(() => assertWorkerAction("hermes", "fs.write")).toThrow(/WORKER_CAPABILITY_DENIED/);
    expect(workerCapabilities("hermes").writeLease).toBe(false);
    expect(workerCapabilities("opencode").writeLease).toBe(true);
  });

  it("maps each TaskEnvelope role to the worker issue 40 assigns it", () => {
    // Issue 40 responsibility table: research=Hermes, code=OpenCode,
    // browser=Playwright, audit=audit reader, deploy=separate deploy role.
    expect(workerForRole("research")).toBe("hermes");
    expect(workerForRole("code")).toBe("opencode");
    expect(workerForRole("browser")).toBe("playwright");
    expect(workerForRole("audit")).toBe("audit");
    expect(workerForRole("deploy")).toBe("deploy");
  });

  it("keeps only the code role on a write worker; research/browser/audit stay read-only", () => {
    expect(workerCapabilities(workerForRole("code")).write).toBe(true);
    expect(workerCapabilities(workerForRole("research")).write).toBe(false);
    expect(workerCapabilities(workerForRole("browser")).write).toBe(false);
    expect(workerCapabilities(workerForRole("audit")).write).toBe(false);
  });
});
