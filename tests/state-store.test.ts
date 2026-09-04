import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileStateStore } from "../src/store/file-state-store.js";

it("persists current state and append-only history", async () => {
  const root = await mkdtemp(join(tmpdir(), "koordynator-"));
  try {
    const store = new FileStateStore(root);
    const created = { taskId: "TASK-1" as const, workspaceId: "WS-1" as const, buildId: "BUILD-1" as const, revision: 0, state: "CREATED" as const, changedAt: "2026-09-04T00:00:00Z" };
    const ready = { ...created, state: "READY" as const, changedAt: "2026-09-04T00:00:01Z" };
    await store.save(created);
    await store.save(ready);
    expect((await store.load("TASK-1"))?.state).toBe("READY");
    expect((await store.history("TASK-1")).map((x) => x.state)).toEqual(["CREATED", "READY"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
