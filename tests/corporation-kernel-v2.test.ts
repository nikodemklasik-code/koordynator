import { describe, expect, it } from "vitest";
import { CorporationKernel } from "../src/corporation/kernel.js";
import type {
  CorporateEvent,
  CorporationSnapshot,
  ExecutorDescriptor,
  HllDecision,
  HllStatement,
  SolutionMetrics
} from "../src/corporation/domain.js";
import type { VerifiedSolutionCandidate } from "../src/corporation/comparator.js";
import type {
  CorporateEventStore,
  CorporationStateStore,
  ExecutorRegistryPort,
  HllAssessment,
  HllPort
} from "../src/corporation/ports.js";
import { createDecisionReceipt, createVerificationReceipt } from "../src/corporation/receipts.js";
import { VerifierTrustRegistry } from "../src/corporation/verification-trust.js";

class MemoryState implements CorporationStateStore {
  value: CorporationSnapshot | null = null;
  async load(): Promise<CorporationSnapshot | null> {
    return this.value === null ? null : structuredClone(this.value);
  }
  async save(snapshot: CorporationSnapshot): Promise<void> {
    this.value = structuredClone(snapshot);
  }
}

class MemoryEvents implements CorporateEventStore {
  readonly events: CorporateEvent[] = [];
  async append(event: CorporateEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
  async list(limit = 200): Promise<CorporateEvent[]> {
    return this.events.slice(-limit).map((item) => structuredClone(item));
  }
}

class StaticExecutors implements ExecutorRegistryPort {
  constructor(readonly descriptors: ExecutorDescriptor[]) {}
  async list(): Promise<ExecutorDescriptor[]> {
    return structuredClone(this.descriptors);
  }
}

const HLL_AUTHORITY = { authorityId: "hll-test", epoch: "1" };

function allowedDecision(statement: HllStatement): HllDecision {
  return {
    decisionId: `DEC-${statement.statementId}`,
    statementId: statement.statementId,
    subjectId: `SUBJECT-${statement.statementId}`,
    truthState: "CONFIRMED",
    eligibleForFact: true,
    blockers: [],
    allowedBrainActions: [...statement.requestedBrainActions].map((action) => ({
      action,
      scope: action === "EXTERNAL_SEND" ? "EXTERNAL" : "INTERNAL"
    })),
    provenanceIds: [`PROV-${statement.statementId}`],
    hllVersion: "HLL/1.0",
    canonicalRecordHash: `REC-${statement.statementId}`
  };
}

class RecordingHll implements HllPort {
  readonly statements: HllStatement[] = [];

  constructor(
    private readonly decide: (statement: HllStatement) => HllDecision = allowedDecision
  ) {}

  async assess(statement: HllStatement): Promise<HllAssessment> {
    this.statements.push(structuredClone(statement));
    const decision = this.decide(statement);
    return {
      decision,
      receipt: createDecisionReceipt({
        statement,
        decision,
        authority: HLL_AUTHORITY
      })
    };
  }
}

function executors(extra: ExecutorDescriptor[] = []): ExecutorDescriptor[] {
  return [
    {
      executorId: "executor-research",
      capabilities: ["research"],
      effects: [],
      tools: ["fs.read", "web.search"],
      risk: "LOW",
      healthy: true,
      costClass: "FREE"
    },
    {
      executorId: "executor-code",
      capabilities: ["code", "implementation"],
      effects: ["fs.write"],
      tools: ["fs.read", "fs.write"],
      risk: "MEDIUM",
      healthy: true,
      costClass: "FREE"
    },
    {
      executorId: "executor-audit",
      capabilities: ["audit", "review"],
      effects: [],
      tools: ["fs.read"],
      risk: "LOW",
      healthy: true,
      costClass: "FREE"
    },
    ...extra
  ];
}

function input(requiredCapabilities = ["code"]) {
  return {
    objective: "Implement a verified improvement without modifying the legacy kernel",
    plane: "INTERNAL_DEVELOPMENT" as const,
    whyNow: "The legacy orchestration model is becoming a bottleneck for safe autonomous work.",
    productImpact: "Creates a stable foundation for delegated corporate execution.",
    securityImpact: "Keeps execution behind HLL ratification and capability ceilings.",
    acceptanceCriteria: ["Kernel creates a plan", "HLL gates delegation", "Tests pass"],
    dependencies: [],
    requiredCapabilities,
    requestedEffects: ["fs.write"],
    priority: "P1" as const,
    successDefinition: "A ratified execution plan exists and every assigned role has a healthy executor.",
    provenance: {
      sourceType: "OWNER" as const,
      sourceId: "owner",
      evidenceRefs: ["architecture:corporation-v2"],
      observedAt: new Date().toISOString()
    }
  };
}

function verifierTrust(): VerifierTrustRegistry {
  const now = new Date(Date.now() - 1000).toISOString();
  return new VerifierTrustRegistry([
    {
      trustRootId: "trust-local",
      verifierId: "verifier-local",
      independentGroupId: "group-local",
      providerLineageId: "lineage-local",
      authority: "CORE",
      revoked: false,
      validFrom: now
    },
    {
      trustRootId: "trust-independent",
      verifierId: "verifier-independent",
      independentGroupId: "group-independent",
      providerLineageId: "lineage-independent",
      authority: "QC",
      revoked: false,
      validFrom: now
    }
  ]);
}

const strongMetrics: SolutionMetrics = {
  correctness: 0.95,
  security: 0.95,
  maintainability: 0.9,
  reversibility: 0.9,
  architectureFit: 0.9,
  productValue: 0.8,
  regressionRisk: 0.1,
  complexity: 0.2,
  moneyCost: 0.1,
  tokenCost: 0.2,
  latency: 0.2
};

describe("CorporationKernel v2", () => {
  it("plans a ratified task using a statement-bound HLL decision receipt", async () => {
    const state = new MemoryState();
    const events = new MemoryEvents();
    const hll = new RecordingHll();
    const kernel = new CorporationKernel({
      hll,
      state,
      events,
      executors: new StaticExecutors(executors())
    });

    const task = await kernel.submitTask(input());

    expect(task.status).toBe("READY");
    expect(task.assignedRoleIds).toContain("ROLE-BUILDER");
    expect(task.plan?.stages.length).toBeGreaterThan(0);
    expect(task.plan?.hllDecision?.truthState).toBe("CONFIRMED");
    expect(task.hllReceipt.statementFingerprint).toBe(task.hllStatement.fingerprint);
    expect(hll.statements.map((item) => item.subject)).toEqual(["TASK", "DELEGATION"]);
  });

  it("does not plan an unratified proposition even when the receipt itself is structurally valid", async () => {
    const hll = new RecordingHll((statement) => {
      if (statement.subject === "TASK") {
        return {
          ...allowedDecision(statement),
          truthState: "ERROR",
          eligibleForFact: false,
          blockers: ["PROVENANCE_INSUFFICIENT"],
          allowedBrainActions: [{ action: "DEFER", scope: "INTERNAL" }]
        };
      }
      return allowedDecision(statement);
    });
    const kernel = new CorporationKernel({
      hll,
      state: new MemoryState(),
      events: new MemoryEvents(),
      executors: new StaticExecutors(executors())
    });

    const task = await kernel.submitTask(input());

    expect(task.status).toBe("BLOCKED");
    expect(task.plan).toBeUndefined();
  });

  it("opens HLL-backed Recruitment with an immutable capability ceiling", async () => {
    const state = new MemoryState();
    const kernel = new CorporationKernel({
      hll: new RecordingHll(),
      state,
      events: new MemoryEvents(),
      executors: new StaticExecutors(executors())
    });

    const task = await kernel.submitTask(input(["database-forensics"]));
    const request = (await kernel.snapshot()).recruitments[0]!;

    expect(task.status).toBe("WAITING_FOR_ROLE");
    expect(request.status).toBe("OPEN");
    expect(request.capabilityCeiling.capabilities).toEqual(["database-forensics"]);
    expect(request.capabilityCeiling.effects).toEqual([]);
  });

  it("lets HR activate a role only within the Recruitment ceiling and healthy executor ceiling", async () => {
    const state = new MemoryState();
    const kernel = new CorporationKernel({
      hll: new RecordingHll(),
      state,
      events: new MemoryEvents(),
      executors: new StaticExecutors(executors([{
        executorId: "executor-forensics",
        capabilities: ["database-forensics"],
        effects: ["fs.write"],
        tools: ["fs.read"],
        risk: "MEDIUM",
        healthy: true,
        costClass: "LOW"
      }]))
    });

    const waiting = await kernel.submitTask(input(["database-forensics"]));
    const role = await kernel.fulfillRecruitment(waiting.recruitmentIds[0]!, {
      name: "Database Forensics Specialist",
      departmentId: "DEPT-INTERNAL-DEVELOPMENT",
      mission: "Investigate database state using traceable evidence.",
      capabilities: ["database-forensics"],
      allowedEffects: ["fs.write"],
      allowedTools: ["fs.read"],
      decisionRights: ["investigate-within-scope"],
      successMeasures: ["evidence-backed finding"],
      risk: "LOW"
    });

    expect(role.createdBy).toBe("HR");
    expect(role.risk).toBe("MEDIUM");
    expect(role.hllReceipt?.statementFingerprint).toBe(role.hllStatement?.fingerprint);
    expect((await kernel.snapshot()).tasks[0]?.status).toBe("READY");
  });

  it("blocks Role Contract privilege expansion beyond the Recruitment ceiling", async () => {
    const kernel = new CorporationKernel({
      hll: new RecordingHll(),
      state: new MemoryState(),
      events: new MemoryEvents(),
      executors: new StaticExecutors(executors([{
        executorId: "executor-forensics",
        capabilities: ["database-forensics"],
        effects: ["fs.write"],
        tools: ["fs.read"],
        risk: "MEDIUM",
        healthy: true,
        costClass: "LOW"
      }]))
    });

    const waiting = await kernel.submitTask(input(["database-forensics"]));

    await expect(kernel.fulfillRecruitment(waiting.recruitmentIds[0]!, {
      name: "Overpowered Specialist",
      departmentId: "DEPT-INTERNAL-DEVELOPMENT",
      mission: "Attempts to exceed the recruitment scope.",
      capabilities: ["database-forensics", "secrets-admin"],
      allowedEffects: ["fs.write"],
      allowedTools: ["fs.read"],
      decisionRights: ["investigate-within-scope"],
      successMeasures: ["verified result"],
      risk: "LOW"
    })).rejects.toMatchObject({ code: "ROLE_CAPABILITY_CEILING_EXCEEDED" });
  });

  it("selects candidates only from trusted artifact-bound verification receipts", async () => {
    const trust = verifierTrust();
    const kernel = new CorporationKernel({
      hll: new RecordingHll(),
      state: new MemoryState(),
      events: new MemoryEvents(),
      executors: new StaticExecutors(executors()),
      verifierTrust: trust
    });
    const task = await kernel.submitTask(input());

    const candidate = (
      id: string,
      metrics: SolutionMetrics,
      result: "PASS" | "FAIL" | "INCONCLUSIVE",
      verifierId: "verifier-local" | "verifier-independent",
      trustRootId: "trust-local" | "trust-independent",
      independentGroupId: "group-local" | "group-independent",
      providerLineageId: "lineage-local" | "lineage-independent"
    ): VerifiedSolutionCandidate => {
      const artifactFingerprint = `artifact-${id}`;
      return {
        taskId: task.taskId,
        evidenceRefs: [`tests:${id}`],
        candidateId: id,
        description: `Candidate ${id}`,
        metrics,
        artifactFingerprint,
        verificationReceipt: createVerificationReceipt({
          artifactFingerprint,
          verifierId,
          trustRootId,
          independentGroupId,
          providerLineageId,
          result,
          metrics,
          evidenceRefs: [`tests:${id}`]
        })
      };
    };

    const comparison = await kernel.compareSolutions(task.taskId, [
      candidate("A", strongMetrics, "PASS", "verifier-local", "trust-local", "group-local", "lineage-local"),
      candidate("B", { ...strongMetrics, correctness: 1, security: 1 }, "INCONCLUSIVE", "verifier-independent", "trust-independent", "group-independent", "lineage-independent"),
      candidate("C", { ...strongMetrics, correctness: 0.86, security: 0.86, maintainability: 0.7 }, "PASS", "verifier-independent", "trust-independent", "group-independent", "lineage-independent")
    ]);

    expect(comparison.selected?.candidateId).toBe("A");
    expect(comparison.rejected.find((item) => item.candidate.candidateId === "B")?.reasons)
      .toContain("NOT_VERIFIED");
  });
});
