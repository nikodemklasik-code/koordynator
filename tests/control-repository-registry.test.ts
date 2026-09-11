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

async function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "control-repo-registry-"));
  roots.push(root);
  const server = createControlServer({ stateDir: root, webRoot: resolve("web/control") });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_ADDR");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      if (server.listening) await once(server, "close");
    }
  };
}

function post(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("Tasks repository registry", () => {
  it("registers a repository as a WorkOrder source without executing anything", async () => {
    const { base, close } = await startServer();
    try {
      const empty = await fetch(`${base}/api/repositories`).then((item) => item.json()) as { repositories: unknown[] };
      expect(empty.repositories).toEqual([]);

      const created = await post(base, "/api/repositories", {
        repository: "https://github.com/nikodemklasik-code/koordynator",
        defaultBranch: "main",
        notes: "control plane"
      });
      expect(created.status).toBe(201);
      const payload = await created.json() as {
        repository: { repositoryId: string; owner: string; name: string; url: string; defaultBranch: string; notes?: string };
        repositories: Array<{ repositoryId: string }>;
      };
      expect(payload.repository.repositoryId).toBe("nikodemklasik-code/koordynator");
      expect(payload.repository.owner).toBe("nikodemklasik-code");
      expect(payload.repository.name).toBe("koordynator");
      expect(payload.repository.url).toBe("https://github.com/nikodemklasik-code/koordynator");
      expect(payload.repository.defaultBranch).toBe("main");
      expect(payload.repository.notes).toBe("control plane");
      expect(payload.repositories).toHaveLength(1);

      const listed = await fetch(`${base}/api/repositories`).then((item) => item.json()) as {
        repositories: Array<{ repositoryId: string; registeredAt: string }>;
      };
      expect(listed.repositories.map((item) => item.repositoryId)).toEqual(["nikodemklasik-code/koordynator"]);
      expect(Date.parse(listed.repositories[0]!.registeredAt)).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("accepts short slug and ssh forms, rejects junk and duplicates", async () => {
    const { base, close } = await startServer();
    try {
      const slug = await post(base, "/api/repositories", { repository: "owner/app" });
      expect(slug.status).toBe(201);
      expect((await slug.json() as { repository: { url: string } }).repository.url)
        .toBe("https://github.com/owner/app");

      const ssh = await post(base, "/api/repositories", { repository: "git@github.com:owner/other.git" });
      expect(ssh.status).toBe(201);
      expect((await ssh.json() as { repository: { repositoryId: string } }).repository.repositoryId).toBe("owner/other");

      const duplicate = await post(base, "/api/repositories", { repository: "https://github.com/owner/app" });
      expect(duplicate.status).toBe(409);
      expect((await duplicate.json() as { error: string }).error).toBe("REPOSITORY_ALREADY_REGISTERED");

      for (const bad of ["not a repo", "https://example.com/owner/app", "owner/../app", ""]) {
        const rejected = await post(base, "/api/repositories", { repository: bad });
        expect(rejected.status).toBe(400);
        expect((await rejected.json() as { error: string }).error).toBe("REPOSITORY_INVALID");
      }

      const badBranch = await post(base, "/api/repositories", { repository: "owner/branchy", defaultBranch: "bad branch" });
      expect(badBranch.status).toBe(400);
      expect((await badBranch.json() as { error: string }).error).toBe("REPOSITORY_BRANCH_INVALID");

      const unknownField = await post(base, "/api/repositories", { repository: "owner/x", run: true });
      expect(unknownField.status).toBe(400);
    } finally {
      await close();
    }
  });

  it("removes a registration and keeps the registry durable", async () => {
    const { base, close } = await startServer();
    try {
      await post(base, "/api/repositories", { repository: "owner/keep" });
      await post(base, "/api/repositories", { repository: "owner/drop" });

      const removed = await post(base, "/api/repositories/remove", { repository: "owner/drop" });
      expect(removed.status).toBe(200);
      const payload = await removed.json() as { repositories: Array<{ repositoryId: string }> };
      expect(payload.repositories.map((item) => item.repositoryId)).toEqual(["owner/keep"]);

      const missing = await post(base, "/api/repositories/remove", { repository: "owner/never" });
      expect(missing.status).toBe(404);
      expect((await missing.json() as { error: string }).error).toBe("REPOSITORY_NOT_REGISTERED");
    } finally {
      await close();
    }
  });

  it("exposes the add-repository control on the Tasks screen", async () => {
    const { base, close } = await startServer();
    try {
      const page = await fetch(`${base}/`).then((item) => item.text());
      expect(page).toContain('id="addRepositoryButton"');
      expect(page).toContain('id="repositoryDialog"');
      expect(page).toContain('id="repositoryInput"');
      expect(page).toContain('id="repositoryList"');

      const client = await fetch(`${base}/app.js`).then((item) => item.text());
      expect(client).toContain("/api/repositories");
      expect(client).toContain("/api/repositories/remove");
    } finally {
      await close();
    }
  });
});
