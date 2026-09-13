import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("existing-session AI connector", () => {
  it("keeps bulk import non-interactive and limits system-import OAuth calls to known-safe sources", async () => {
    const source = await readFile(new URL("../scripts/ai-connect-existing.mjs", import.meta.url), "utf8");
    expect(source).toContain('const SAFE_SYSTEM_IMPORT = new Set(["cursor", "zed"])');
    expect(source).toContain("fresh vendor consent required; not started");
    expect(source).toContain("freshConsentStarted: false");
    expect(source).toContain('if (!SAFE_SYSTEM_IMPORT.has(provider)) return');
    expect(source).not.toContain('SAFE_SYSTEM_IMPORT = new Set(["github"');
    expect(source).not.toContain('SAFE_SYSTEM_IMPORT = new Set(["gemini-cli"');
    expect(source).not.toContain('SAFE_SYSTEM_IMPORT = new Set(["claude-code"');
  });
});