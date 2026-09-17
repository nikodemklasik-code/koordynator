import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HermesGrantStore } from "../src/control/hermes-grant-store.js";
import { prepareHermes } from "../src/runtime/hermes-launch.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const settings = { endpoint: "http://127.0.0.1:20128/v1", apiKey: "test-dynamic-key", model: "cx/gpt-test" };
const text = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("Hermes dynamic skills and local files", () => {
  it("keeps old grant files compatible and reads explicit local roots without inventing access", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-hermes-local-grant-"));
    roots.push(root);
    const state = join(root, ".orchestrator");
    await mkdir(state, { recursive: true });
    await writeFile(join(state, "hermes-grants.json"), JSON.stringify({ terminal: true, updatedAt: "2026-09-12T00:00:00.000Z" }));
    const store = new HermesGrantStore(state);
    expect(await store.status()).toMatchObject({ terminal: true, localFiles: false, localRoots: [] });

    const allowed = join(root, "files");
    await mkdir(allowed);
    await writeFile(join(state, "hermes-grants.json"), JSON.stringify({
      terminal: true,
      localFiles: true,
      localRoots: [allowed, "relative-path", allowed],
      updatedAt: "2026-09-12T00:00:01.000Z"
    }));
    expect(await store.status()).toMatchObject({ terminal: true, localFiles: true, localRoots: [resolve(allowed)] });
  });

  it("indexes existing global/project skills and installs the managed routing skill in the isolated profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-hermes-skill-router-"));
    const fakeHome = await mkdtemp(join(tmpdir(), "koord-user-home-"));
    roots.push(root, fakeHome);
    const launch = await prepareHermes(settings, root, {
      HOME: fakeHome,
      HERMES_REAL_HOME: fakeHome,
      KOORDYNATOR_FALLBACK_MODELS: ""
    } as NodeJS.ProcessEnv);
    try {
      const profile = launch.env.HERMES_HOME!;
      const config = JSON.parse(await readFile(join(profile, "config.yaml"), "utf8"));
      expect(config.skills.external_dirs).toEqual(expect.arrayContaining([
        join(fakeHome, ".hermes", "skills"),
        join(fakeHome, ".agents", "skills"),
        resolve(root, "skills"),
        resolve(root, ".orchestrator", "dynamic-skills")
      ]));
      expect(config.skills.inline_shell).toBe(false);
      expect(config.skills.template_vars).toBe(true);

      const skill = await readFile(join(profile, "skills", "koordynator-dynamic-routing", "SKILL.md"), "utf8");
      expect(skill).toContain("skills_list");
      expect(skill).toContain("skill_view");
      expect(skill).toContain("skill_manage");
      expect(skill).toContain("UNEXECUTED and NOT_TESTED are not PASS");

      const soul = await readFile(join(profile, "SOUL.md"), "utf8");
      expect(soul).toContain("inspect the available skill index");
      expect(soul).toContain("test access with the available file/terminal tools first");
      expect(soul).toContain("MACOS_TCC_REQUIRED");
      expect(launch.env.HERMES_REAL_HOME).toBe(resolve(fakeHome));
      expect(launch.env.KOORDYNATOR_LOCAL_FILE_ROOTS).toBe("[]");
    } finally {
      await launch.close();
    }
  });

  it("ships an explicit local-file grant command and never claims to bypass macOS privacy", async () => {
    const scriptPath = new URL("../scripts/hermes-local-files.mjs", import.meta.url).pathname;
    execFileSync(process.execPath, ["--check", scriptPath]);
    const script = await text("scripts/hermes-local-files.mjs");
    const pkg = JSON.parse(await text("package.json"));
    expect(pkg.scripts["hermes:local-files"]).toContain("hermes-local-files.mjs");
    expect(script).toContain("Type YES to grant local-file access");
    expect(script).toContain("MACOS_TCC_REQUIRED");
    expect(script).toContain("Privacy_AllFiles");
    expect(script).toContain("does NOT bypass macOS Privacy & Security");
  });

  it("keeps the complete Hermes transcript scrollable, selectable, copyable and expandable", async () => {
    const js = await text("web/control/chat-usage.js");
    const css = await text("web/control/chat-usage.css");
    expect(js).toContain('id="hermesExpandButton"');
    expect(js).toContain("followTail");
    expect(js).toContain("isNearTranscriptBottom");
    expect(js).toContain("terminal-fullscreen");
    expect(js).toContain("navigator.clipboard.writeText");
    expect(css).toContain("overflow:auto");
    expect(css).toContain("user-select:text");
    expect(css).toContain(".v5-terminal-pane.terminal-fullscreen");
    expect(css).toContain("overscroll-behavior:contain");
  });
});
