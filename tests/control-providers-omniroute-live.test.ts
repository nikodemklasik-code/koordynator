import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Providers OmniRoute live harness", () => {
  it("exposes Claude/Grok/Codex live OmniRoute statuses and a real connect action endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-providers-live-"));
    roots.push(root);
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/models")) {
        return new Response(JSON.stringify({
          data: [
            { id: "cc/claude-opus-5" },
            { id: "gc/grok-4.5" },
            { id: "cx/gpt-5.5" }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/v1/chat/completions")) {
        const body = typeof init?.body === "string" ? JSON.parse(String(init.body)) : {};
        const model = String(body.model || "");
        if (model.startsWith("cc/") || model.startsWith("gc/")) {
          return new Response(JSON.stringify({ choices: [{ message: { content: "PONG" } }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control"),
      chatEndpoint: "http://127.0.0.1:20128/v1",
      chatApiKey: "test-key",
      chatFetchImpl: fetchImpl
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("NO_ADDR");
      const base = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${base}/api/providers`);
      expect(response.status).toBe(200);
      const fabric = await response.json() as {
        omniRoutes?: Array<{ family: string; model: string; health: string; transport: string; connectAction: string }>;
        providers: Array<{ providerId: string }>;
      };
      expect(fabric.providers.map((item) => item.providerId)).toEqual(expect.arrayContaining([
        "openai-codex-sub", "claude-code-sub"
      ]));
      expect(Array.isArray(fabric.omniRoutes)).toBe(true);
      const families = (fabric.omniRoutes || []).map((item) => item.family).sort();
      expect(families).toEqual(["claude", "codex", "grok"]);
      for (const route of fabric.omniRoutes || []) {
        expect(route.transport).toBe("OMNIROUTE");
        expect(["HEALTHY", "DEGRADED", "RATE_LIMITED", "UNAVAILABLE", "AUTH_REQUIRED"]).toContain(route.health);
        expect(route.connectAction.length).toBeGreaterThan(0);
      }
      const claude = (fabric.omniRoutes || []).find((item) => item.family === "claude");
      expect(claude?.health).toBe("HEALTHY");
      const codex = (fabric.omniRoutes || []).find((item) => item.family === "codex");
      expect(codex?.health).toBe("RATE_LIMITED");

      const doctor = await fetch(`${base}/api/providers/omni-claude/doctor`);
      expect(doctor.status).toBe(200);
      const doctorPayload = await doctor.json() as { health: string; providerId: string };
      expect(doctorPayload.providerId).toBe("omni-claude");
      expect(doctorPayload.health).toBe("HEALTHY");

      const connect = await fetch(`${base}/api/providers/omni-claude/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true })
      });
      expect(connect.status).toBe(200);
      const connectPayload = await connect.json() as { ok: boolean; action: string; command?: string };
      expect(connectPayload.ok).toBe(true);
      expect(connectPayload.action).toMatch(/READY|OPEN|COPY|STATUS/i);

      const page = await fetch(`${base}/providers`).then((item) => item.text());
      expect(page).toContain("OMNIROUTE LIVE HARNESS");
      expect(page).toContain("id=\"omniRouteRows\"");
      const client = await fetch(`${base}/providers.js`).then((item) => item.text());
      expect(client).toContain("omniRoutes");
      expect(client).toContain("/connect");
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  }, 30_000);
});
