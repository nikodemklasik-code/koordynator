import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Releases screen responsiveness", () => {
  it("uses fluid tracks and scrollable regions instead of fixed pixel geometry", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-releases-responsive-"));
    roots.push(root);
    const server = createControlServer({ stateDir: root, webRoot: join(process.cwd(), "web", "control") });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("NO_ADDR");
      const base = `http://127.0.0.1:${address.port}`;
      const css = await fetch(`${base}/releases.css`).then((item) => item.text());

      // Fluid column tracks: no hard-coded side column, KPIs wrap by available width.
      expect(css).not.toContain("minmax(0,1fr) 330px");
      expect(css).toContain("repeat(auto-fit,minmax(");
      expect(css).toContain("clamp(");

      // The dashboard must scroll vertically and the ledger table horizontally.
      expect(css).toMatch(/\.release-content\{[^}]*overflow-y:auto/);
      expect(css).toMatch(/\.table-scroll\{[^}]*overflow:auto/);

      // Short viewports (laptops, split screens) must not be clipped.
      expect(css).toContain("@media(max-height:");

      // Absolutely positioned overlays cannot depend on a fixed header height alone.
      expect(css).not.toContain("min-height:270px");

      const page = await fetch(`${base}/releases`).then((item) => item.text());
      expect(page).toContain('name="viewport"');
      expect(page).toContain("CURRENT PRODUCTION");
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
