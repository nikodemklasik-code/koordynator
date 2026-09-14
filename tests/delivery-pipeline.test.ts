import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { createControlServer } from "../src/control/server.js";
import { DeliveryProcessStore } from "../src/control/delivery-process-store.js";
import { TaskExecutionRunner, TaskExecutionError } from "../src/control/task-execution-runner.js";
import { FileStateStore } from "../src/store/file-state-store.js";
import type { TaskId, WorkspaceId } from "../src/domain/ids.js";
import type { WorkOrder } from "../src/domain/work-order.js";

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

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function seedChat(root: string, sessionId: string, content: string): Promise<void> {
  await mkdir(join(root, "chat"), { recursive: true, mode: 0o700 });
  await writeFile(join(root, "chat", `${sessionId}.json`), `${JSON.stringify({
    sessionId,
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
    model: "test",
    messages: [{
      id: "m1",
      sessionId,
      role: "user",
      content,
      createdAt: "2026-09-13T00:00:00.000Z",
      state: "complete"
    }]
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

describe("Delivery process (Etap 0 → signed task → isolated run)", () => {
  it("refuses to run without an approved signed process, even if a CREATED task exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "delivery-no-process-"));
    roots.push(root);
    const repo = join(root, "repo");
    execFileSync("git", ["init", "-b", "main", repo]);
    git(repo, "config", "user.email", "t@k.local");
    git(repo, "config", "user.name", "T");
    await writeFile(join(repo, "README.md"), "base\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "base");

    const { base, close } = await listen({
      stateDir: root,
      webRoot: resolve("web/control"),
      projectRoot: repo,
      materialisationPrivateKeyPem: keys(),
      taskRunnerVerifier: async () => ({ command: "true", exitCode: 0, status: "PASS" as const }),
      taskRunnerAgent: async () => {
        await writeFile(join(repo, "leak.txt"), "should-not-run\n");
        return { summary: "leaked" };
      }
    });
    try {
      const created = await fetch(`${base}/api/tasks/materialise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Dodać notatkę",
          modules: ["notes"],
          allowedPaths: ["notes.md"],
          acceptanceCriteria: ["plik notes.md istnieje"]
        })
      });
      expect(created.status).toBe(201);
      const task = await created.json() as { taskId: string };
      const ran = await fetch(`${base}/api/tasks/${task.taskId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(ran.status).toBe(409);
      const body = await ran.json() as { error: string };
      expect(body.error).toBe("DELIVERY_PROCESS_REQUIRED");
      expect(existsSync(join(repo, "leak.txt"))).toBe(false);
      expect(git(repo, "log", "-1", "--pretty=%s", "main")).toBe("base");
    } finally {
      await close();
    }
  });

  it("approves an ALLOW stage-zero result into one signed process and rejects a second approval", async () => {
    const root = await mkdtemp(join(tmpdir(), "delivery-approve-"));
    roots.push(root);
    const sessionId = "11111111-1111-4111-8111-111111111111";
    await seedChat(root, sessionId, "Dodać notes.md");
    await mkdir(join(root, "stage-zero"), { recursive: true, mode: 0o700 });
    await writeFile(join(root, "stage-zero", `${sessionId}.json`), `${JSON.stringify({
      sessionId,
      source: "chat",
      projectChars: 40,
      reading: {
        understanding: "Dodać notes.md",
        findings: [],
        guidance: [],
        sourceClosed: true,
        readingPlan: { kind: "brief", segments: [], sourceClosed: true },
        decision: { status: "allow", reason: "ok", action: "continue" },
        model: "test",
        readAt: "2026-09-13T00:00:00.000Z"
      },
      roadmap: {
        milestones: [{
          id: "M1",
          title: "Notatka",
          intent: "Dodać notes.md",
          modules: ["notes"],
          allowedPaths: ["notes.md"],
          acceptanceCriteria: ["plik notes.md istnieje"],
          dependsOn: []
        }],
        writtenBy: "brain",
        basedOn: { understanding: "Dodać notes.md", model: "test", readAt: "2026-09-13T00:00:00.000Z" },
        writtenAt: "2026-09-13T00:00:00.000Z"
      },
      runAt: "2026-09-13T00:00:00.000Z"
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

    const { base, close } = await listen({
      stateDir: root,
      webRoot: resolve("web/control"),
      materialisationPrivateKeyPem: keys()
    });
    try {
      const denied = await fetch(`${base}/api/delivery/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
      expect(denied.status).toBe(201);
      const first = await denied.json() as { processId: string; taskId: string; state: string };
      expect(first.state).toBe("APPROVED");
      expect(first.taskId).toMatch(/^TASK-/);
      expect(first.processId).toMatch(/^PROC-/);

      const again = await fetch(`${base}/api/delivery/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
      expect(again.status).toBe(200);
      const second = await again.json() as { processId: string; taskId: string };
      expect(second.processId).toBe(first.processId);
      expect(second.taskId).toBe(first.taskId);

      const tasks = await fetch(`${base}/api/tasks`).then((item) => item.json()) as { tasks: Array<{ taskId: string }> };
      expect(tasks.tasks.filter((item) => item.taskId === first.taskId)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("blocks approval when Harmonia did not ALLOW", async () => {
    const root = await mkdtemp(join(tmpdir(), "delivery-deny-"));
    roots.push(root);
    const sessionId = "22222222-2222-4222-8222-222222222222";
    await seedChat(root, sessionId, "za mało");
    await mkdir(join(root, "stage-zero"), { recursive: true, mode: 0o700 });
    await writeFile(join(root, "stage-zero", `${sessionId}.json`), `${JSON.stringify({
      sessionId,
      source: "chat",
      projectChars: 12,
      reading: {
        understanding: "za mało",
        findings: [],
        guidance: [],
        sourceClosed: true,
        readingPlan: { kind: "brief", segments: [], sourceClosed: true },
        decision: { status: "deny", reason: "cardinal_issue", action: "return_to_author" },
        model: "test",
        readAt: "2026-09-13T00:00:00.000Z"
      },
      roadmap: null,
      runAt: "2026-09-13T00:00:00.000Z"
    }, null, 2)}\n`);

    const { base, close } = await listen({
      stateDir: root,
      webRoot: resolve("web/control"),
      materialisationPrivateKeyPem: keys()
    });
    try {
      const res = await fetch(`${base}/api/delivery/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "HARMONIA_NOT_ALLOW" });
    } finally {
      await close();
    }
  });
});

describe("Isolated execution: worktree + tests-before-commit", () => {
  const TASK = "TASK-DELIVERY-ISO" as TaskId;

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "delivery-iso-"));
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
      workspaceId: "WS-DELIVERY-ISO" as WorkspaceId,
      buildId: "BUILD-DELIVERY-ISO-R1",
      revision: 1,
      state: "CREATED",
      changedAt: "2026-09-13T12:00:00.000Z"
    });
    const store = new DeliveryProcessStore(state);
    await store.put({
      processId: "PROC-ISO-1",
      sessionId: "33333333-3333-4333-8333-333333333333",
      taskId: TASK,
      state: "APPROVED",
      objective: "Notatka",
      modules: ["notes"],
      allowedPaths: ["notes.md"],
      acceptanceCriteria: ["plik notes.md istnieje"],
      approvedScopeFingerprint: "scope-1",
      workOrderFingerprint: "wo-1",
      baseSha: git(repo, "rev-parse", "HEAD"),
      createdAt: "2026-09-13T12:00:00.000Z",
      updatedAt: "2026-09-13T12:00:00.000Z"
    });
    return { root, repo, state };
  }

  it("runs the agent in a git worktree, not the operator checkout", async () => {
    const { repo, state } = await fixture();
    let agentCwd = "";
    const runner = new TaskExecutionRunner({
      stateDir: state,
      projectRoot: repo,
      requireApprovedProcess: true,
      isolateWorktree: true,
      verifier: async () => ({ command: "true", exitCode: 0, status: "PASS" as const }),
      agent: async (context) => {
        agentCwd = context.cwd;
        await writeFile(join(context.cwd, "notes.md"), "ok\n");
        return { summary: "notes" };
      }
    });
    const result = await runner.run(TASK);
    expect(result.state).toBe("BUILD_READY");
    expect(agentCwd).not.toBe(resolve(repo));
    expect(existsSync(join(repo, "notes.md"))).toBe(false);
    expect(git(repo, "show", `${result.branch}:notes.md`)).toContain("ok");
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("does not commit when independent verification FAILs, and does not reach BUILD_READY", async () => {
    const { repo, state } = await fixture();
    const runner = new TaskExecutionRunner({
      stateDir: state,
      projectRoot: repo,
      requireApprovedProcess: true,
      isolateWorktree: true,
      verifier: async () => ({ command: "false", exitCode: 1, status: "FAIL" as const }),
      agent: async (context) => {
        await writeFile(join(context.cwd, "notes.md"), "bad\n");
        return { summary: "bad" };
      }
    });
    await expect(runner.run(TASK)).rejects.toThrow(TaskExecutionError);
    expect(git(repo, "log", "-1", "--pretty=%s", "main")).toBe("base");
    const branches = git(repo, "branch", "--list");
    expect(branches).not.toMatch(/koordynator\/task-/);
  });

  it("refuses a final commit when the verifier is missing (BLOCKED)", async () => {
    const { repo, state } = await fixture();
    const runner = new TaskExecutionRunner({
      stateDir: state,
      projectRoot: repo,
      requireApprovedProcess: true,
      isolateWorktree: true,
      agent: async (context) => {
        await writeFile(join(context.cwd, "notes.md"), "x\n");
        return { summary: "x" };
      }
    });
    await expect(runner.run(TASK)).rejects.toMatchObject({ code: "INDEPENDENT_TESTS_BLOCKED" });
    expect(git(repo, "log", "-1", "--pretty=%s", "main")).toBe("base");
  });

  it("keeps files outside allowedPaths out of the commit", async () => {
    const { repo, state } = await fixture();
    const { FileSignedWorkOrderStore } = await import("../src/store/work-order-store.js");
    const { controlRoots } = await import("../src/control/task-read-model.js");
    const roots = controlRoots(state);
    const orders = new FileSignedWorkOrderStore(roots.workOrderRoot);
    const { privateKey } = generateKeyPairSync("ed25519");
    const { signWorkOrder } = await import("../src/security/work-order-signature.js");
    const { validateWorkOrder } = await import("../src/domain/work-order.js");
    const { canonicalDigest } = await import("../src/crypto/canonical-digest.js");
    const order: WorkOrder = {
      taskId: TASK,
      workspaceId: "WS-DELIVERY-ISO" as WorkspaceId,
      revision: 1,
      objective: "Notatka",
      scope: { modules: ["notes"], allowedPaths: ["notes.md"] },
      requiredInputs: [],
      capabilities: ["core.echo"],
      budget: { timeSec: 1800, costLimit: 0, retries: 1, maxDagDepth: 6 },
      requiredGates: ["unit", "static"],
      expectedEvidence: ["contract"],
      acceptanceCriteria: ["notes.md"],
      failureCriteria: ["runtime-failure"],
      securityContractRef: canonicalDigest({ contract: "security", taskId: TASK }),
      performanceContractRef: canonicalDigest({ contract: "performance", taskId: TASK }),
      rollbackRequirement: "REVERSIBLE",
      humanApprovalPolicy: "HUMAN_REQUIRED",
      policyRef: { policyId: "chat-materialisation", bundleHash: canonicalDigest({ policy: "chat-materialisation" }) }
    };
    validateWorkOrder(order);
    await orders.put(signWorkOrder(order, "control-plane", privateKey));

    const runner = new TaskExecutionRunner({
      stateDir: state,
      projectRoot: repo,
      requireApprovedProcess: true,
      isolateWorktree: true,
      verifier: async () => ({ command: "true", exitCode: 0, status: "PASS" as const }),
      agent: async (context) => {
        await writeFile(join(context.cwd, "notes.md"), "ok\n");
        await writeFile(join(context.cwd, "SECRET.txt"), "leak\n");
        return { summary: "mixed" };
      }
    });
    await expect(runner.run(TASK)).rejects.toMatchObject({ code: "SCOPE_VIOLATION" });
    expect(git(repo, "log", "-1", "--pretty=%s", "main")).toBe("base");
  });
});
