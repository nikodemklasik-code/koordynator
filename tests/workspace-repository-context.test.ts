import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceRepositoryContextService } from "../src/control/workspace-repository-context.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace repository context", () => {
  it("returns null when the message does not ask for local files or repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-ws-"));
    roots.push(root);
    await writeFile(join(root, "AGENTS.md"), "rules", "utf8");
    const service = new WorkspaceRepositoryContextService(root);
    expect(await service.fromMessage("cześć, jak działa czat?")).toBeNull();
  });

  it("loads bounded local repo tree and matching files after an explicit workspace request", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-ws-files-"));
    roots.push(root);
    await writeFile(join(root, "AGENTS.md"), "Use hermetic builds.", "utf8");
    await mkdir(join(root, "src", "control"), { recursive: true });
    await writeFile(join(root, "src", "control", "server.ts"), "export const ok = true;\n", "utf8");
    await writeFile(join(root, "package.json"), "{\"name\":\"demo\"}\n", "utf8");

    const service = new WorkspaceRepositoryContextService(root);
    const context = await service.fromMessage("wejdź w lokalne repo i pokaż pliki w src/control");
    expect(context).not.toBeNull();
    expect(context?.source).toBe("LOCAL_WORKSPACE");
    expect(context?.files).toEqual(expect.arrayContaining(["AGENTS.md", "src/control/server.ts", "package.json"]));
    expect(context?.context).toContain("--- FILE src/control/server.ts ---");
    expect(context?.context).toContain("export const ok = true;");
  });
});
