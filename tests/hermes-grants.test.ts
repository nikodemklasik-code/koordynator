import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { HermesGrantStore } from "../src/control/hermes-grant-store.js";
import { prepareHermes } from "../src/runtime/hermes-launch.js";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const settings = { endpoint: "http://127.0.0.1:20128/v1", apiKey: "test-grant-key", model: "cc/claude-test" };

describe("Hermes terminal grants", () => {
  it("assigns terminal access by default and persists reversible operator overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-hermes-grant-"));
    roots.push(root);
    const store = new HermesGrantStore(join(root, ".orchestrator"));

    expect((await store.status()).terminal).toBe(true);
    const initial = await prepareHermes(settings, root, {} as NodeJS.ProcessEnv);
    try {
      const config = JSON.parse(await readFile(join(initial.env.HERMES_HOME!, "config.yaml"), "utf8"));
      expect(config.approvals).toEqual({ mode: "off" });
      expect(config.disabled_toolsets ?? []).not.toContain("terminal");
    } finally { await initial.close(); }

    expect((await store.set("terminal", false)).terminal).toBe(false);
    const disabled = await prepareHermes(settings, root, {} as NodeJS.ProcessEnv);
    try {
      const config = JSON.parse(await readFile(join(disabled.env.HERMES_HOME!, "config.yaml"), "utf8"));
      expect(config.approvals).toEqual({ mode: "smart" });
      expect(config.disabled_toolsets).toContain("terminal");
    } finally { await disabled.close(); }

    expect((await store.set("terminal", true)).terminal).toBe(true);
    await expect(store.grant("terminal", false)).rejects.toThrow("HERMES_GRANT_CONSENT_REQUIRED");
    await expect(store.set("local-files", true, [])).rejects.toThrow("HERMES_LOCAL_ROOT_REQUIRED");

    const localRoot = resolve(root, "allowed");
    const diskGrant = await store.set("local-files", true, [localRoot, localRoot, "relative"]);
    expect(diskGrant).toMatchObject({ terminal: true, localFiles: true, localRoots: [localRoot] });
    const diskOff = await store.set("local-files", false);
    expect(diskOff).toMatchObject({ localFiles: false, localRoots: [localRoot] });
  });
});

describe("Hermes grant HTTP boundary", () => {
  it("reports default-on status and toggles terminal access without losing compatibility", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-hermes-grant-http-"));
    roots.push(root);
    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control")
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("GRANT_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;

      const statusResponse = await fetch(`${base}/api/integrations/hermes-grants`);
      expect(statusResponse.status).toBe(200);
      expect(await statusResponse.json()).toMatchObject({ terminal: true });

      const disabled = await fetch(`${base}/api/integrations/hermes-grants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: "terminal", enabled: false })
      });
      expect(disabled.status).toBe(200);
      expect(await disabled.json()).toMatchObject({ terminal: false });

      const enabled = await fetch(`${base}/api/integrations/hermes-grants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: "terminal", enabled: true })
      });
      expect(enabled.status).toBe(200);
      expect(await enabled.json()).toMatchObject({ terminal: true });

      const approved = await fetch(`${base}/api/integrations/hermes-grants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: "terminal", approved: true })
      });
      expect(approved.status).toBe(200);
      expect(await approved.json()).toMatchObject({ terminal: true });

      const diskRoot = resolve(root, "Documents");
      const localFiles = await fetch(`${base}/api/integrations/hermes-grants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: "local-files", approved: true, roots: [diskRoot] })
      });
      expect(localFiles.status).toBe(200);
      expect(await localFiles.json()).toMatchObject({ localFiles: true, localRoots: [diskRoot] });

      const page = await fetch(`${base}/providers`).then((response) => response.text());
      expect(page).toContain('id="hermesGrantCard"');
      expect(page).toContain('id="hermesGrantApprove"');
      const client = await fetch(`${base}/providers.js`).then((response) => response.text());
      expect(client).toContain("/api/integrations/hermes-grants");
      expect(client).toContain("approved: true");
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
