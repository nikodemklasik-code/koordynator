import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { DataClass, Role } from "../harmonia/mandate.js";
import type { Digest } from "./ids.js";

export type BudgetPolicy = "FREE_CONFIRMED" | "LOCAL_ONLY" | "OWNER_APPROVAL";

export type WriteLeaseRequest = {
  repository: string;
  branch: string;
  paths: string[];
};

export type TaskEnvelope = {
  taskId: string;
  revision: number;
  role: Role;
  objective: string;
  allowedPaths: string[];
  allowedTools: string[];
  dataClass: DataClass;
  budgetPolicy: BudgetPolicy;
  idempotencyKey: string;
  acceptanceChecks: string[];
  writeLease?: WriteLeaseRequest;
};

export type SealedTaskEnvelope = TaskEnvelope & {
  contractFp: Digest;
};

function normalizePath(path: string): string {
  const trimmed = path.trim().replaceAll("\\", "/");
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("..")) {
    throw new Error(`PATH_UNSAFE:${path}`);
  }
  return trimmed.replace(/\/+$/, "");
}

export function normalizeEnvelope(input: TaskEnvelope): TaskEnvelope {
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new Error("INVALID_REVISION");
  }
  if (!input.objective.trim()) throw new Error("OBJECTIVE_EMPTY");
  if (!input.idempotencyKey.trim()) throw new Error("IDEMPOTENCY_KEY_REQUIRED");

  const allowedPaths = [...new Set(input.allowedPaths.map(normalizePath))].sort();
  const allowedTools = [...new Set(input.allowedTools.map((tool) => tool.trim()).filter(Boolean))].sort();
  const acceptanceChecks = [...new Set(input.acceptanceChecks)].sort();

  if (input.role === "code" && allowedPaths.length === 0) {
    throw new Error("CODE_ROLE_REQUIRES_PATHS");
  }
  if ((input.role === "browser" || input.role === "audit") && input.writeLease) {
    throw new Error("READ_ONLY_ROLE_CANNOT_HOLD_LEASE");
  }

  const envelope: TaskEnvelope = {
    taskId: input.taskId,
    revision: input.revision,
    role: input.role,
    objective: input.objective.trim(),
    allowedPaths,
    allowedTools,
    dataClass: input.dataClass,
    budgetPolicy: input.budgetPolicy,
    idempotencyKey: input.idempotencyKey.trim(),
    acceptanceChecks
  };

  if (input.writeLease) {
    envelope.writeLease = {
      repository: input.writeLease.repository.trim(),
      branch: input.writeLease.branch.trim(),
      paths: [...new Set(input.writeLease.paths.map(normalizePath))].sort()
    };
  }

  return envelope;
}

export function sealEnvelope(input: TaskEnvelope): SealedTaskEnvelope {
  const envelope = normalizeEnvelope(input);
  return {
    ...envelope,
    contractFp: canonicalDigest({ kind: "task-envelope-v1", ...envelope })
  };
}

export function assertEnvelopeIntact(sealed: SealedTaskEnvelope): void {
  const expected = sealEnvelope(sealed).contractFp;
  if (expected !== sealed.contractFp) throw new Error("CONTRACT_TAMPER");
}
