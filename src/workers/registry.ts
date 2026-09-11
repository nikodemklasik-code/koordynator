import type { Role } from "../harmonia/mandate.js";

export type WorkerId = "hermes" | "opencode" | "playwright" | "codex" | "audit" | "deploy";

const WORKER_ROLES: Record<WorkerId, Role> = {
  hermes: "research",
  opencode: "code",
  playwright: "browser",
  codex: "audit",
  audit: "audit",
  deploy: "deploy"
};

const WRITE_WORKERS = new Set<WorkerId>(["opencode"]);

export function assertWorkerContract(workerId: WorkerId, requested: {
  role: Role;
  wantsWrite: boolean;
  wantsDispatch: boolean;
}): void {
  if (WORKER_ROLES[workerId] !== requested.role) throw new Error("WORKER_ROLE_MISMATCH");
  if (requested.wantsWrite && !WRITE_WORKERS.has(workerId)) throw new Error("WORKER_READ_ONLY");
  if (requested.wantsDispatch) throw new Error("WORKER_DISPATCH_FORBIDDEN");
}
