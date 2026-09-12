import { spawn } from "node:child_process";
import { workerForRole, workerCapabilities, assertWorkerAction, type WorkerKind } from "../domain/worker-registry.js";
import type { TaskRole } from "../domain/task-envelope.js";
import { prepareHermes } from "../runtime/hermes-launch.js";

export class WorkerAgentError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "WorkerAgentError";
  }
}

/** Context a worker process needs. Extends the runner's AgentContext with route info. */
export type WorkerAgentContext = {
  taskId: string;
  branch: string;
  cwd: string;
  objective: string;
  allowedPaths: string[];
  acceptanceCriteria: string[];
  prompt: string;
  endpoint: string;
  apiKey: string;
  model: string;
  signal: AbortSignal;
};

export type WorkerAgentResult = { summary: string };
export type WorkerAgent = (context: WorkerAgentContext) => Promise<WorkerAgentResult>;

export type ResolvedWorkerAgent = {
  worker: Exclude<WorkerKind, "coordinator">;
  writes: boolean;
  agent: WorkerAgent;
};

export type WorkerAgentOptions = {
  /** Prepend a directory to PATH so tests can inject fixture binaries. */
  pathPrefix?: string;
};

function childEnv(options: WorkerAgentOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" };
  if (options.pathPrefix) env.PATH = `${options.pathPrefix}:${env.PATH ?? ""}`;
  return env;
}

/** Runs a bounded worker command; missing binary is BLOCKED, non-zero exit is a real failure. */
function runWorker(command: string, args: string[], context: WorkerAgentContext, env: NodeJS.ProcessEnv): Promise<string> {
  context.signal.throwIfAborted();
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd: context.cwd, env, shell: false,
      detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let size = 0;
    let overflow = false;
    const kill = () => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* gone */ }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) { overflow = true; kill(); return; }
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 1024 * 1024) { overflow = true; kill(); } });
    context.signal.addEventListener("abort", kill, { once: true });
    child.once("error", () => { context.signal.removeEventListener("abort", kill); reject(new WorkerAgentError("WORKER_BINARY_UNAVAILABLE", 424)); });
    child.once("close", (code) => {
      context.signal.removeEventListener("abort", kill);
      if (context.signal.aborted) reject(new WorkerAgentError("WORKER_STOPPED", 409));
      else if (overflow) reject(new WorkerAgentError("WORKER_OUTPUT_LIMIT", 413));
      else if (code !== 0) reject(new WorkerAgentError("WORKER_PROCESS_FAILED", 502));
      else accept(output);
    });
  });
}

// Hermes (research role): read-only agent through the managed profile + task ticket.
function hermesAgent(options: WorkerAgentOptions): WorkerAgent {
  return async (context) => {
    const launch = await prepareHermes(
      { endpoint: context.endpoint, apiKey: context.apiKey, model: context.model },
      context.cwd
    );
    try {
      const env = { ...launch.env, ...(options.pathPrefix ? { PATH: `${options.pathPrefix}:${launch.env.PATH ?? process.env.PATH ?? ""}` } : {}) };
      const output = await runWorker(launch.command, [...launch.args, "-q", context.prompt, "--quiet"],
        { ...context, apiKey: context.apiKey }, env);
      return { summary: redact(output, [context.apiKey, launch.env.OPENAI_API_KEY]) || "Hermes research completed" };
    } finally {
      await launch.close();
    }
  };
}

// OpenCode's own free models: tried first (own source), no OmniRoute credential.
// Verified available without auth; kept short so a dead one falls through fast.
const OPENCODE_FREE_MODELS = [
  "opencode/nemotron-3.5-lightning-free",
  "opencode/mimo-v2.5-free",
  "opencode/ling-3.0-flash-fin-free"
];

export type OpencodeModelAttempt = {
  model: string;
  /** Set only for the OmniRoute fallback leg. */
  baseURL?: string;
  apiKey?: string;
};

/**
 * Model plan for the code worker: OpenCode's OWN free models first, then a
 * fallback to OUR gateway (OmniRoute) using the short-lived task ticket — never
 * a raw provider key. Both sources are allowed; ours is the safety net.
 */
export function opencodeModelPlan(input: {
  model: string;
  endpoint: string;
  ticket: string;
  freeModels?: string[];
}): OpencodeModelAttempt[] {
  const free = (input.freeModels ?? OPENCODE_FREE_MODELS).map((model) => ({ model }));
  const omniroute: OpencodeModelAttempt = { model: input.model, baseURL: input.endpoint, apiKey: input.ticket };
  return [...free, omniroute];
}

// OpenCode (code role): the write-capable coding worker. Tries its own free
// models first, then OmniRoute via the task ticket. First success wins.
function opencodeAgent(options: WorkerAgentOptions): WorkerAgent {
  return async (context) => {
    const env = childEnv(options);
    const ticket = context.apiKey;
    const attempts = opencodeModelPlan({ model: context.model, endpoint: context.endpoint, ticket });
    let lastError: unknown;
    for (const attempt of attempts) {
      const attemptEnv: NodeJS.ProcessEnv = { ...env };
      const args = ["run", context.prompt, "--model", attempt.model];
      if (attempt.baseURL) {
        // OmniRoute leg: point OpenCode's OpenAI-compatible provider at our proxy.
        attemptEnv.OPENAI_BASE_URL = attempt.baseURL;
        attemptEnv.OPENAI_API_KEY = attempt.apiKey ?? "";
      }
      try {
        const output = await runWorker("opencode", args, context, attemptEnv);
        return { summary: redact(output.trim() || `OpenCode (${attempt.model}) completed`, [ticket, attempt.apiKey]) };
      } catch (error) {
        lastError = error;
        if (error instanceof WorkerAgentError && error.code === "WORKER_BINARY_UNAVAILABLE") throw error;
        // Otherwise fall through to the next model source.
      }
    }
    throw lastError instanceof Error ? lastError : new WorkerAgentError("WORKER_PROCESS_FAILED", 502);
  };
}

// Playwright (browser role): E2E automation, never writes source.
function playwrightAgent(options: WorkerAgentOptions): WorkerAgent {
  return async (context) => {
    const env = childEnv(options);
    const output = await runWorker("npx", ["playwright", "test"], context, env);
    return { summary: output.trim() || "Playwright E2E completed" };
  };
}

function redact(text: string, secrets: Array<string | undefined>): string {
  let clean = text;
  for (const secret of secrets) if (secret) clean = clean.split(secret).join("[REDACTED]");
  return clean.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|tkt\.[A-Za-z0-9_.-]+)\b/g, "[REDACTED]");
}

const BUILDERS: Partial<Record<Exclude<WorkerKind, "coordinator">, (options: WorkerAgentOptions) => WorkerAgent>> = {
  hermes: hermesAgent,
  opencode: opencodeAgent,
  playwright: playwrightAgent
};

/** True only when the role has a concrete process bridge, not merely a registry placeholder. */
export function workerAgentImplemented(role: TaskRole): boolean {
  return Boolean(BUILDERS[workerForRole(role)]);
}

/** Picks the worker issue 40 assigns to the role and returns its real process bridge. */
export function resolveWorkerAgent(role: TaskRole, options: WorkerAgentOptions = {}): ResolvedWorkerAgent {
  const worker = workerForRole(role);
  const build = BUILDERS[worker];
  if (!build) throw new WorkerAgentError("WORKER_AGENT_UNAVAILABLE", 501);
  const caps = workerCapabilities(worker);
  // A writing role must pass the capability gate before any process is spawned.
  if (caps.write) assertWorkerAction(worker, "fs.write");
  return { worker, writes: caps.write, agent: build(options) };
}