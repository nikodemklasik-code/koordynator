import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

describe("ai-connect-existing script", () => {
  it("describes only non-interactive existing-session imports in dry-run mode", () => {
    const script = resolve("scripts/ai-connect-existing.mjs");
    const result = spawnSync(process.execPath, [script, "--dry-run"], {
      cwd: resolve("."),
      encoding: "utf8",
      env: process.env
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("AUTO_IMPORT: existing local AI sessions only; no OAuth/login prompts");
    expect(result.stdout).toContain("Codex/OpenAI");
    expect(result.stdout).toContain("Cursor");
    expect(result.stdout).toContain("Zed");
    expect(result.stdout).toContain("Providers requiring fresh consent: skipped");
  });
});
