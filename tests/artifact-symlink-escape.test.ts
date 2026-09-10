import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packWorkspace } from "../src/build/artifact-pack.js";
import { collectWorkspaceFiles, listWorkspaceTree } from "../src/build/safe-fs.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace symlink isolation", () => {
  it("rejects an artifact symlink that escapes the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-symlink-artifact-"));
    roots.push(root);
    const dist = join(root, "dist");
    await mkdir(dist);
    await symlink("/etc/hosts", join(dist, "secret"));
    await expect(packWorkspace(root, ["dist"])).rejects.toThrow(/SYMLINK_REJECTED|ARTIFACT_ESCAPES_WORKSPACE/);
    await expect(collectWorkspaceFiles(root, "dist")).rejects.toThrow(/SYMLINK_REJECTED|ARTIFACT_ESCAPES_WORKSPACE/);
  });

  it("rejects a source tree symlink when fingerprinting", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-symlink-source-"));
    roots.push(root);
    await writeFile(join(root, "ok.txt"), "ok\n", "utf8");
    await symlink("/etc/hosts", join(root, "leak"));
    await expect(listWorkspaceTree(root)).rejects.toThrow(/SOURCE_SYMLINK_REJECTED/);
  });

  it("packs regular files inside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-symlink-ok-"));
    roots.push(root);
    const dist = join(root, "dist");
    await mkdir(dist);
    await writeFile(join(dist, "app.js"), "export default 1;\n", "utf8");
    const packed = await packWorkspace(root, ["dist"]);
    expect(packed.files.map((file) => file.path)).toEqual(["dist/app.js"]);
  });
});
