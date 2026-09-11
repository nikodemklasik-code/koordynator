import { randomUUID } from "node:crypto";
import { assertRelativePath } from "./task-envelope.js";
import type { TaskId } from "./ids.js";

export type WriteLeaseStage = "UI_BUILD" | "UI_REPAIR" | "CODE" | "CODE_REVIEW" | "BROWSER_TEST" | "UI_VALIDATION";

const WRITE_STAGES = new Set<WriteLeaseStage>(["UI_BUILD", "UI_REPAIR", "CODE"]);

export type WriteLeaseRequest = {
  taskId: TaskId | string;
  revision: number;
  owner: string;
  stage: WriteLeaseStage;
  repository: string;
  branch: string;
  paths: string[];
  ttlMs: number;
};

export type WriteLease = {
  leaseId: `LEASE-${string}`;
  taskId: string;
  revision: number;
  owner: string;
  stage: WriteLeaseStage;
  repository: string;
  branch: string;
  paths: string[];
  issuedAt: string;
  expiresAt: string;
  heartbeat: string;
};

export type WriteLeaseClock = { now: () => Date };

function normalizePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => assertRelativePath(path, "WRITE_LEASE_PATH_INVALID")))].sort();
}

export function pathsOverlap(left: string[], right: string[]): boolean {
  if (left.includes("*") || right.includes("*")) return true;
  for (const a of left) {
    for (const b of right) {
      if (a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`)) return true;
    }
  }
  return false;
}

export class WriteLeaseRegistry {
  private readonly leases = new Map<string, WriteLease>();

  constructor(private readonly clock: WriteLeaseClock = { now: () => new Date() }) {}

  grant(request: WriteLeaseRequest): WriteLease {
    if (!WRITE_STAGES.has(request.stage)) throw new Error("WRITE_LEASE_ROLE_FORBIDDEN");
    const paths = normalizePaths(request.paths);
    const now = this.clock.now();
    this.dropExpiredUnheld(now);
    for (const lease of this.leases.values()) {
      if (lease.repository !== request.repository || lease.branch !== request.branch) continue;
      if (pathsOverlap(lease.paths, paths)) throw new Error("WRITE_LEASE_CONFLICT");
    }
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + request.ttlMs).toISOString();
    const lease: WriteLease = {
      leaseId: `LEASE-${randomUUID()}`,
      taskId: request.taskId,
      revision: request.revision,
      owner: request.owner,
      stage: request.stage,
      repository: request.repository,
      branch: request.branch,
      paths,
      issuedAt,
      expiresAt,
      heartbeat: issuedAt
    };
    this.leases.set(lease.leaseId, lease);
    return lease;
  }

  release(leaseId: string): void {
    this.leases.delete(leaseId);
  }

  snapshot(): WriteLease[] {
    return [...this.leases.values()].map((lease) => ({ ...lease, paths: [...lease.paths] }));
  }

  restore(leases: WriteLease[]): void {
    this.leases.clear();
    for (const lease of leases) this.leases.set(lease.leaseId, { ...lease, paths: [...lease.paths] });
  }

  recover(leaseId: string, options: { processAlive: boolean }): { recoveryReceipt: boolean } {
    const lease = this.leases.get(leaseId);
    if (!lease) throw new Error("WRITE_LEASE_MISSING");
    if (options.processAlive) throw new Error("WRITE_LEASE_HOLDER_ALIVE");
    this.leases.delete(leaseId);
    return { recoveryReceipt: true };
  }

  require(leaseId: string): WriteLease | { status: "BLOCKED"; reason: "WRITE_LEASE_MISSING" } {
    const lease = this.leases.get(leaseId);
    if (!lease) return { status: "BLOCKED", reason: "WRITE_LEASE_MISSING" };
    return lease;
  }

  private dropExpiredUnheld(_now: Date): void {
    // Expired leases stay until recover() confirms the holder process is gone.
    void _now;
  }
}
