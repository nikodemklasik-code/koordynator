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
  it("denies terminal until explicit consent, then writes approvals off into the managed profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-hermes-grant-"));
    roots.push(root);
    const store = new HermesGrantStore(join(root, ".orchestrator"));
    expect((await store.status()).terminal).toBe(false);
    await expect(store.grant("terminal", false)).rejects.toThrow("HERMES_GRANT_CONSENT_REQUIRED");

    const denied = await prepareHermes(settings, root, {} as NodeJS.ProcessEnv);
    const deniedConfig = JSON.parse(await readFile(join(denied.env.HERMES_HOME, "config.yaml"), "utf8"));
    expect(deniedConfig.approvals).toEqual({ mode: "smart" });
    expect(deniedConfig.disabled_toolsets).toContain("terminal");

    expect((await store.grant("terminal", true)).terminal).toBe(true);
    const allowed = await prepareHermes(settings, root, {} as NodeJS.ProcessEnv);
    const allowedConfig = JSON.parse(await readFile(join(allowed.env.HERMES_HOME, "config.yaml"), "utf8"));
    expect(allowedConfig.approvals).toEqual({ mode: "off" });
    expect(allowedConfig.disabled_toolsets ?? []).not.toContain("terminal");
    expect(allowedConfig.terminal).toMatchObject({ cwd: resolve(root) });
  });
});

describe("Hermes grant HTTP boundary", () => {
  it("reports status, rejects missing consent and grants terminal only after approved=true", async () => {
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
      expect(await statusResponse.json()).toMatchObject({ terminal: false });

      const denied = await fetch(`${base}/api/integrations/hermes-grants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: "terminal", approved: false })
      });
      expect(denied.status).toBe(400);
      expect(await denied.json()).toEqual({ error: "HERMES_GRANT_CONSENT_REQUIRED" });

      const approved = await fetch(`${base}/api/integrations/hermes-grants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: "terminal", approved: true })
      });
      expect(approved.status).toBe(200);
      expect(await approved.json()).toMatchObject({ terminal: true });

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
