import { describe, expect, it } from "vitest";
import { WriteLeaseRegistry } from "../src/domain/write-lease.js";

const clock = (iso: string) => ({ now: () => new Date(iso) });

function request(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "TASK-40",
    revision: 1,
    owner: "opencode-1",
    stage: "UI_BUILD" as const,
    repository: "nikodemklasik-code/koordynator",
    branch: "feat/issue-40-contracts",
    paths: ["web/control/chat.html", "web/control/chat.css"],
    ttlMs: 60_000,
    ...overrides
  };
}

describe("WriteLeaseRegistry", () => {
  it("grants a lease to UI_BUILD and blocks an overlapping writer on the same repo+branch+paths", () => {
    const registry = new WriteLeaseRegistry(clock("2026-09-11T13:00:00.000Z"));
    const first = registry.grant(request());
    expect(first.leaseId).toMatch(/^LEASE-/);
    expect(first.taskId).toBe("TASK-40");
    expect(() => registry.grant(request({ owner: "opencode-2", paths: ["web/control/chat.css"] })))
      .toThrow(/WRITE_LEASE_CONFLICT/);
  });

  it("treats a directory prefix as overlapping a nested file", () => {
    const registry = new WriteLeaseRegistry(clock("2026-09-11T13:00:00.000Z"));
    registry.grant(request({ paths: ["web/control"] }));
    expect(() => registry.grant(request({ owner: "other", paths: ["web/control/chat.js"] })))
      .toThrow(/WRITE_LEASE_CONFLICT/);
  });

  it("allows a parallel writer on a disjoint path or a different branch", () => {
    const registry = new WriteLeaseRegistry(clock("2026-09-11T13:00:00.000Z"));
    registry.grant(request());
    expect(registry.grant(request({ owner: "docs", paths: ["docs/SPEC.md"] })).owner).toBe("docs");
    expect(registry.grant(request({ owner: "branch-b", branch: "other" })).owner).toBe("branch-b");
  });

  it("refuses write leases for Codex, Playwright and UI Validator", () => {
    const registry = new WriteLeaseRegistry(clock("2026-09-11T13:00:00.000Z"));
    for (const stage of ["CODE_REVIEW", "BROWSER_TEST", "UI_VALIDATION"] as const) {
      expect(() => registry.grant(request({ stage }))).toThrow(/WRITE_LEASE_ROLE_FORBIDDEN/);
    }
  });

  it("releases after a receipt so the next writer can proceed", () => {
    const registry = new WriteLeaseRegistry(clock("2026-09-11T13:00:00.000Z"));
    const lease = registry.grant(request());
    registry.release(lease.leaseId);
    expect(registry.grant(request({ owner: "repair" })).owner).toBe("repair");
  });

  it("does not let an expired lease be stolen while the process is still alive", () => {
    let now = "2026-09-11T13:00:00.000Z";
    const registry = new WriteLeaseRegistry({ now: () => new Date(now) });
    const lease = registry.grant(request({ ttlMs: 1_000 }));
    now = "2026-09-11T13:00:05.000Z";
    expect(() => registry.recover(lease.leaseId, { processAlive: true }))
      .toThrow(/WRITE_LEASE_HOLDER_ALIVE/);
    const recovered = registry.recover(lease.leaseId, { processAlive: false });
    expect(recovered.recoveryReceipt).toBe(true);
    expect(registry.grant(request({ owner: "takeover" })).owner).toBe("takeover");
  });

  it("blocks a worker that has no live lease", () => {
    const registry = new WriteLeaseRegistry(clock("2026-09-11T13:00:00.000Z"));
    expect(registry.require("LEASE-missing")).toMatchObject({ status: "BLOCKED", reason: "WRITE_LEASE_MISSING" });
  });
});
