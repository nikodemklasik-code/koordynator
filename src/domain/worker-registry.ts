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
