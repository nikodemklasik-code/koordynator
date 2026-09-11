import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskId } from "../domain/ids.js";
import { FileStateStore } from "../store/file-state-store.js";
import { FileSignedWorkOrderStore } from "../store/work-order-store.js";
import { controlRoots } from "./task-read-model.js";
import { runCommand } from "./hermes-repository-runner.js";
import { WriteLeaseRegistry } from "../domain/write-lease.js";
import { evaluateTestReceipt } from "../domain/independent-test-receipt.js";

export type AgentContext = {
  taskId: TaskId;
  branch: string;
  cwd: string;
  objective: string;
  allowedPaths: string[];
  acceptanceCriteria: string[];
  prompt: string;
};

export type AgentResult = { summary: string };
export type TaskAgent = (context: AgentContext) => Promise<AgentResult>;

export type IndependentVerifier = () => Promise<{ command: string; exitCode: number; status: "PASS" | "FAIL" | "NOT_RUN" }>;

export type TaskRunResult = {
  taskId: TaskId;
  state: "BUILD_READY";
  branch: string;
  committed: boolean;
  commit?: string;
  pushed: false;
  summary: string;
  testVerdict: "PASS" | "FAIL" | "BLOCKED";
  writeLeaseId?: string;
};

export type TaskPushResult = { taskId: TaskId; branch: string; pushed: true; remote: string };

export class TaskExecutionError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "TaskExecutionError";
  }
}

export type TaskExecutionRunnerOptions = {
  stateDir: string;
  projectRoot: string;
  agent: TaskAgent;
  leases?: WriteLeaseRegistry;
  repository?: string;
  verifier?: IndependentVerifier;
};

function agentPrompt(context: Omit<AgentContext, "prompt">): string {
  return [
    `TASK: ${context.taskId}`,
    `CEL: ${context.objective}`,
    `Katalog pracy: ${context.cwd}`,
    `Gałąź robocza: ${context.branch} (już utworzona i aktywna)`,
    `Dozwolone ścieżki: ${context.allowedPaths.join(", ")}`,
    `Kryteria akceptacji:\n${context.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`,
    "Pracuj wyłącznie w dozwolonych ścieżkach. Uruchom właściwe testy i raportuj faktyczne wyniki; NOT_TESTED to nie PASS.",
    // Publishing is the operator's decision, never the agent's.
    "NIE commituj samodzielnie — commit wykonuje Koordynator po Twojej pracy.",
    "Nie pushuj (do not push), nie scalaj (do not merge), nie zmieniaj ustawień repozytorium ani zdalnych gałęzi."
  ].join("\n");
}

/**
 * Runs a materialised task locally: creates a branch, lets the agent work, then commits.
 *
 * Deliberately GitHub-free. Pushing is a separate, explicitly approved step so nothing
 * leaves the machine until the operator says so.
 */
export class TaskExecutionRunner {
  private readonly states: FileStateStore;
  private readonly workOrders: FileSignedWorkOrderStore;
  private readonly runRoot: string;

  constructor(private readonly options: TaskExecutionRunnerOptions) {
    const roots = controlRoots(options.stateDir);
    this.states = new FileStateStore(roots.stateRoot);
    this.workOrders = new FileSignedWorkOrderStore(roots.workOrderRoot);
    this.runRoot = join(resolve(options.stateDir), "task-runs");
  }

  private git(args: string[], signal = new AbortController().signal): Promise<string> {
    return runCommand("git", args, resolve(this.options.projectRoot), { ...process.env, GIT_TERMINAL_PROMPT: "0" }, signal);
  }

  async run(taskId: TaskId): Promise<TaskRunResult> {
    const current = await this.states.load(taskId);
    if (!current) throw new TaskExecutionError("TASK_NOT_FOUND", 404);
    if (current.state !== "CREATED") throw new TaskExecutionError("TASK_NOT_RUNNABLE", 409);

    const signed = await this.workOrders.get(taskId, current.revision);
    const order = signed?.order;
    const branch = `koordynator/task-${taskId.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const baseBranch = (await this.git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const allowedPaths = order?.scope.allowedPaths ?? ["**"];
    let leaseId: string | undefined;

    await this.states.save({ ...current, state: "BUILDING", changedAt: new Date().toISOString() });
    await this.git(["switch", "-c", branch]);

    try {
      if (this.options.leases) {
        const lease = this.options.leases.grant({
          taskId,
          revision: current.revision,
          owner: "opencode",
          stage: "CODE",
          repository: this.options.repository ?? "local",
          branch,
          paths: allowedPaths,
          ttlMs: 30 * 60_000
        });
        leaseId = lease.leaseId;
      }
      const context: Omit<AgentContext, "prompt"> = {
        taskId,
        branch,
        cwd: resolve(this.options.projectRoot),
        objective: order?.objective ?? "Zadanie orkiestracji",
        allowedPaths,
        acceptanceCriteria: order?.acceptanceCriteria ?? []
      };
      const result = await this.options.agent({ ...context, prompt: agentPrompt(context) });

      const status = (await this.git(["status", "--porcelain"])).trim();
      let commit: string | undefined;
      if (status) {
        await this.git(["add", "-A"]);
        await this.git(["commit", "-m", `${taskId}: ${context.objective}\n\n${result.summary}`.slice(0, 1800)]);
        commit = (await this.git(["rev-parse", "HEAD"])).trim();
      }

      const testClaim = this.options.verifier
        ? { verifier: "independent" as const, ...(await this.options.verifier()) }
        : { source: "SEE_AGENT_REPORT" as const };
      const testVerdict = evaluateTestReceipt(testClaim).verdict;
      if (testVerdict === "FAIL") throw new TaskExecutionError("INDEPENDENT_TESTS_FAILED", 409);

      // Leave the working tree where the operator left it; the work lives on the branch.
      await this.git(["switch", baseBranch]);
      await this.states.save({ ...current, state: "BUILD_READY", reasonCode: "BUILD", changedAt: new Date().toISOString() });

      const receipt: TaskRunResult = {
        taskId, state: "BUILD_READY", branch,
        committed: Boolean(commit),
        ...(commit === undefined ? {} : { commit }),
        pushed: false, summary: result.summary, testVerdict,
        ...(leaseId === undefined ? {} : { writeLeaseId: leaseId })
      };
      await mkdir(this.runRoot, { recursive: true, mode: 0o700 });
      await writeFile(join(this.runRoot, `${taskId}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      return receipt;
    } catch (error) {
      // Abandon the branch and return to the operator's branch, so a failure leaves no mess.
      try { await this.git(["reset", "--hard"]); } catch { /* best effort */ }
      try { await this.git(["switch", baseBranch]); } catch { /* best effort */ }
      try { await this.git(["branch", "-D", branch]); } catch { /* best effort */ }
      const reason = error instanceof Error ? error.message : "AGENT_FAILED";
      await this.states.save({ ...current, state: "FAILED", reasonCode: reason.slice(0, 80), changedAt: new Date().toISOString() });
      throw error;
    } finally {
      if (leaseId && this.options.leases) this.options.leases.release(leaseId);
    }
  }

  /** Pushes the task branch. Requires explicit approval; never called by `run`. */
  async push(taskId: TaskId, approved: boolean, remote = "origin"): Promise<TaskPushResult> {
    if (approved !== true) throw new TaskExecutionError("PUSH_CONSENT_REQUIRED", 400);
    let receipt: TaskRunResult;
    try {
      receipt = JSON.parse(await readFile(join(this.runRoot, `${taskId}.json`), "utf8")) as TaskRunResult;
    } catch {
      throw new TaskExecutionError("TASK_RUN_NOT_FOUND", 404);
    }
    if (!receipt.committed) throw new TaskExecutionError("TASK_RUN_NOTHING_TO_PUSH", 409);
    await this.git(["push", "--set-upstream", remote, receipt.branch]);
    await writeFile(join(this.runRoot, `${taskId}.json`), `${JSON.stringify({ ...receipt, pushed: true }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return { taskId, branch: receipt.branch, pushed: true, remote };
  }
}
