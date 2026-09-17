import { beforeEach, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, afterEach } from "vitest";
import { FileStateStore } from "../src/store/file-state-store.js";
import { TaskExecutionRunner } from "../src/control/task-execution-runner.js";
import { MandateAuthority } from "../src/control/mandate-authority.js";
import { WriteLeaseRegistry } from "../src/domain/write-lease.js";
import { FileWriteLeaseStore } from "../src/store/write-lease-store.js";
import type { TaskId, WorkspaceId } from "../src/domain/ids.js";

const roots: string[] = [];
beforeEach(() => vi.stubEnv("OMNIROUTE_API_KEY", "fixture-gateway-key"));
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const TASK = "TASK-DEMO-RUNNER" as TaskId;
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A real local git repo: the runner must work on actual git state, not a mock. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "task-runner-"));
  roots.push(root);
  const repo = join(root, "repo");
  const state = join(root, "state-dir");
  execFileSync("git", ["init", "-b", "main", repo]);
  git(repo, "config", "user.email", "test@koordynator.local");
  git(repo, "config", "user.name", "Test");
  await writeFile(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "base");

  const states = new FileStateStore(join(state, "state"));
  await states.save({
    taskId: TASK,
    workspaceId: "WS-DEMO-RUNNER" as WorkspaceId,
    buildId: "BUILD-DEMO-RUNNER-R1",
    revision: 1,
    state: "CREATED",
    changedAt: "2026-09-11T12:00:00.000Z"
  });
  return { root, repo, state, states };
}

describe("Task execution runner (local, no GitHub)", () => {
  it("runs autonomously and commits locally on a task branch, leaving main untouched", async () => {
    const { repo, state, states } = await fixture();
    const runner = new TaskExecutionRunner({
      stateDir: state,
      projectRoot: repo,
      agent: async (context) => {
        // The agent does real work inside the repo.
        await writeFile(join(repo, "feature.txt"), `zrobione dla ${context.taskId}\n`);
        return { summary: "Dodano feature.txt" };
      }
    });

    const result = await runner.run(TASK);
    expect(result.state).toBe("BUILD_READY");
    expect(result.branch).toMatch(/^koordynator\/task-/);
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);

    // The commit really exists on the task branch.
    expect(git(repo, "log", "-1", "--pretty=%s", result.branch)).toContain(TASK);
    expect(git(repo, "show", `${result.branch}:feature.txt`)).toContain("zrobione");

    // main must NOT have moved: pushing/merging is the operator's decision.
    expect(git(repo, "log", "-1", "--pretty=%s", "main")).toBe("base");

    const history = await states.history(TASK);
    expect(history.map((item) => item.state)).toEqual(["CREATED", "BUILDING", "BUILD_READY"]);

    const receipt = JSON.parse(await readFile(join(state, "task-runs", `${TASK}.json`), "utf8")) as {
      taskId: string; branch: string; commit: string; pushed: boolean;
    };
    expect(receipt.taskId).toBe(TASK);
    expect(receipt.pushed).toBe(false);
    expect(receipt.commit).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("never pushes on its own, and pushes only on explicit approval", async () => {
    const { root, repo, state } = await fixture();
    // A bare remote stands in for the operator's origin.
    const remote = join(root, "remote.git");
    execFileSync("git", ["init", "--bare", "-b", "main", remote]);
    git(repo, "remote", "add", "origin", remote);

    const runner = new TaskExecutionRunner({
      stateDir: state, projectRoot: repo,
      agent: async () => { await writeFile(join(repo, "f.txt"), "x\n"); return { summary: "ok" }; }
    });
    const result = await runner.run(TASK);

    // Nothing reached origin during autonomous execution.
    expect(git(remote, "branch", "--list")).toBe("");

    // Refusing consent must not push either.
    await expect(runner.push(TASK, false)).rejects.toThrow("PUSH_CONSENT_REQUIRED");
    expect(git(remote, "branch", "--list")).toBe("");

    const pushed = await runner.push(TASK, true);
    expect(pushed.pushed).toBe(true);
    expect(pushed.branch).toBe(result.branch);
    expect(git(remote, "branch", "--list")).toContain(result.branch.replace("koordynator/", ""));
  });

  it("marks the task FAILED and leaves the repo clean when the agent fails", async () => {
    const { repo, state, states } = await fixture();
    const runner = new TaskExecutionRunner({
      stateDir: state, projectRoot: repo,
      agent: async () => { throw new Error("AGENT_BLOCKED"); }
    });

    await expect(runner.run(TASK)).rejects.toThrow("AGENT_BLOCKED");
    const current = await states.load(TASK);
    expect(current?.state).toBe("FAILED");
    expect(current?.reasonCode).toBe("AGENT_BLOCKED");
    // The working tree must be back on main with no stray commit.
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("refuses to run a task twice or to run an unknown task", async () => {
    const { repo, state } = await fixture();
    let started = 0;
    const runner = new TaskExecutionRunner({
      stateDir: state, projectRoot: repo,
      agent: async () => { started += 1; await writeFile(join(repo, "a.txt"), "1\n"); return { summary: "ok" }; }
    });
    await runner.run(TASK);
    await expect(runner.run(TASK)).rejects.toThrow("TASK_NOT_RUNNABLE");
    expect(started).toBe(1);
    await expect(runner.run("TASK-NOPE" as TaskId)).rejects.toThrow("TASK_NOT_FOUND");
  });

  it("records a no-op honestly when the agent changes nothing", async () => {
    const { repo, state } = await fixture();
    const runner = new TaskExecutionRunner({
      stateDir: state, projectRoot: repo,
      agent: async () => ({ summary: "nic do zmiany" })
    });
    const result = await runner.run(TASK);
    expect(result.committed).toBe(false);
    expect(result.state).toBe("BUILD_READY");
    expect(git(repo, "log", "-1", "--pretty=%s", "main")).toBe("base");
  });

  it("scopes the agent prompt to the task and forbids pushing or merging", async () => {
    const { repo, state } = await fixture();
    let prompt = "";
    const runner = new TaskExecutionRunner({
      stateDir: state, projectRoot: repo,
      agent: async (context) => { prompt = context.prompt; return { summary: "ok" }; }
    });
    await runner.run(TASK);
    expect(prompt).toContain(TASK);
    expect(prompt).toMatch(/do not push|nie pushuj/i);
    expect(prompt).toMatch(/do not merge|nie scalaj/i);
  });

  it("holds a write lease during the agent and records an independent test receipt", async () => {
    const { repo, state } = await fixture();
    const leases = new WriteLeaseRegistry();
    let held = false;
    const runner = new TaskExecutionRunner({
      stateDir: state,
      projectRoot: repo,
      leases,
      repository: "nikodemklasik-code/koordynator",
      verifier: async () => ({ command: "npx vitest run", exitCode: 0, status: "PASS" as const }),
      agent: async (context) => {
        expect(() => leases.grant({
          taskId: "TASK-OVERLAP",
          revision: 1,
          owner: "other",
          stage: "CODE",
          repository: "nikodemklasik-code/koordynator",
          branch: context.branch,
          paths: ["feature.txt"],
          ttlMs: 60_000
        })).toThrow(/WRITE_LEASE_CONFLICT/);
        held = true;
        await writeFile(join(repo, "feature.txt"), "ok\n");
        return { summary: "ok" };
      }
    });
    const first = await runner.run(TASK);
    expect(held).toBe(true);
    expect(first.testVerdict).toBe("PASS");
    expect(first.writeLeaseId).toMatch(/^LEASE-/);
    expect(leases.grant({
      taskId: "TASK-AFTER",
      revision: 1,
      owner: "next",
      stage: "CODE",
      repository: "nikodemklasik-code/koordynator",
      branch: first.branch,
      paths: ["feature.txt"],
      ttlMs: 60_000
    }).owner).toBe("next");
  });

  it("persists the write lease so a restarted Control still blocks overlapping writers", async () => {
    const { repo, state } = await fixture();
    let heldPath = "";
    const first = new TaskExecutionRunner({
      stateDir: state,
      projectRoot: repo,
      repository: "nikodemklasik-code/koordynator",
      agent: async (context) => {
        heldPath = join(state, "write-leases.json");
        const overlapping = new FileWriteLeaseStore(state);
        await expect(overlapping.grant({
          taskId: "TASK-OVERLAP",
          revision: 1,
          owner: "other",
          stage: "CODE",
          repository: "nikodemklasik-code/koordynator",
          branch: context.branch,
          paths: ["feature.txt"],
          ttlMs: 60_000
        })).rejects.toThrow(/WRITE_LEASE_CONFLICT/);
        await writeFile(join(repo, "feature.txt"), "ok\n");
        return { summary: "ok" };
      }
    });
    await first.run(TASK);
    expect(heldPath).toContain("write-leases.json");
  });

  it("picks the worker from the task role (code → opencode) and holds the lease under that owner", async () => {
    const { repo, state } = await fixture();
    const bin = join(state, "bin");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(bin, { recursive: true }));
    // Fixture opencode binary: writes a file, so the code role really produces work.
    await writeFile(join(bin, "opencode"), `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
writeFileSync('from-opencode.txt','ok');
process.stdout.write('OpenCode did the work');
`, { mode: 0o755 });
    const leases = new WriteLeaseRegistry();
    const owners: string[] = [];
    const spy: typeof leases.grant = (req) => { owners.push(req.owner); return leases.grant(req); };
    const runner = new TaskExecutionRunner({
      stateDir: state,
      projectRoot: repo,
      leases: { grant: spy, release: (id) => leases.release(id) },
      role: "code",
      workerPathPrefix: bin,
      verifier: async () => ({ command: "npx vitest run", exitCode: 0, status: "PASS" as const })
    });
    const result = await runner.run(TASK);
    expect(result.state).toBe("BUILD_READY");
    expect(result.worker).toBe("opencode");
    expect(owners).toEqual(["opencode"]);
    // Post-build reviewer ran on the product and reported without blocking.
    expect(result.review?.blocks).toBe(false);
    expect(result.review?.verdict).toBeDefined();
    expect(git(repo, "show", `${result.branch}:from-opencode.txt`)).toContain("ok");
  });

  it("refuses to run a writing role that has no capability, before spawning anything", async () => {
    const { repo, state } = await fixture();
    // 'research' maps to Hermes (read-only); asking the runner to treat it as a
    // writing task must be rejected by the capability gate, not by the process.
    const runner = new TaskExecutionRunner({
      stateDir: state,
      projectRoot: repo,
      role: "research",
      requireWrite: true
    });
    await expect(runner.run(TASK)).rejects.toThrow(/WORKER_CAPABILITY_DENIED|WORKER_ROLE_NOT_WRITABLE/);
  });

  it("blocks the worker when Harmonia's mandate is suspended — no process, no side effect", async () => {
    const { repo, state } = await fixture();
    const bin = join(state, "bin");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(bin, { recursive: true }));
    // If this binary ever runs it writes a file — its absence proves the gate fired first.
    await writeFile(join(bin, "opencode"), `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
writeFileSync('MANDATE_LEAK.txt','ran');
process.stdout.write('should not happen');
`, { mode: 0o755 });
    const mandate = new MandateAuthority();
    mandate.setState("suspended");
    const runner = new TaskExecutionRunner({
      stateDir: state,
      projectRoot: repo,
      role: "code",
      requireWrite: true,
      workerPathPrefix: bin,
      mandate,
      verifier: async () => ({ command: "npx vitest run", exitCode: 0, status: "PASS" as const })
    });
    await expect(runner.run(TASK)).rejects.toThrow(/MANDATE_NOT_ENABLED/);
    // The worker never ran, so its file must not exist and main is untouched.
    expect(existsSync(join(repo, "MANDATE_LEAK.txt"))).toBe(false);
    // A re-run once Harmonia re-enables the mandate proceeds normally.
    mandate.setState("enabled");
    await writeFile(join(bin, "opencode"), `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
writeFileSync('from-opencode.txt','ok');
process.stdout.write('OpenCode did the work');
`, { mode: 0o755 });
    const result = await runner.run(TASK);
    expect(result.state).toBe("BUILD_READY");
  });
});
