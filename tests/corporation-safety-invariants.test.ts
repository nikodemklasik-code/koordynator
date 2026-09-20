import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeHllStatement } from "../src/corporation/hll.js";
import { authoriseAction } from "../src/corporation/action-gate.js";
import { JournalCorporationStore } from "../src/corporation/journal-store.js";
import { EphemeralWorktreeManager, type GitWorktreePort } from "../src/corporation/ephemeral-worktree.js";
import type { CorporateEvent, CorporationSnapshot, HllDecision } from "../src/corporation/domain.js";
import {
  createApprovalReceipt,
  createDecisionReceipt,
  verifyApprovalReceipt,
  verifyDecisionReceipt
} from "../src/corporation/receipts.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("receipt binding invariants", () => {
  it("rejects HLL receipt reuse after statement mutation", () => {
    const statement = makeHllStatement({
      subject: "TASK",
      proposition: "Bound task",
      payload: { taskId: "CORP-1", effect: "fs.write" },
      provenance: {
        sourceType: "OWNER",
        sourceId: "owner",
        evidenceRefs: ["owner:1"],
        observedAt: new Date().toISOString()
      },
      requestedBrainActions: ["corporation.plan-task"]
    });
    const decision: HllDecision = {
      decisionId: "DEC-1",
      statementId: statement.statementId,
      truthState: "RATIFIED",
      verdict: "ALLOW",
      reasons: [],
      allowedBrainActions: ["corporation.plan-task"],
      requiredAuthorisations: [],
      decidedAt: new Date().toISOString()
    };
    const receipt = createDecisionReceipt({
      statement,
      decision,
      authority: { authorityId: "hll", epoch: "42" }
    });

    verifyDecisionReceipt({
      statement,
      decision,
      receipt,
      action: "corporation.plan-task",
      expectedAuthority: { authorityId: "hll", epoch: "42" }
    });

    const mutated = { ...statement, fingerprint: "tampered" };
    expect(() => verifyDecisionReceipt({
      statement: mutated,
      decision,
      receipt,
      action: "corporation.plan-task",
      expectedAuthority: { authorityId: "hll", epoch: "42" }
    })).toThrow("HLL_RECEIPT_STATEMENT_FINGERPRINT_MISMATCH");
  });

  it("requires every HLL-declared authorisation before an action can execute", () => {
    const statement = makeHllStatement({
      subject: "OUTREACH",
      proposition: "A specific external action may be executed.",
      payload: { contactId: "CONTACT-1", messageHash: "msg-1" },
      provenance: {
        sourceType: "DEPARTMENT",
        sourceId: "DEPT-GROWTH",
        evidenceRefs: ["campaign:1"],
        observedAt: new Date().toISOString()
      },
      requestedBrainActions: ["corporation.external-send"]
    });
    const decision: HllDecision = {
      decisionId: "DEC-OUTREACH",
      statementId: statement.statementId,
      truthState: "RATIFIED",
      verdict: "ALLOW",
      reasons: [],
      allowedBrainActions: ["corporation.external-send"],
      requiredAuthorisations: ["owner.external-send"],
      decidedAt: new Date().toISOString()
    };
    const decisionReceipt = createDecisionReceipt({
      statement,
      decision,
      authority: { authorityId: "hll", epoch: "42" }
    });

    expect(() => authoriseAction({
      statement,
      decision,
      decisionReceipt,
      brainAction: "corporation.external-send",
      subjectId: "CONTACT-1",
      payload: { contactId: "CONTACT-1", messageHash: "msg-1" },
      scope: { channel: "email" },
      approvals: [],
      authorities: {
        "owner.external-send": { authorityId: "owner", epoch: "9" }
      }
    })).toThrow("ACTION_APPROVAL_MISSING:owner.external-send");

    const approval = createApprovalReceipt({
      authority: { authorityId: "owner", epoch: "9" },
      action: "owner.external-send",
      subjectId: "CONTACT-1",
      payload: { contactId: "CONTACT-1", messageHash: "msg-1" },
      scope: { channel: "email" },
      validUntil: new Date(Date.now() + 60_000).toISOString()
    });

    expect(authoriseAction({
      statement,
      decision,
      decisionReceipt,
      brainAction: "corporation.external-send",
      subjectId: "CONTACT-1",
      payload: { contactId: "CONTACT-1", messageHash: "msg-1" },
      scope: { channel: "email" },
      approvals: [approval],
      authorities: {
        "owner.external-send": { authorityId: "owner", epoch: "9" }
      }
    }).approvalReceiptIds).toEqual([approval.receiptId]);
  });

  it("binds approval to exact actor epoch, action, subject, payload and scope", () => {
    const authority = { authorityId: "owner", epoch: "7" };
    const receipt = createApprovalReceipt({
      authority,
      action: "corporation.activate-role",
      subjectId: "RECRUIT-1",
      payload: { capabilities: ["code"] },
      scope: { effects: ["fs.write"] },
      validUntil: new Date(Date.now() + 60_000).toISOString()
    });

    expect(() => verifyApprovalReceipt({
      receipt,
      authority,
      action: "corporation.activate-role",
      subjectId: "RECRUIT-1",
      payload: { capabilities: ["code", "secrets-admin"] },
      scope: { effects: ["fs.write"] }
    })).toThrow("APPROVAL_PAYLOAD_MISMATCH");
  });
});

describe("atomic state and audit journal", () => {
  it("commits snapshot and events as one hash-chained CAS unit and rejects stale writers", async () => {
    const root = await mkdtemp(join(tmpdir(), "corp-journal-"));
    roots.push(root);
    const store = new JournalCorporationStore(root);

    const snapshot: CorporationSnapshot = {
      schemaVersion: 1,
      revision: 1,
      language: "HLL",
      departments: [],
      roles: [],
      recruitments: [],
      tasks: [],
      updatedAt: new Date().toISOString()
    };
    const event: CorporateEvent = {
      eventId: "EVT-1",
      type: "TEST_COMMIT",
      subjectId: "CORPORATION",
      at: new Date().toISOString(),
      payload: { revision: 1 }
    };

    await store.commit({ expectedRevision: 0, snapshot, events: [event] });
    expect((await store.load())?.revision).toBe(1);
    expect((await store.list())[0]?.eventId).toBe("EVT-1");

    await expect(store.commit({
      expectedRevision: 0,
      snapshot: { ...snapshot, revision: 1 },
      events: []
    })).rejects.toThrow("CORPORATION_REVISION_CONFLICT");
  });
});

describe("ephemeral worktree isolation", () => {
  it("prepares candidate work in an isolated worktree without reset/clean/add-A on the operator worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "corp-wt-"));
    roots.push(root);
    const repoRoot = resolve(join(root, "repo"));
    const stateDir = resolve(join(root, "state"));
    const calls: Array<{ cwd: string; args: string[] }> = [];

    const git: GitWorktreePort = {
      run: async (cwd, args) => {
        calls.push({ cwd, args: [...args] });
        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return repoRoot;
        if (args[0] === "rev-parse" && args[1] === "--verify") return "abc123";
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123";
        if (args[0] === "status") return " M src/example.ts";
        return "";
      }
    };

    const manager = new EphemeralWorktreeManager(repoRoot, stateDir, git);
    const lease = manager.createLease({
      taskId: "CORP-1",
      stageId: "STAGE-BUILD",
      candidateId: "A",
      roleId: "ROLE-BUILDER",
      executorId: "executor-code",
      allowedCapabilities: ["code", "typescript"],
      allowedEffects: ["fs.write"],
      allowedTools: ["git", "node"]
    });
    const worktree = await manager.prepare({ lease, baseRef: "main" });
    const status = await manager.status(worktree);

    expect(worktree.worktreePath.startsWith(resolve(stateDir))).toBe(true);
    expect(status.changedPaths).toEqual(["src/example.ts"]);
    expect(calls.some((call) => call.args[0] === "worktree" && call.args[1] === "add")).toBe(true);
    expect(calls.some((call) => ["reset", "clean"].includes(call.args[0] ?? ""))).toBe(false);
    expect(calls.some((call) => call.args[0] === "add" && call.args.includes("-A"))).toBe(false);
    expect(calls.some((call) => call.cwd === repoRoot && call.args[0] === "switch")).toBe(false);
  });
});
