import { describe, expect, it } from "vitest";
import { admitExecution } from "../src/engine/admission.js";
import { transition } from "../src/engine/task-state-machine.js";
import { sealEnvelope } from "../src/domain/task-envelope.js";
import { sealMandate } from "../src/harmonia/mandate.js";
import { applyVerdict, sealVerdict } from "../src/harmonia/verdict-log.js";
import { redact } from "../src/security/redaction.js";
import { issueCapabilityTicket } from "../src/security/secret-broker.js";
import { claimSideEffect, DuplicateSideEffectError } from "../src/store/idempotency-registry.js";
import { grantWriteLease } from "../src/store/lease-store.js";
import { evaluateUiGate } from "../src/ui-workflow/gates.js";
import { assertWorkerContract } from "../src/workers/registry.js";

const mandate = sealMandate({
  mandateId: "mandate-1",
  status: "enabled",
  allowedRoles: ["code", "browser", "audit"],
  maxDataClass: "internal",
  autoDeploy: false,
  multiWorker: false,
  issuedAt: "2026-09-11T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z"
});

const envelope = sealEnvelope({
  taskId: "TASK-UI-1",
  revision: 1,
  role: "code",
  objective: "Zbudować ekran Live Chat.",
  allowedPaths: ["web/control/chat.js", "web/control/chat.css"],
  allowedTools: ["edit", "test"],
  dataClass: "internal",
  budgetPolicy: "LOCAL_ONLY",
  writeLease: {
    repository: "nikodemklasik-code/koordynator",
    branch: "koordynator/task-ui-1",
    paths: ["web/control/chat.js", "web/control/chat.css"]
  },
  idempotencyKey: "TASK-UI-1:r1:build",
  acceptanceChecks: ["SUBJECT_SHA_EXACT", "BROWSER_TEST"]
});

describe("issue #40 etapa 0", () => {
  it("blocks execution when Vault is unavailable", () => {
    expect(admitExecution(mandate, envelope, false)).toEqual({
      status: "BLOCKED",
      reason: "VAULT_UNAVAILABLE"
    });
  });

  it("admits a matching mandate, envelope and reachable Vault", () => {
    expect(admitExecution(mandate, envelope, true)).toEqual({
      status: "ADMITTED",
      mandateFp: mandate.fingerprint,
      contractFp: envelope.contractFp
    });
  });

  it("rejects contract tampering", () => {
    const tampered = { ...envelope, allowedTools: [...envelope.allowedTools, "shell"] };
    expect(admitExecution(mandate, tampered, true)).toEqual({
      status: "BLOCKED",
      reason: "CONTRACT_TAMPER"
    });
  });

  it("requires owner approval for self-reference verdicts", () => {
    expect(() => sealVerdict({
      verdictId: "v1",
      kind: "SELF_REFERENCE",
      mandateFp: mandate.fingerprint,
      evidenceRefs: ["docs/FOUNDING.md"],
      actor: "harmonia",
      selfReference: true,
      createdAt: "2026-09-11T00:00:00.000Z",
      note: "change own gate"
    })).toThrow("SELF_REFERENCE_REQUIRES_OWNER");
  });

  it("applies an owner override without dropping the previous fingerprint identity", () => {
    const verdict = sealVerdict({
      verdictId: "v2",
      kind: "SUSPEND",
      mandateFp: mandate.fingerprint,
      evidenceRefs: ["owner-override"],
      actor: "owner",
      selfReference: true,
      createdAt: "2026-09-11T00:00:00.000Z",
      note: "suspend multi-worker",
      nextStatus: "suspended"
    });
    const next = applyVerdict(mandate, verdict);
    expect(next.status).toBe("suspended");
    expect(next.fingerprint).not.toBe(mandate.fingerprint);
    expect(admitExecution(next, envelope, true)).toEqual({
      status: "BLOCKED",
      reason: "MANDATE_SUSPENDED"
    });
  });

  it("blocks overlapping write leases", () => {
    const first = grantWriteLease({
      leaseId: "lease-1",
      taskId: envelope.taskId,
      revision: 1,
      owner: "opencode",
      repository: "nikodemklasik-code/koordynator",
      branch: "koordynator/task-ui-1",
      paths: ["web/control/chat.js"],
      pidProof: "pid:4412"
    }, []);
    expect(first.status).toBe("GRANTED");

    const second = grantWriteLease({
      leaseId: "lease-2",
      taskId: "TASK-UI-2",
      revision: 1,
      owner: "opencode",
      repository: "nikodemklasik-code/koordynator",
      branch: "koordynator/task-ui-1",
      paths: ["web/control"],
      pidProof: "pid:4413"
    }, first.status === "GRANTED" ? [first.lease] : []);

    expect(second).toEqual({ status: "BLOCKED", reason: "PATH_OVERLAP" });
  });

  it("does not replay a completed side effect", () => {
    const registry = new Map();
    const record = {
      idempotencyKey: "deploy:TASK-UI-1:r1",
      kind: "deploy" as const,
      taskId: "TASK-UI-1",
      revision: 1,
      result: "COMPLETED" as const,
      effectFp: "sha256:1"
    };
    claimSideEffect(registry, record);
    expect(() => claimSideEffect(registry, record)).toThrow(DuplicateSideEffectError);
  });

  it("does not treat UNEXECUTED browser evidence as UI_ACCEPTED", () => {
    const sha = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    const gate = evaluateUiGate({
      contractFp: envelope.contractFp,
      subjectSha: sha,
      designValid: true,
      buildValid: true,
      codeReview: "PASS",
      browserTest: "UNEXECUTED",
      uiValidation: "PASS",
      accessibility: "PASS",
      securityScan: "PASS",
      activeWriteLease: false,
      reportedContractFp: envelope.contractFp,
      reportedSubjectSha: sha
    });
    expect(gate.status).toBe("BLOCKED");
    expect(gate.reasons).toContain("BROWSER_TEST:UNEXECUTED");
  });

  it("forbids worker-to-worker dispatch and playwright writes", () => {
    expect(() => assertWorkerContract("playwright", {
      role: "browser",
      wantsWrite: true,
      wantsDispatch: false
    })).toThrow("WORKER_READ_ONLY");
    expect(() => assertWorkerContract("hermes", {
      role: "research",
      wantsWrite: false,
      wantsDispatch: true
    })).toThrow("WORKER_DISPATCH_FORBIDDEN");
  });

  it("issues a capability ticket only when Vault is reachable and unsealed", () => {
    expect(() => issueCapabilityTicket(
      { reachable: false, sealed: false },
      Buffer.from("0123456789abcdef"),
      {
        audience: "hermes",
        endpoint: "http://127.0.0.1:20128/v1",
        model: "cx/gpt-test",
        taskId: envelope.taskId,
        contractFp: envelope.contractFp
      }
    )).toThrow("VAULT_UNAVAILABLE");

    const issued = issueCapabilityTicket(
      { reachable: true, sealed: false },
      Buffer.from("0123456789abcdef"),
      {
        audience: "hermes",
        endpoint: "http://127.0.0.1:20128/v1",
        model: "cx/gpt-test",
        taskId: envelope.taskId,
        contractFp: envelope.contractFp
      }
    );
    expect(issued.token.includes(".")).toBe(true);
    expect(issued.ticket.audience).toBe("hermes");
  });

  it("redacts gateway keys before telemetry surfaces", () => {
    expect(redact("OMNIROUTE_API_KEY=test-gateway-key and sk-abcdefghijklmnopqrstuvwxyz")).toBe("*** and ***");
  });

  it("rejects illegal execution transitions", () => {
    expect(transition("VERIFYING", "ACCEPTED")).toBe("ACCEPTED");
    expect(() => transition("RUNNING", "RELEASED")).toThrow("ILLEGAL_TRANSITION:RUNNING->RELEASED");
  });
});
