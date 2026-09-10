import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createControlServer } from "../src/control/server.js";

describe("Control UI polish contract", () => {
  it("serves the shared polish layer and exposes only working primary navigation", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-ui-polish-"));
    const server = createControlServer({ stateDir: root, webRoot: join(process.cwd(), "web", "control") });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("CONTROL_UI_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;

      const cssResponse = await fetch(`${base}/control-ui.css`);
      expect(cssResponse.status).toBe(200);
      expect(cssResponse.headers.get("content-type")).toContain("text/css");
      const css = await cssResponse.text();
      expect(css).toContain("--ui-accent");
      expect(css).toContain(".app-shell");
      expect(css).toContain("@media(max-width:760px)");

      for (const path of ["/", "/providers", "/releases"]) {
        const response = await fetch(`${base}${path}`);
        expect(response.status).toBe(200);
        const page = await response.text();
        expect(page).toContain('/control-ui.css');
        expect(page).not.toContain('href="#"');
        expect(page).not.toContain('aria-disabled="true"');
      }

      const releases = await fetch(`${base}/releases`).then((response) => response.text());
      expect(releases).toContain('id="refreshButton"');
      expect(releases).toContain('id="emptyRefreshButton"');
      expect(releases).toContain('href="/providers"');
      expect(releases).toContain('href="/"');

      const providers = await fetch(`${base}/providers`).then((response) => response.text());
      expect(providers).toContain('id="refreshProviders"');
      expect(providers).toContain('id="copyCommand"');
      expect(providers).not.toContain('href="#policy"');
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
      await rm(root, { recursive: true, force: true });
    }
  });
});
