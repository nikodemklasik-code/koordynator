import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileWriteLeaseStore } from "../src/store/write-lease-store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const grant = {
  taskId: "TASK-40",
  revision: 1,
  owner: "opencode-1",
  stage: "CODE" as const,
  repository: "nikodemklasik-code/koordynator",
  branch: "feat/issue-40-contracts",
  paths: ["web/control/chat.html"],
  ttlMs: 60_000
};

describe("FileWriteLeaseStore", () => {
  it("survives process restart so overlapping writers stay blocked", async () => {
    const root = await mkdtemp(join(tmpdir(), "lease-store-"));
    roots.push(root);
    const clock = { now: () => new Date("2026-09-11T15:00:00.000Z") };
    const first = new FileWriteLeaseStore(root, clock);
    const lease = await first.grant(grant);
    const second = new FileWriteLeaseStore(root, clock);
    await expect(second.grant({ ...grant, owner: "opencode-2" })).rejects.toThrow(/WRITE_LEASE_CONFLICT/);
    await second.release(lease.leaseId);
    const third = new FileWriteLeaseStore(root, clock);
    expect((await third.grant({ ...grant, owner: "repair" })).owner).toBe("repair");
  });
});
