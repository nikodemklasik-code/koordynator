import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskId } from "../domain/ids.js";
import { FileStateStore } from "../store/file-state-store.js";
import { FileSignedWorkOrderStore } from "../store/work-order-store.js";
import { controlRoots } from "./task-read-model.js";
import { runCommand } from "./hermes-repository-runner.js";
import { type WriteLease, type WriteLeaseRequest } from "../domain/write-lease.js";
import { FileWriteLeaseStore } from "../store/write-lease-store.js";
import { evaluateTestReceipt } from "../domain/independent-test-receipt.js";
import { workerForRole, workerCapabilities, type WorkerKind } from "../domain/worker-registry.js";
import { resolveWorkerAgent } from "./worker-agents.js";
import { MandateAuthority, type MandatePort } from "./mandate-authority.js";
import { reviewPostBuild, type PostBuildReview } from "../domain/post-build-review.js";
import type { TaskRole } from "../domain/task-envelope.js";
import { omniRouteSettings } from "../runtime/local-config.js";

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
  worker?: Exclude<WorkerKind, "coordinator">;
  /** Advisory post-build reviewer output. Never blocks; present when a commit was made. */
  review?: PostBuildReview;
};

export type TaskPushResult = { taskId: TaskId; branch: string; pushed: true; remote: string };

export class TaskExecutionError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "TaskExecutionError";
  }
}

export type WriteLeasePort = {
  grant(request: WriteLeaseRequest): WriteLease | Promise<WriteLease>;
  release(leaseId: string): void | Promise<void>;
};

export type TaskExecutionRunnerOptions = {
  stateDir: string;
  projectRoot: string;
  /** Explicit agent (tests / custom). When omitted, the role's real worker is used. */
  agent?: TaskAgent;
  /** TaskEnvelope role → picks the worker (research=Hermes, code=OpenCode, browser=Playwright). */
  role?: TaskRole;
  /** Reject before spawning when the role cannot write (e.g. research asked to build). */
  requireWrite?: boolean;
  /** Test hook: prepend a dir to PATH so a fixture worker binary is found. */
  workerPathPrefix?: string;
  /** Harmonia's mandate gate. Defaults to an enabled in-memory mandate. */
  mandate?: MandatePort;
  leases?: WriteLeasePort;
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
  private readonly leases: WriteLeasePort;
  private readonly mandate: MandatePort;

  constructor(private readonly options: TaskExecutionRunnerOptions) {
    const roots = controlRoots(options.stateDir);
    this.states = new FileStateStore(roots.stateRoot);
    this.workOrders = new FileSignedWorkOrderStore(roots.workOrderRoot);
    this.runRoot = join(resolve(options.stateDir), "task-runs");
    // In-memory registry dies with Control; default to a durable snapshot next to state.
    this.leases = options.leases ?? new FileWriteLeaseStore(resolve(options.stateDir));
    this.mandate = options.mandate ?? new MandateAuthority();
  }

  private git(args: string[], signal = new AbortController().signal): Promise<string> {
    return runCommand("git", args, resolve(this.options.projectRoot), { ...process.env, GIT_TERMINAL_PROMPT: "0" }, signal);
  }

  async run(taskId: TaskId): Promise<TaskRunResult> {
    const current = await this.states.load(taskId);
    if (!current) throw new TaskExecutionError("TASK_NOT_FOUND", 404);
    if (current.state !== "CREATED") throw new TaskExecutionError("TASK_NOT_RUNNABLE", 409);

    // Resolve the worker from the role BEFORE any git/lease side effect, so a
    // capability violation (e.g. research asked to write) fails closed up front.
    let worker: Exclude<WorkerKind, "coordinator"> | undefined;
    let roleAgent: TaskAgent | undefined;
    if (this.options.role) {
      worker = workerForRole(this.options.role);
      const caps = workerCapabilities(worker);
      if (this.options.requireWrite && !caps.write) {
        throw new TaskExecutionError("WORKER_ROLE_NOT_WRITABLE", 403);
      }
      // Harmonia's mandate gate: a writing role must not start any process while
      // the mandate is suspended/revoked/forbidden. Canon: "mandate != enabled ⇒
      // side effect must not start" — this fires BEFORE git/lease/worker spawn.
      if (caps.write) {
        try {
          this.mandate.assertAllows("fs.write");
        } catch (error) {
          const message = error instanceof Error ? error.message : "MANDATE_NOT_ENABLED";
          throw new TaskExecutionError(message, 403);
        }
      }
      const settings = omniRouteSettings();
      const resolved = resolveWorkerAgent(this.options.role,
        this.options.workerPathPrefix ? { pathPrefix: this.options.workerPathPrefix } : {});
      roleAgent = async (context) => resolved.agent({
        ...context,
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        signal: new AbortController().signal
      });
    }
    const agent = this.options.agent ?? roleAgent;
    if (!agent) throw new TaskExecutionError("TASK_NO_AGENT", 400);
    const leaseOwner = worker ?? "opencode";

    const signed = await this.workOrders.get(taskId, current.revision);
    const order = signed?.order;
    const branch = `koordynator/task-${taskId.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const baseBranch = (await this.git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const allowedPaths = order?.scope.allowedPaths ?? ["**"];
    let leaseId: string | undefined;

    await this.states.save({ ...current, state: "BUILDING", changedAt: new Date().toISOString() });
    await this.git(["switch", "-c", branch]);

    try {
      const lease = await this.leases.grant({
        taskId,
        revision: current.revision,
        owner: leaseOwner,
        stage: "CODE",
        repository: this.options.repository ?? "local",
        branch,
        paths: allowedPaths,
        ttlMs: 30 * 60_000
      });
      leaseId = lease.leaseId;
      const context: Omit<AgentContext, "prompt"> = {
        taskId,
        branch,
        cwd: resolve(this.options.projectRoot),
        objective: order?.objective ?? "Zadanie orkiestracji",
        allowedPaths,
        acceptanceCriteria: order?.acceptanceCriteria ?? []
      };
      const result = await agent({ ...context, prompt: agentPrompt(context) });

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

      // Post-build reviewer (recenzent, NOT a gate): reconstruct intent from the
      // product and report MATCH/DRIFT with evidence. It never blocks release.
      let review: PostBuildReview | undefined;
      if (commit) {
        const treeSha = (await this.git(["rev-parse", "HEAD^{tree}"])).trim();
        const changed = (await this.git(["diff", "--name-only", `${baseBranch}..HEAD`]))
          .split("\n").map((f) => f.trim()).filter(Boolean);
        review = reviewPostBuild({
          subjectSha: commit,
          treeSha,
          objective: context.objective,
          acceptanceChecks: context.acceptanceCriteria,
          changedFiles: changed,
          allowedPaths,
          testVerdict: testVerdict === "PASS" ? "PASS" : "NOT_RUN"
        });
      }

      // Leave the working tree where the operator left it; the work lives on the branch.
      await this.git(["switch", baseBranch]);
      await this.states.save({ ...current, state: "BUILD_READY", reasonCode: "BUILD", changedAt: new Date().toISOString() });

      const receipt: TaskRunResult = {
        taskId, state: "BUILD_READY", branch,
        committed: Boolean(commit),
        ...(commit === undefined ? {} : { commit }),
        pushed: false, summary: result.summary, testVerdict,
        ...(leaseId === undefined ? {} : { writeLeaseId: leaseId }),
        ...(worker === undefined ? {} : { worker }),
        ...(review === undefined ? {} : { review })
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
      if (leaseId) await this.leases.release(leaseId);
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
