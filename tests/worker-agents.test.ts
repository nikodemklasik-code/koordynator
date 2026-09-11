import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkerAgent, opencodeModelPlan } from "../src/control/worker-agents.js";

const roots: string[] = [];
async function bin(name: string, script: string): Promise<{ dir: string; cwd: string }> {
  const root = await mkdtemp(join(tmpdir(), "worker-agent-"));
  roots.push(root);
  const dir = join(root, "bin");
  await mkdir(dir);
  await writeFile(join(dir, name), `#!/usr/bin/env node\n${script}\n`, { mode: 0o755 });
  await chmod(join(dir, name), 0o755);
  const cwd = join(root, "repo");
  await mkdir(cwd);
  return { dir, cwd };
}

describe("Worker agents (role → real process)", () => {
  it("resolves a distinct agent per issue-40 role", () => {
    expect(resolveWorkerAgent("research").worker).toBe("hermes");
    expect(resolveWorkerAgent("code").worker).toBe("opencode");
    expect(resolveWorkerAgent("browser").worker).toBe("playwright");
  });

  it("runs the code role through the OpenCode binary and reports its work", async () => {
    const { dir, cwd } = await bin("opencode", `
import {writeFileSync} from 'node:fs';
writeFileSync('feature.txt','done');
process.stdout.write('OpenCode implemented feature');
`);
    const agent = resolveWorkerAgent("code", { pathPrefix: dir });
    const result = await agent.agent({
      taskId: "TASK-CODE-1", branch: "b", cwd,
      objective: "add feature", allowedPaths: ["**"], acceptanceCriteria: ["a"],
      prompt: "do it", endpoint: "http://127.0.0.1:20128/v1", apiKey: "k", model: "cx/test",
      signal: new AbortController().signal
    });
    expect(result.summary).toContain("OpenCode");
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(join(cwd, "feature.txt"), "utf8")).toBe("done");
  });

  it("fails BLOCKED, not fake success, when every model source fails", async () => {
    // Fixture opencode that always exits non-zero: own free models AND the
    // OmniRoute fallback both fail, so the worker reports failure, never fake PASS.
    const { dir, cwd } = await bin("opencode", `process.stderr.write('no model available'); process.exit(1);`);
    const agent = resolveWorkerAgent("code", { pathPrefix: dir });
    await expect(agent.agent({
      taskId: "TASK-CODE-2", branch: "b", cwd,
      objective: "x", allowedPaths: ["**"], acceptanceCriteria: ["a"],
      prompt: "p", endpoint: "http://127.0.0.1:20128/v1", apiKey: "tkt.x", model: "cx/test",
      signal: new AbortController().signal
    })).rejects.toThrow(/WORKER_PROCESS_FAILED/);
  }, 20_000);

  it("keeps the browser role read-only — it runs Playwright, never writes source", () => {
    const browser = resolveWorkerAgent("browser");
    expect(browser.worker).toBe("playwright");
    expect(browser.writes).toBe(false);
    expect(resolveWorkerAgent("code").writes).toBe(true);
    expect(resolveWorkerAgent("research").writes).toBe(false);
  });

  it("plans OpenCode's own free model first, then falls back to OmniRoute", () => {
    // Own source first: a free OpenCode model with no OmniRoute credential.
    const own = opencodeModelPlan({ model: "cx/test", endpoint: "http://127.0.0.1:20128/v1", ticket: "tkt.abc" });
    expect(own[0]!.model).toMatch(/^opencode\/.*free$/);
    expect(own[0]!.baseURL).toBeUndefined();
    expect(own[0]!.apiKey).toBeUndefined();
    // When own models run out, fall back to us (OmniRoute) with the task ticket, never a raw key.
    const last = own.at(-1)!;
    expect(last.model).toBe("cx/test");
    expect(last.baseURL).toBe("http://127.0.0.1:20128/v1");
    expect(last.apiKey).toBe("tkt.abc");
    expect(JSON.stringify(own)).not.toContain("OMNIROUTE_API_KEY");
  });

  it("uses only OmniRoute when no free OpenCode model is offered", () => {
    const plan = opencodeModelPlan({ model: "cc/claude", endpoint: "http://e/v1", ticket: "tkt.x", freeModels: [] });
    expect(plan).toHaveLength(1);
    expect(plan[0]!.model).toBe("cc/claude");
    expect(plan[0]!.apiKey).toBe("tkt.x");
  });
});

import { afterAll } from "vitest";
afterAll(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
