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

  it("keeps chat and terminal composer stacks on the same top and bottom lines", async () => {
    const css = await import("node:fs/promises").then(({ readFile }) => readFile(resolve("web/control/chat-v5.css"), "utf8"));
    expect(css).toContain("--v5-input-stack-height: 122px");
    expect(css.match(/height: var\(--v5-input-stack-height\) !important;/g)?.length).toBeGreaterThanOrEqual(3);
    expect(css).toContain("bottom: 0 !important");
    expect(css).toContain("margin-bottom: 0 !important");
  });
});
