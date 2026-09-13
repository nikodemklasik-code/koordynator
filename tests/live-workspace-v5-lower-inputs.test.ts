import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("Live Workspace V5 lower inputs patch", () => {
  it("lowers chat and Hermes inputs without resizing them", async () => {
    const { stdout } = await execFileAsync(process.execPath, [resolve("scripts/apply-live-workspace-v5-lower-inputs.mjs"), "--self-test"], {
      cwd: process.cwd(),
      timeout: 15_000
    });
    expect(stdout).toContain("LIVE_WORKSPACE_V5_LOWER_INPUTS_SELF_TEST=PASS");
  });
});
