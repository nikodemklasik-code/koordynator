import { describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo = resolve(process.cwd());

describe("Coordinator Router inspector", () => {
  it("ships an overlay drawer with routing receipts and no private chain-of-thought surface", async () => {
    const js = await readFile(join(repo, "web/control/chat-router.js"), "utf8");
    const css = await readFile(join(repo, "web/control/chat-router.css"), "utf8");

    expect(js).toContain("COORDINATOR ROUTER");
    expect(js).toContain("SELECTED SKILL PLAN");
    expect(js).toContain("DETECTED SIGNALS");
    expect(js).toContain("EXECUTION EVENTS");
    expect(js).toContain("koordynatorRouterInspector");
    expect(js).toContain("private model chain-of-thought");
    expect(css).toContain(".router-drawer");
    expect(css).toContain("transform:translateX(102%)");
    expect(css).toContain("width:clamp(420px,44vw,720px)");
  });

  it("patches chat assets and static routes idempotently", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-router-"));
    await mkdir(join(root, "web/control"), { recursive: true });
    await mkdir(join(root, "src/control"), { recursive: true });
    await copyFile(join(repo, "web/control/chat.html"), join(root, "web/control/chat.html"));
    await copyFile(join(repo, "src/control/server.ts"), join(root, "src/control/server.ts"));

    const script = join(repo, "scripts/apply-router-inspector.mjs");
    const first = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("COORDINATOR_ROUTER_INSPECTOR=PASS");
    const second = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    expect(second.status, second.stderr).toBe(0);

    const html = await readFile(join(root, "web/control/chat.html"), "utf8");
    const server = await readFile(join(root, "src/control/server.ts"), "utf8");
    expect(html.match(/chat-router\.css\?v=1/g)?.length).toBe(1);
    expect(html.match(/chat-router\.js\?v=1/g)?.length).toBe(1);
    expect(server.match(/"\/chat-router\.css"/g)?.length).toBe(1);
    expect(server.match(/"\/chat-router\.js"/g)?.length).toBe(1);
    expect(server).toContain('"/chat-v5.css"');
    expect(server).toContain('"/chat-v5.js"');
  });
});
