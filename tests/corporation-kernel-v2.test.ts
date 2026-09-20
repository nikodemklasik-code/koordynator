import { describe, expect, it } from "vitest";
import { CorporationKernel } from "../src/corporation/kernel.js";
import type {
  CorporateEvent,
  CorporationSnapshot,
  ExecutorDescriptor,
  HllDecision,
  HllStatement,
  SolutionCandidate
} from "../src/corporation/domain.js";
import type {
  CorporateEventStore,
  CorporationStateStore,
  ExecutorRegistryPort,
  HllPort
} from "../src/corporation/ports.js";

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

function allowedDecision(statement: HllStatement): HllDecision {
  return {
    decisionId: `DEC-${statement.statementId}`,
    statementId: statement.statementId,
    truthState: "RATIFIED",
    verdict: "ALLOW",
    reasons: [],
    allowedBrainActions: [...statement.requestedBrainActions],
    requiredAuthorisations: [],
    canonicalRecord: `HLL(${statement.subject})`,
    canonicalFingerprint: statement.fingerprint,
    decidedAt: new Date().toISOString()
  };
}

class RecordingHll implements HllPort {
  readonly statements: HllStatement[] = [];

  constructor(
    private readonly decide: (statement: HllStatement) => HllDecision = allowedDecision
  ) {}

  async assess(statement: HllStatement): Promise<HllDecision> {
    this.statements.push(structuredClone(statement));
    return this.decide(statement);
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

describe("CorporationKernel v2", () => {
  it("plans a ratified task using dynamic capabilities instead of legacy TaskRole enums", async () => {
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
    expect(task.plan?.hllDecision?.truthState).toBe("RATIFIED");
    expect(hll.statements.map((item) => item.subject)).toEqual(["TASK", "DELEGATION"]);
    expect((await kernel.snapshot()).language).toBe("HLL");
  });

  it("does not plan an unratified proposition", async () => {
    const hll = new RecordingHll((statement) => {
      if (statement.subject === "TASK") {
        return {
          ...allowedDecision(statement),
          truthState: "UNKNOWN",
          verdict: "REVISE",
          reasons: ["PROVENANCE_INSUFFICIENT"],
          allowedBrainActions: []
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

    expect(task.status).toBe("NEEDS_REVISION");
    expect(task.plan).toBeUndefined();
    expect(hll.statements.map((item) => item.subject)).toEqual(["TASK"]);
  });

  it("opens HLL-backed Recruitment for a real capability gap", async () => {
    const state = new MemoryState();
    const hll = new RecordingHll();
    const kernel = new CorporationKernel({
      hll,
      state,
      events: new MemoryEvents(),
      executors: new StaticExecutors(executors())
    });

    const task = await kernel.submitTask(input(["database-forensics"]));
    const snapshot = await kernel.snapshot();

    expect(task.status).toBe("WAITING_FOR_ROLE");
    expect(task.recruitmentIds).toHaveLength(1);
    expect(snapshot.recruitments).toHaveLength(1);
    expect(snapshot.recruitments[0]?.status).toBe("OPEN");
    expect(snapshot.recruitments[0]?.missingCapabilities).toEqual(["database-forensics"]);
    expect(hll.statements.map((item) => item.subject)).toEqual(["TASK", "RECRUITMENT"]);
  });

  it("lets HR activate a new role only when a healthy executor can satisfy its capability ceiling", async () => {
    const state = new MemoryState();
    const hll = new RecordingHll();
    const kernel = new CorporationKernel({
      hll,
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
    const recruitmentId = waiting.recruitmentIds[0]!;

    const role = await kernel.fulfillRecruitment(recruitmentId, {
      name: "Database Forensics Specialist",
      departmentId: "DEPT-INTERNAL-DEVELOPMENT",
      mission: "Investigate database state using traceable evidence.",
      capabilities: ["database-forensics"],
      allowedEffects: ["fs.write"],
      allowedTools: ["fs.read"],
      decisionRights: ["investigate-within-scope"],
      successMeasures: ["evidence-backed finding"],
      risk: "MEDIUM"
    });

    expect(role.createdBy).toBe("HR");
    expect(role.hllDecision?.truthState).toBe("RATIFIED");

    const snapshot = await kernel.snapshot();
    expect(snapshot.recruitments[0]?.status).toBe("HIRED");
    expect(snapshot.tasks[0]?.status).toBe("READY");
    expect(snapshot.tasks[0]?.assignedRoleIds).toContain(role.roleId);
    expect(hll.statements.map((item) => item.subject)).toContain("ROLE_CONTRACT");
    expect(hll.statements.map((item) => item.subject)).toContain("DELEGATION");
  });

  it("blocks role activation when no executor can satisfy the role contract", async () => {
    const state = new MemoryState();
    const kernel = new CorporationKernel({
      hll: new RecordingHll(),
      state,
      events: new MemoryEvents(),
      executors: new StaticExecutors(executors())
    });

    const waiting = await kernel.submitTask(input(["database-forensics"]));

    await expect(kernel.fulfillRecruitment(waiting.recruitmentIds[0]!, {
      name: "Impossible Specialist",
      departmentId: "DEPT-INTERNAL-DEVELOPMENT",
      mission: "Requires a capability for which the Corporation has no executor.",
      capabilities: ["database-forensics"],
      allowedEffects: ["vault.read"],
      allowedTools: ["vault.read"],
      decisionRights: ["investigate"],
      successMeasures: ["verified result"],
      risk: "HIGH"
    }, true)).rejects.toMatchObject({ code: "ROLE_EXECUTOR_CEILING_UNAVAILABLE" });
  });

  it("selects the best verified candidate after hard correctness and security gates", async () => {
    const kernel = new CorporationKernel({
      hll: new RecordingHll(),
      state: new MemoryState(),
      events: new MemoryEvents(),
      executors: new StaticExecutors(executors())
    });
    const task = await kernel.submitTask(input());

    const base = {
      taskId: task.taskId,
      evidenceRefs: ["tests:pass"]
    };
    const candidates: SolutionCandidate[] = [
      {
        ...base,
        candidateId: "A",
        description: "Simple verified repair",
        verified: true,
        metrics: {
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
        }
      },
      {
        ...base,
        candidateId: "B",
        description: "Unverified but attractive shortcut",
        verified: false,
        metrics: {
          correctness: 1,
          security: 1,
          maintainability: 1,
          reversibility: 1,
          architectureFit: 1,
          productValue: 1,
          regressionRisk: 0,
          complexity: 0,
          moneyCost: 0,
          tokenCost: 0,
          latency: 0
        }
      },
      {
        ...base,
        candidateId: "C",
        description: "Verified but weaker alternative",
        verified: true,
        metrics: {
          correctness: 0.86,
          security: 0.86,
          maintainability: 0.7,
          reversibility: 0.7,
          architectureFit: 0.7,
          productValue: 0.7,
          regressionRisk: 0.3,
          complexity: 0.4,
          moneyCost: 0.2,
          tokenCost: 0.3,
          latency: 0.4
        }
      }
    ];

    const comparison = await kernel.compareSolutions(task.taskId, candidates);

    expect(comparison.selected?.candidateId).toBe("A");
    expect(comparison.rejected.find((item) => item.candidate.candidateId === "B")?.reasons)
      .toContain("NOT_VERIFIED");
  });
});
