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

async function listen(options: Parameters<typeof createControlServer>[0]) {
  const server = createControlServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("CONTROL_AUTHZ_TEST_ADDRESS");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

describe("Control authz", () => {
  it("keeps loopback open when no token is configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-control-authz-open-"));
    roots.push(root);
    const { server, base } = await listen({ stateDir: root, webRoot: resolve("web/control") });
    try {
      const response = await fetch(`${base}/api/tasks`);
      expect(response.status).toBe(200);
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });

  it("rejects API calls without a token when controlToken is set", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-control-authz-deny-"));
    roots.push(root);
    const { server, base } = await listen({
      stateDir: root,
      webRoot: resolve("web/control"),
      controlToken: "secret-token"
    });
    try {
      const denied = await fetch(`${base}/api/tasks`);
      expect(denied.status).toBe(401);
      expect(await denied.json()).toEqual({ error: "CONTROL_UNAUTHORIZED" });

      const allowed = await fetch(`${base}/api/tasks`, {
        headers: { authorization: "Bearer secret-token" }
      });
      expect(allowed.status).toBe(200);

      const headerAllowed = await fetch(`${base}/api/tasks`, {
        headers: { "x-control-token": "secret-token" }
      });
      expect(headerAllowed.status).toBe(200);
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });

  it("does not leak internal error messages on 500", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-control-authz-500-"));
    roots.push(root);
    const { server, base } = await listen({ stateDir: root, webRoot: resolve("web/control") });
    try {
      const response = await fetch(`${base}/api/tasks/TASK-missing/next-work-order`);
      const body = await response.json() as Record<string, unknown>;
      if (response.status === 500) {
        expect(body).toEqual({ error: "CONTROL_SERVER_ERROR" });
        expect(body).not.toHaveProperty("message");
      }
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
