import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CorporateOrchestrator,
  type CorporateTaskRequest
} from "../src/control/corporate-orchestrator.js";
import type {
  CorporateHllDecision,
  CorporateHllPort,
  CorporateHllStatement
} from "../src/control/corporate-hll.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "koord-corporation-"));
  roots.push(root);
  return root;
}

function decision(statement: CorporateHllStatement, allowedBrainActions = statement.requestedBrainActions): CorporateHllDecision {
  return {
    decisionId: `DEC-${statement.statementId}`,
    statementId: statement.statementId,
    truthState: "RATIFIED",
    verdict: "ALLOW",
    reasons: [],
    allowedBrainActions,
    requiredAuthorisations: [],
    canonicalRecord: `HLL(${statement.subject}:${statement.proposition})`,
    canonicalFingerprint: statement.fingerprint,
    decidedAt: new Date().toISOString()
  };
}

class RecordingHll implements CorporateHllPort {
  readonly statements: CorporateHllStatement[] = [];

  constructor(private readonly transform?: (statement: CorporateHllStatement) => CorporateHllDecision) {}

  async assess(statement: CorporateHllStatement): Promise<CorporateHllDecision> {
    this.statements.push(statement);
    return this.transform ? this.transform(statement) : decision(statement);
  }
}

function task(overrides: Partial<CorporateTaskRequest> = {}): CorporateTaskRequest {
  return {
    objective: "Build an evidence-backed corporate capability",
    plane: "INTERNAL_DEVELOPMENT",
    whyNow: "The current platform lacks the required capability and needs a controlled implementation path.",
    productImpact: "Improves reliability and reduces repeated manual repair work.",
    securityImpact: "No privilege expansion; changes remain inside the current capability ceiling.",
    acceptanceCriteria: ["Feature works", "Tests pass", "Receipts are persisted"],
    requiredCapabilities: ["code"],
    successDefinition: "The capability is implemented, independently verified and represented by HLL evidence.",
    evidenceRefs: ["owner:request-1"],
    ...overrides
  };
}

describe("CorporateOrchestrator with HLL as internal language", () => {
  it("stores HLL as the corporate language and plans only from ratified task truth", async () => {
    const root = await fixture();
    const hll = new RecordingHll();
    const corporation = new CorporateOrchestrator(root, hll);

    const result = await corporation.submitTask(task());

    expect(result.status).toBe("READY");
    expect(result.hllDecision.truthState).toBe("RATIFIED");
    expect(result.planHllDecision?.truthState).toBe("RATIFIED");
    expect(result.plan.length).toBeGreaterThan(0);

    const snapshot = await corporation.snapshot();
    expect(snapshot.language).toBe("HLL");
    expect(hll.statements.map((item) => item.subject)).toContain("TASK");
    expect(hll.statements.map((item) => item.subject)).toContain("DELEGATION");
  });

  it("does not turn an unratified task proposition into executable corporate truth", async () => {
    const root = await fixture();
    const hll = new RecordingHll((statement) => {
      if (statement.subject === "TASK") {
        return {
          ...decision(statement, []),
          truthState: "UNKNOWN",
          verdict: "REVISE",
          reasons: ["PROVENANCE_INSUFFICIENT"]
        };
      }
      return decision(statement);
    });
    const corporation = new CorporateOrchestrator(root, hll);

    const result = await corporation.submitTask(task());

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.plan).toEqual([]);
    expect(hll.statements.map((item) => item.subject)).toEqual(["TASK"]);
  });

  it("opens HLL-backed Recruitment when a required role does not exist", async () => {
    const root = await fixture();
    const hll = new RecordingHll();
    const corporation = new CorporateOrchestrator(root, hll);

    const result = await corporation.submitTask(task({
      requiredCapabilities: ["database-forensics"]
    }));

    expect(result.status).toBe("WAITING_FOR_ROLE");
    expect(result.recruitmentIds).toHaveLength(1);

    const snapshot = await corporation.snapshot();
    expect(snapshot.recruitments).toHaveLength(1);
    expect(snapshot.recruitments[0]?.status).toBe("OPEN");
    expect(snapshot.recruitments[0]?.hllDecision.truthState).toBe("RATIFIED");
    expect(hll.statements.map((item) => item.subject)).toContain("RECRUITMENT");
  });

  it("HR creates a persistent Role Contract only after HLL ratifies activation", async () => {
    const root = await fixture();
    const hll = new RecordingHll();
    const corporation = new CorporateOrchestrator(root, hll);

    const waiting = await corporation.submitTask(task({
      requiredCapabilities: ["database-forensics"]
    }));
    const recruitmentId = waiting.recruitmentIds[0]!;
    const role = await corporation.hire(recruitmentId, false);

    expect(role.createdBy).toBe("HR");
    expect(role.constitutionalSeed).toBe(false);
    expect(role.hllDecision?.truthState).toBe("RATIFIED");

    const snapshot = await corporation.snapshot();
    expect(snapshot.recruitments[0]?.status).toBe("HIRED");
    expect(snapshot.tasks[0]?.status).toBe("READY");
    expect(snapshot.tasks[0]?.assignedRoleIds).toContain(role.roleId);
    expect(hll.statements.map((item) => item.subject)).toContain("ROLE_CONTRACT");
  });

  it("refuses to plan when HLL ratifies the statement but does not permit the Brain action", async () => {
    const root = await fixture();
    const hll = new RecordingHll((statement) => {
      if (statement.subject === "TASK") {
        return decision(statement, ["corporation.recruit"]);
      }
      return decision(statement);
    });
    const corporation = new CorporateOrchestrator(root, hll);

    await expect(corporation.submitTask(task()))
      .rejects.toMatchObject({ code: "HLL_BRAIN_ACTION_NOT_ALLOWED" });
  });

  it("requires HLL ratification before a dynamic department becomes canonical corporate state", async () => {
    const root = await fixture();
    const hll = new RecordingHll();
    const corporation = new CorporateOrchestrator(root, hll);

    const department = await corporation.createDepartment({
      name: "Data Quality",
      plane: "PRODUCT",
      mission: "Keep product data provenance and quality measurable.",
      responsibilities: ["data quality", "provenance", "quality controls"],
      evidenceRefs: ["portfolio:quality-gap"]
    });

    expect(department.constitutionalSeed).toBe(false);
    expect(department.hllDecision?.truthState).toBe("RATIFIED");
    expect(hll.statements.at(-1)?.subject).toBe("DEPARTMENT");
  });
});
