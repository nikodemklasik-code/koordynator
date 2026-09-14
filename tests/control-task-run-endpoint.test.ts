import { beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];
beforeEach(() => vi.stubEnv("OMNIROUTE_API_KEY", "fixture-gateway-key"));
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function keys() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

async function listen(options: Parameters<typeof createControlServer>[0]) {
  const server = createControlServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_ADDR");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => { server.close(); if (server.listening) await once(server, "close"); }
  };
}

describe("Task run endpoint (chat task → real worker)", () => {
  it("materialises a plan then runs it: the code worker writes and the task reaches BUILD_READY", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-run-http-"));
    roots.push(root);
    // A real git repo is the project root the runner branches from.
    const repo = join(root, "repo");
    execFileSync("git", ["init", "-b", "main", repo]);
    execFileSync("git", ["config", "user.email", "t@k.local"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repo });
    await writeFile(join(repo, "README.md"), "base\n");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "base"], { cwd: repo });

    // Fixture opencode binary: writes a file so the code worker really produces work.
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "opencode"), `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
writeFileSync('from-code-worker.txt','SHIPPED');
process.stdout.write('OpenCode implemented the task');
`, { mode: 0o755 });

    const { base, close } = await listen({
      stateDir: root,
      webRoot: resolve("web/control"),
      projectRoot: repo,
      materialisationPrivateKeyPem: keys(),
      taskRunnerPathPrefix: bin,
      taskRunnerVerifier: async () => ({ command: "npx vitest run", exitCode: 0, status: "PASS" as const })
    });
    try {
      const created = await fetch(`${base}/api/tasks/materialise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Dodać eksport CSV raportów",
          modules: ["reports"],
          allowedPaths: ["src/reports"],
          acceptanceCriteria: ["eksport zwraca CSV", "test pokrywa pusty raport"]
        })
      });
      expect(created.status).toBe(201);
      const task = await created.json() as { taskId: string; state: string };
      expect(task.state).toBe("CREATED");

      const ran = await fetch(`${base}/api/tasks/${task.taskId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(ran.status).toBe(200);
      const receipt = await ran.json() as { state: string; worker: string; branch: string; testVerdict: string };
      expect(receipt.state).toBe("BUILD_READY");
      expect(receipt.worker).toBe("opencode");
      expect(receipt.testVerdict).toBe("PASS");

      // The worker's file really lives on the task branch, main untouched.
      const onBranch = execFileSync("git", ["show", `${receipt.branch}:from-code-worker.txt`], { cwd: repo, encoding: "utf8" });
      expect(onBranch).toContain("SHIPPED");
      expect(execFileSync("git", ["log", "-1", "--pretty=%s", "main"], { cwd: repo, encoding: "utf8" }).trim()).toBe("base");

      // Running a task that is no longer CREATED is rejected.
      const again = await fetch(`${base}/api/tasks/${task.taskId}/run`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}"
      });
      expect(again.status).toBe(409);
    } finally {
      await close();
    }
  });

  it("rejects run for an unknown task id", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-run-404-"));
    roots.push(root);
    const { base, close } = await listen({ stateDir: root, webRoot: resolve("web/control") });
    try {
      const res = await fetch(`${base}/api/tasks/TASK-NOPE-1/run`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}"
      });
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });
});
