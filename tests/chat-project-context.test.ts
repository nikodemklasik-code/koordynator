import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadChatProjectContext } from "../src/control/chat-project-context.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("chat project context", () => {
  it("loads available project guidance files into one system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-context-"));
    roots.push(root);
    await writeFile(join(root, "AGENTS.md"), "Use hermetic builds.", "utf8");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "SPEC_PIN.md"), "Pin exact releases.", "utf8");
    const context = await loadChatProjectContext(root);
    expect(context).toContain("Koordynator project control chat");
    expect(context).toContain("## AGENTS.md");
    expect(context).toContain("Use hermetic builds.");
    expect(context).toContain("## docs/SPEC_PIN.md");
  });

  it("returns null when no guidance files exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-context-empty-"));
    roots.push(root);
    expect(await loadChatProjectContext(root)).toBeNull();
  });
});
