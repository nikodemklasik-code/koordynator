import { canonicalDigest } from "../crypto/canonical-digest.js";
import {
  normalizeConstitutionalMandate,
  type ConstitutionalMandate
} from "./constitutional-mandate.js";
import type { Digest, TaskId } from "./ids.js";

export type TaskRole = "research" | "code" | "browser" | "audit" | "deploy";
export type TaskDataClass = "public" | "internal" | "confidential";
export type TaskBudgetPolicy = "FREE_CONFIRMED" | "LOCAL_ONLY" | "OWNER_APPROVAL";

export type TaskWriteLease = {
  repository: string;
  branch: string;
  paths: string[];
};

export type TaskEnvelope = {
  taskId: TaskId;
  role: TaskRole;
  objective: string;
  allowedPaths: string[];
  allowedTools: string[];
  dataClass: TaskDataClass;
  budgetPolicy: TaskBudgetPolicy;
  constitutionalMandate: ConstitutionalMandate;
  writeLease?: TaskWriteLease;
  idempotencyKey: string;
  acceptanceChecks: string[];
};

const ROLES = new Set<TaskRole>(["research", "code", "browser", "audit", "deploy"]);
const DATA_CLASSES = new Set<TaskDataClass>(["public", "internal", "confidential"]);
const BUDGETS = new Set<TaskBudgetPolicy>(["FREE_CONFIRMED", "LOCAL_ONLY", "OWNER_APPROVAL"]);
const READ_ONLY_ROLES = new Set<TaskRole>(["research", "browser", "audit"]);
const ROOT_KEYS = [
  "taskId", "role", "objective", "allowedPaths", "allowedTools", "dataClass",
  "budgetPolicy", "constitutionalMandate", "writeLease", "idempotencyKey", "acceptanceChecks"
] as const;

function assertPlainObject(value: unknown, code: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], code: string): void {
  const expected = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) continue;
    if (!expected.has(key)) throw new Error(`${code}:${key}`);
  }
}

export function assertRelativePath(path: string, code = "TASK_ENVELOPE_PATH_INVALID"): string {
  if (typeof path !== "string" || !path.trim()) throw new Error(code);
  const trimmed = path.trim();
  if (trimmed.startsWith("/") || trimmed.includes("\\") || trimmed.includes("\0")) throw new Error(code);
  if (trimmed === "*" || trimmed === "**") return "*";
  const parts = trimmed.split("/");
  if (parts.some((part) => part === ".." || part === ".")) throw new Error(code);
  return trimmed.replace(/\/+$/, "") || trimmed;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function validateWriteLease(lease: unknown): TaskWriteLease {
  assertPlainObject(lease, "TASK_ENVELOPE_LEASE_INVALID");
  assertAllowedKeys(lease, ["repository", "branch", "paths"], "TASK_ENVELOPE_LEASE_SCHEMA");
  if (typeof lease.repository !== "string" || !lease.repository.trim()) throw new Error("TASK_ENVELOPE_LEASE_INVALID");
  if (typeof lease.branch !== "string" || !lease.branch.trim()) throw new Error("TASK_ENVELOPE_LEASE_INVALID");
  if (!Array.isArray(lease.paths) || lease.paths.length === 0) throw new Error("TASK_ENVELOPE_SCOPE_REQUIRED");
  return {
    repository: lease.repository.trim(),
    branch: lease.branch.trim(),
    paths: sortedUnique(lease.paths.map((path) => assertRelativePath(String(path))))
  };
}

export function validateTaskEnvelope(input: TaskEnvelope): void {
  normalizeTaskEnvelope(input);
}

export function normalizeTaskEnvelope(input: TaskEnvelope): TaskEnvelope {
  assertPlainObject(input, "TASK_ENVELOPE_SCHEMA");
  assertAllowedKeys(input, ROOT_KEYS, "TASK_ENVELOPE_SCHEMA");
  for (const key of ROOT_KEYS) {
    if (key === "writeLease") continue;
    if (!(key in input) || input[key as keyof TaskEnvelope] === undefined) {
      throw new Error(`TASK_ENVELOPE_SCHEMA:MISSING:${key}`);
    }
  }
  if (typeof input.taskId !== "string" || !/^TASK-[A-Za-z0-9._-]+$/.test(input.taskId)) {
    throw new Error("TASK_ENVELOPE_TASK_ID_INVALID");
  }
  if (!ROLES.has(input.role)) throw new Error("TASK_ENVELOPE_ROLE_INVALID");
  if (typeof input.objective !== "string" || !input.objective.trim()) throw new Error("TASK_ENVELOPE_OBJECTIVE_REQUIRED");
  if (!Array.isArray(input.allowedPaths) || input.allowedPaths.length === 0) throw new Error("TASK_ENVELOPE_SCOPE_REQUIRED");
  if (!Array.isArray(input.allowedTools) || input.allowedTools.length === 0) throw new Error("TASK_ENVELOPE_TOOLS_REQUIRED");
  if (!Array.isArray(input.acceptanceChecks) || input.acceptanceChecks.length === 0) {
    throw new Error("TASK_ENVELOPE_ACCEPTANCE_REQUIRED");
  }
  if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim()) {
    throw new Error("TASK_ENVELOPE_IDEMPOTENCY_REQUIRED");
  }
  if (!DATA_CLASSES.has(input.dataClass)) throw new Error("TASK_ENVELOPE_DATA_CLASS_INVALID");
  if (!BUDGETS.has(input.budgetPolicy)) throw new Error("TASK_ENVELOPE_BUDGET_INVALID");

  const allowedPaths = sortedUnique(input.allowedPaths.map((path) => assertRelativePath(path)));
  if (allowedPaths.length === 0) throw new Error("TASK_ENVELOPE_SCOPE_REQUIRED");

  const envelope: TaskEnvelope = {
    taskId: input.taskId,
    role: input.role,
    objective: input.objective.trim(),
    allowedPaths,
    allowedTools: sortedUnique(input.allowedTools),
    dataClass: input.dataClass,
    budgetPolicy: input.budgetPolicy,
    constitutionalMandate: normalizeConstitutionalMandate(input.constitutionalMandate),
    idempotencyKey: input.idempotencyKey.trim(),
    acceptanceChecks: sortedUnique(input.acceptanceChecks)
  };

  if (!READ_ONLY_ROLES.has(input.role) && input.writeLease) {
    envelope.writeLease = validateWriteLease(input.writeLease);
  }
  return envelope;
}

export function taskEnvelopeFingerprint(input: TaskEnvelope): Digest {
  return canonicalDigest(normalizeTaskEnvelope(input));
}
