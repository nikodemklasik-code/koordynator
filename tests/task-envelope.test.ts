import { describe, expect, it } from "vitest";
import {
  normalizeTaskEnvelope,
  taskEnvelopeFingerprint,
  validateTaskEnvelope,
  type TaskEnvelope
} from "../src/domain/task-envelope.js";

function valid(): TaskEnvelope {
  return {
    taskId: "TASK-40",
    role: "code",
    objective: "Implement issue 40 contracts",
    allowedPaths: ["src/domain/**", "tests/**"],
    allowedTools: ["fs.write", "git.commit"],
    dataClass: "internal",
    budgetPolicy: "FREE_CONFIRMED",
    writeLease: {
      repository: "nikodemklasik-code/koordynator",
      branch: "feat/issue-40-contracts",
      paths: ["src/domain/", "tests/"]
    },
    idempotencyKey: "issue-40:contracts:v1",
    acceptanceChecks: ["envelope fingerprints", "overlapping leases block"]
  };
}

describe("TaskEnvelope", () => {
  it("accepts a canonical envelope from issue 40", () => {
    expect(() => validateTaskEnvelope(valid())).not.toThrow();
  });

  it("fingerprints the normalized envelope so key order and path order do not change identity", () => {
    const a = valid();
    const b: TaskEnvelope = {
      ...valid(),
      allowedPaths: ["tests/**", "src/domain/**"],
      allowedTools: ["git.commit", "fs.write"],
      acceptanceChecks: ["overlapping leases block", "envelope fingerprints"]
    };
    expect(taskEnvelopeFingerprint(a)).toBe(taskEnvelopeFingerprint(b));
    expect(taskEnvelopeFingerprint(a)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("changes fingerprint when the worker mutates objective, role, policy or allowed paths", () => {
    const base = taskEnvelopeFingerprint(valid());
    expect(taskEnvelopeFingerprint({ ...valid(), objective: "different" })).not.toBe(base);
    expect(taskEnvelopeFingerprint({ ...valid(), role: "research" })).not.toBe(base);
    expect(taskEnvelopeFingerprint({ ...valid(), budgetPolicy: "LOCAL_ONLY" })).not.toBe(base);
    expect(taskEnvelopeFingerprint({ ...valid(), allowedPaths: ["src/other/**"] })).not.toBe(base);
  });

  it("rejects unknown roles, extra fields and empty scope", () => {
    expect(() => validateTaskEnvelope({ ...valid(), role: "writer" as TaskEnvelope["role"] }))
      .toThrow(/TASK_ENVELOPE_ROLE_INVALID/);
    expect(() => validateTaskEnvelope({ ...valid(), extra: true } as unknown as TaskEnvelope))
      .toThrow(/TASK_ENVELOPE_SCHEMA/);
    expect(() => validateTaskEnvelope({ ...valid(), allowedPaths: [] }))
      .toThrow(/TASK_ENVELOPE_SCOPE_REQUIRED/);
    expect(() => validateTaskEnvelope({ ...valid(), taskId: "nope" as TaskEnvelope["taskId"] }))
      .toThrow(/TASK_ENVELOPE_TASK_ID_INVALID/);
  });

  it("rejects path traversal in allowedPaths and writeLease.paths", () => {
    expect(() => validateTaskEnvelope({ ...valid(), allowedPaths: ["src/../etc"] }))
      .toThrow(/TASK_ENVELOPE_PATH_INVALID/);
    expect(() => validateTaskEnvelope({
      ...valid(),
      writeLease: { repository: "owner/repo", branch: "main", paths: ["/etc/passwd"] }
    })).toThrow(/TASK_ENVELOPE_PATH_INVALID/);
  });

  it("omits writeLease for read-only roles after normalize", () => {
    const research = normalizeTaskEnvelope({
      ...valid(),
      role: "research",
      allowedTools: ["web.search"],
      writeLease: undefined as never
    });
    expect(research.role).toBe("research");
    expect("writeLease" in research).toBe(false);
  });
});
