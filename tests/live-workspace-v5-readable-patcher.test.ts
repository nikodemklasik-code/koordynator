import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("Live Workspace V5 readable scale patcher", () => {
  it("self-tests readable sizing, V5 labelling and idempotency", async () => {
    const { stdout } = await execFileAsync(process.execPath, [resolve("scripts/apply-live-workspace-v5-readable.mjs"), "--self-test"], {
      cwd: process.cwd(),
      timeout: 15_000
    });
    expect(stdout).toContain("LIVE_WORKSPACE_V5_READABLE_SELF_TEST=PASS");
  });
});
