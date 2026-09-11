import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";

export type WriteLeaseOwner = "opencode" | "claude";

export type WriteLease = {
  leaseId: string;
  taskId: string;
  revision: number;
  owner: WriteLeaseOwner;
  repository: string;
  branch: string;
  paths: string[];
  issuedAt: string;
  expiresAt: string;
  heartbeatAt: string;
  pidProof: string;
};

export type LeaseGrantRequest = {
  leaseId: string;
  taskId: string;
  revision: number;
  owner: WriteLeaseOwner;
  repository: string;
  branch: string;
  paths: string[];
  pidProof: string;
};

export type LeaseDecision =
  | { status: "GRANTED"; lease: WriteLease; leaseFp: Digest }
  | { status: "BLOCKED"; reason: "PATH_OVERLAP" | "LEASE_EXPIRED_UNPROVEN" };

function overlaps(a: string[], b: string[]): boolean {
  return a.some((left) =>
    b.some((right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`))
  );
}

export function grantWriteLease(
  request: LeaseGrantRequest,
  active: WriteLease[],
  now = new Date(),
  ttlMs = 15 * 60_000
): LeaseDecision {
  const live = active.filter((lease) => Date.parse(lease.expiresAt) > now.getTime());
  const collision = live.find((lease) =>
    lease.repository === request.repository
    && lease.branch === request.branch
    && overlaps(lease.paths, request.paths)
  );
  if (collision) return { status: "BLOCKED", reason: "PATH_OVERLAP" };

  const lease: WriteLease = {
    ...request,
    issuedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString()
  };

  return {
    status: "GRANTED",
    lease,
    leaseFp: canonicalDigest({ kind: "write-lease-v1", ...lease })
  };
}

export function reclaimExpiredLease(lease: WriteLease, processAlive: boolean, now = new Date()): void {
  if (processAlive) throw new Error("LEASE_HOLDER_ALIVE");
  if (Date.parse(lease.expiresAt) > now.getTime()) throw new Error("LEASE_NOT_EXPIRED");
}
