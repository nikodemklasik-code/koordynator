import type { TaskRole } from "./task-envelope.js";

export type WorkerKind = "hermes" | "opencode" | "playwright" | "audit" | "deploy" | "coordinator";
export type WorkerAction =
  | "spawn.hermes"
  | "spawn.opencode"
  | "assign.task"
  | "shell"
  | "fs.write"
  | "fs.read"
  | "browser"
  | "vault.read"
  | "git.merge"
  | "deploy"
  | "release"
  | "web.search";

export type WorkerCapabilities = {
  write: boolean;
  writeLease: boolean;
  tools: string[];
};

const CAPABILITIES: Record<Exclude<WorkerKind, "coordinator">, WorkerCapabilities> = {
  hermes: { write: false, writeLease: false, tools: ["fs.read", "web.search"] },
  opencode: { write: true, writeLease: true, tools: ["fs.write", "fs.read", "git.commit"] },
  playwright: { write: false, writeLease: false, tools: ["browser"] },
  audit: { write: false, writeLease: false, tools: ["fs.read"] },
  deploy: { write: false, writeLease: false, tools: ["release"] }
};

const ALLOWED: Record<WorkerKind, ReadonlySet<WorkerAction>> = {
  coordinator: new Set(["assign.task"]),
  hermes: new Set(["fs.read", "web.search"]),
  opencode: new Set(["fs.write", "fs.read"]),
  playwright: new Set(["browser"]),
  audit: new Set(["fs.read"]),
  deploy: new Set(["release"])
};

const DELEGATION = new Set<WorkerAction>(["spawn.hermes", "spawn.opencode", "assign.task"]);

// Issue 40 responsibility table: each TaskEnvelope role is executed by exactly one
// worker. Hermes=research, OpenCode=code, Playwright=browser, audit=read-only
// auditor, deploy=separate deploy role gated behind owner approval.
const ROLE_WORKER: Record<TaskRole, Exclude<WorkerKind, "coordinator">> = {
  research: "hermes",
  code: "opencode",
  browser: "playwright",
  audit: "audit",
  deploy: "deploy"
};

export function workerForRole(role: TaskRole): Exclude<WorkerKind, "coordinator"> {
  const worker = ROLE_WORKER[role];
  if (!worker) throw new Error("WORKER_ROLE_UNKNOWN");
  return worker;
}

export function workerCapabilities(kind: Exclude<WorkerKind, "coordinator">): WorkerCapabilities {
  return { ...CAPABILITIES[kind], tools: [...CAPABILITIES[kind].tools] };
}

export function assertWorkerAction(kind: WorkerKind, action: WorkerAction): void {
  if (DELEGATION.has(action) && kind !== "coordinator") throw new Error("WORKER_DELEGATION_FORBIDDEN");
  if (kind === "coordinator") {
    if (!ALLOWED.coordinator.has(action) && DELEGATION.has(action) === false) {
      throw new Error("WORKER_CAPABILITY_DENIED");
    }
    return;
  }
  if (!ALLOWED[kind].has(action)) throw new Error("WORKER_CAPABILITY_DENIED");
}
