import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Tasks project upload", () => {
  it("accepts project packs (txt/pdf) and returns extracted briefing for work-order drafting", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-tasks-upload-"));
    roots.push(root);
    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control")
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("NO_ADDR");
      const base = `http://127.0.0.1:${address.port}`;

      const txt = Buffer.from("Project contract: hermetic builds and exact releases.", "utf8");
      const uploaded = await fetch(`${base}/api/tasks/project-pack`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: [{
            name: "SPEC.txt",
            mimeType: "text/plain",
            size: txt.length,
            dataUrl: `data:text/plain;base64,${txt.toString("base64")}`
          }]
        })
      });
      expect(uploaded.status).toBe(200);
      const payload = await uploaded.json() as {
        packId: string;
        summary: string;
        files: Array<{ name: string }>;
        objectiveHint: string;
      };
      expect(payload.packId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(payload.files.map((item) => item.name)).toContain("SPEC.txt");
      expect(payload.summary).toMatch(/hermetic builds/i);
      expect(payload.objectiveHint.length).toBeGreaterThan(10);

      const pdf = await readFile(resolve("tests/fixtures/hello-koordynator.pdf"));
      const pdfUpload = await fetch(`${base}/api/tasks/project-pack`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: [{
            name: "brief.pdf",
            mimeType: "application/pdf",
            size: pdf.length,
            dataUrl: `data:application/pdf;base64,${pdf.toString("base64")}`
          }]
        })
      });
      expect(pdfUpload.status).toBe(200);
      const pdfPayload = await pdfUpload.json() as { summary: string };
      expect(pdfPayload.summary).toMatch(/Hello Koordynator/i);

      const page = await fetch(`${base}/`).then((item) => item.text());
      expect(page).toContain("id=\"projectPackInput\"");
      expect(page).toMatch(/Upload project pack|Project pack/i);
      const client = await fetch(`${base}/app.js`).then((item) => item.text());
      expect(client).toContain("/api/tasks/project-pack");
      expect(client).toContain("projectPack");
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  }, 30_000);
});
