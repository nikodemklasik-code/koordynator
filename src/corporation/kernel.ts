import { randomUUID } from "node:crypto";
import { CapabilityRegistry } from "./capability-registry.js";
import { compareCandidates, type CandidateComparison, type CandidatePolicy } from "./comparator.js";
import type {
  CorporateEvent,
  CorporateRisk,
  CorporateTask,
  CorporateTaskInput,
  CorporationSnapshot,
  Department,
  ExecutionPlan,
  HllDecision,
  RecruitmentRequest,
  RoleContract,
  SolutionCandidate
} from "./domain.js";
import { assertHllAllows, makeHllStatement } from "./hll.js";
import { buildBaselinePlan } from "./planner.js";
import { defaultDepartmentCharters, type CorporateFunction } from "./organization.js";
import type {
  CorporateEventStore,
  CorporationStateStore,
  ExecutorRegistryPort,
  HllPort
} from "./ports.js";

export class CorporationKernelError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "CorporationKernelError";
  }
}

export type RoleContractDraft = {
  name: string;
  departmentId: string;
  mission: string;
  capabilities: string[];
  allowedEffects: string[];
  allowedTools: string[];
  decisionRights: string[];
  successMeasures: string[];
  risk: CorporateRisk;
};

function iso(): string {
  return new Date().toISOString();
}

function cleanText(value: string, code: string, max = 2000): string {
  const text = value.trim();
  if (!text || text.length > max) throw new CorporationKernelError(code, 400);
  return text;
}

function cleanList(values: string[], code: string): string[] {
  const clean = [...new Set(values.map((item) => item.trim()).filter(Boolean))];
  if (!clean.length) throw new CorporationKernelError(code, 400);
  return clean;
}

function departmentForPlane(plane: CorporateTaskInput["plane"]): string {
  return {
    EXECUTIVE: "DEPT-CEO",
    STRATEGY: "DEPT-STRATEGY",
    PRODUCT: "DEPT-PRODUCT",
    MARKETING: "DEPT-MARKETING",
    SALES: "DEPT-SALES",
    LEGAL: "DEPT-LEGAL",
    HR: "DEPT-HR",
    FINANCE: "DEPT-FINANCE",
    PRODUCTION: "DEPT-PRODUCTION",
    TESTING: "DEPT-TESTING",
    QUALITY_CONTROL: "DEPT-QC",
    SECURITY: "DEPT-SECURITY",
    OPERATIONS: "DEPT-OPERATIONS",
    INTERNAL_DEVELOPMENT: "DEPT-INTERNAL-DEVELOPMENT",
    RESEARCH: "DEPT-RESEARCH",
    DATA: "DEPT-DATA",
    CUSTOMER_SUCCESS: "DEPT-CUSTOMER-SUCCESS",
    PROCUREMENT: "DEPT-PROCUREMENT",
    COMPLIANCE_RISK: "DEPT-COMPLIANCE-RISK",
    SCIENTIFIC_RESEARCH: "DEPT-SCIENCE-INNOVATION",
    INNOVATION: "DEPT-INNOVATION",
    VENTURE_STUDIO: "DEPT-VENTURE-STUDIO",
    GROWTH: "DEPT-GROWTH",
    CORPORATE_INTELLIGENCE: "DEPT-CORPORATE-INTELLIGENCE",
    LEGAL_PRODUCT: "DEPT-HARMONIA-LEGAL"
  }[plane];
}

function planeForFunction(fn: CorporateFunction): CorporateTaskInput["plane"] {
  if (fn === "CUSTOM") throw new CorporationKernelError("CUSTOM_DEPARTMENT_REQUIRES_EXPLICIT_PLANE", 400);
  return fn;
}

function riskForEffects(effects: string[]): CorporateRisk {
  const joined = effects.join("\n").toLowerCase();
  if (/secret\.write|billing|payment|external\.send|production|destructive/.test(joined)) return "CRITICAL";
  if (/deploy|release|git\.merge|vault\.read|account\.create|oauth/.test(joined)) return "HIGH";
  if (/fs\.write|browser/.test(joined)) return "MEDIUM";
  return "LOW";
}

function initialDepartments(at: string): Department[] {
  return defaultDepartmentCharters().map((charter) => ({
    departmentId: charter.departmentId,
    name: charter.name,
    plane: planeForFunction(charter.function),
    mission: charter.mission,
    responsibilities: [...charter.responsibilities],
    risk: charter.risk,
    status: charter.status,
    constitutionalSeed: true,
    createdAt: at
  }));
}

function initialRoles(at: string): RoleContract[] {
  return [
    {
      roleId: "ROLE-RESEARCH",
      name: "Research",
      departmentId: "DEPT-PRODUCT",
      mission: "Gather evidence and establish provenance before execution.",
      capabilities: ["research"],
      allowedEffects: [],
      allowedTools: ["fs.read", "web.search"],
      decisionRights: ["recommend"],
      successMeasures: ["evidence-backed findings", "explicit uncertainty"],
      risk: "LOW",
      status: "ACTIVE",
      version: 1,
      constitutionalSeed: true,
      createdBy: "CONSTITUTION",
      createdAt: at,
      updatedAt: at
    },
    {
      roleId: "ROLE-BUILDER",
      name: "Builder",
      departmentId: "DEPT-INTERNAL-DEVELOPMENT",
      mission: "Implement approved scoped changes.",
      capabilities: ["code", "implementation"],
      allowedEffects: ["fs.write"],
      allowedTools: ["fs.read", "fs.write"],
      decisionRights: ["implement-within-scope"],
      successMeasures: ["acceptance criteria pass", "scope respected"],
      risk: "MEDIUM",
      status: "ACTIVE",
      version: 1,
      constitutionalSeed: true,
      createdBy: "CONSTITUTION",
      createdAt: at,
      updatedAt: at
    },
    {
      roleId: "ROLE-BROWSER",
      name: "Browser Operator",
      departmentId: "DEPT-OPERATIONS",
      mission: "Perform supported browser verification and interaction.",
      capabilities: ["browser"],
      allowedEffects: ["browser"],
      allowedTools: ["browser"],
      decisionRights: ["navigate-approved-sites"],
      successMeasures: ["workflow receipt", "no unapproved external effect"],
      risk: "MEDIUM",
      status: "ACTIVE",
      version: 1,
      constitutionalSeed: true,
      createdBy: "CONSTITUTION",
      createdAt: at,
      updatedAt: at
    },
    {
      roleId: "ROLE-AUDITOR",
      name: "Auditor",
      departmentId: "DEPT-SECURITY",
      mission: "Independently review evidence, security and acceptance criteria.",
      capabilities: ["audit", "review"],
      allowedEffects: [],
      allowedTools: ["fs.read"],
      decisionRights: ["review", "return-for-revision"],
      successMeasures: ["independent verdict", "traceable evidence"],
      risk: "LOW",
      status: "ACTIVE",
      version: 1,
      constitutionalSeed: true,
      createdBy: "CONSTITUTION",
      createdAt: at,
      updatedAt: at
    }
  ];
}

export class CorporationKernel {
  private readonly capabilities: CapabilityRegistry;
  private serial: Promise<unknown> = Promise.resolve();

  constructor(private readonly ports: {
    hll: HllPort;
    state: CorporationStateStore;
    events: CorporateEventStore;
    executors: ExecutorRegistryPort;
  }) {
    this.capabilities = new CapabilityRegistry(ports.executors);
  }

  async snapshot(): Promise<CorporationSnapshot> {
    const existing = await this.ports.state.load();
    if (existing) return existing;

    const at = iso();
    const created: CorporationSnapshot = {
      schemaVersion: 1,
      language: "HLL",
      departments: initialDepartments(at),
      roles: initialRoles(at),
      recruitments: [],
      tasks: [],
      updatedAt: at
    };
    await this.ports.state.save(created);
    await this.event("CORPORATION_INITIALISED", "CORPORATION", {
      schemaVersion: 1,
      language: "HLL"
    });
    return created;
  }

  async submitTask(input: CorporateTaskInput): Promise<CorporateTask> {
    return this.mutate(async () => {
      const state = await this.snapshot();
      const departmentId = input.departmentId?.trim() || departmentForPlane(input.plane);
      const department = state.departments.find((item) =>
        item.departmentId === departmentId && item.status === "ACTIVE"
      );
      if (!department) throw new CorporationKernelError("DEPARTMENT_NOT_FOUND", 404);

      const normalized: CorporateTaskInput = {
        objective: cleanText(input.objective, "TASK_OBJECTIVE_INVALID"),
        plane: input.plane,
        departmentId,
        whyNow: cleanText(input.whyNow, "TASK_WHY_NOW_INVALID"),
        productImpact: cleanText(input.productImpact, "TASK_PRODUCT_IMPACT_INVALID"),
        securityImpact: cleanText(input.securityImpact, "TASK_SECURITY_IMPACT_INVALID"),
        acceptanceCriteria: cleanList(input.acceptanceCriteria, "TASK_ACCEPTANCE_INVALID"),
        dependencies: [...new Set(input.dependencies.map((item) => item.trim()).filter(Boolean))],
        requiredCapabilities: cleanList(input.requiredCapabilities, "TASK_CAPABILITIES_INVALID"),
        requestedEffects: [...new Set(input.requestedEffects.map((item) => item.trim()).filter(Boolean))],
        priority: input.priority,
        successDefinition: cleanText(input.successDefinition, "TASK_SUCCESS_INVALID"),
        provenance: {
          ...input.provenance,
          sourceId: cleanText(input.provenance.sourceId, "TASK_PROVENANCE_SOURCE_INVALID", 300),
          evidenceRefs: [...new Set(input.provenance.evidenceRefs.map((item) => item.trim()).filter(Boolean))]
        }
      };

      const taskId = `CORP-${randomUUID().slice(0, 8).toUpperCase()}`;
      const statement = makeHllStatement({
        subject: "TASK",
        proposition: `Corporate task ${taskId} is a traceable proposition for executive consideration.`,
        payload: {
          taskId,
          objective: normalized.objective,
          plane: normalized.plane,
          departmentId,
          whyNow: normalized.whyNow,
          productImpact: normalized.productImpact,
          securityImpact: normalized.securityImpact,
          acceptanceCriteria: normalized.acceptanceCriteria,
          dependencies: normalized.dependencies,
          requiredCapabilities: normalized.requiredCapabilities,
          requestedEffects: normalized.requestedEffects,
          priority: normalized.priority,
          successDefinition: normalized.successDefinition
        },
        provenance: normalized.provenance,
        requestedBrainActions: [
          "corporation.plan-task",
          "corporation.recruit",
          "corporation.delegate-task"
        ]
      });
      const hllDecision = await this.ports.hll.assess(statement);
      const at = iso();
      const task: CorporateTask = {
        ...normalized,
        taskId,
        departmentId,
        status: hllDecision.verdict === "BLOCK" || hllDecision.truthState === "REJECTED"
          ? "BLOCKED"
          : hllDecision.verdict === "ALLOW" && hllDecision.truthState === "RATIFIED"
            ? "PROPOSED"
            : "NEEDS_REVISION",
        assignedRoleIds: [],
        recruitmentIds: [],
        hllDecision,
        createdAt: at,
        updatedAt: at
      };

      state.tasks.push(task);
      state.updatedAt = at;
      await this.ports.state.save(state);
      await this.event("TASK_SUBMITTED", task.taskId, {
        status: task.status,
        hllDecisionId: hllDecision.decisionId
      });

      if (task.status !== "PROPOSED") return task;
      return this.planUnlocked(state, task.taskId);
    });
  }

  async replan(taskId: string): Promise<CorporateTask> {
    return this.mutate(async () => {
      const state = await this.snapshot();
      return this.planUnlocked(state, taskId);
    });
  }

  async fulfillRecruitment(
    recruitmentId: string,
    draft: RoleContractDraft,
    approved = false
  ): Promise<RoleContract> {
    return this.mutate(async () => {
      const state = await this.snapshot();
      const request = state.recruitments.find((item) => item.recruitmentId === recruitmentId);
      if (!request) throw new CorporationKernelError("RECRUITMENT_NOT_FOUND", 404);
      if (request.status !== "OPEN") throw new CorporationKernelError("RECRUITMENT_NOT_OPEN", 409);
      if (request.approvalRequired && !approved) {
        throw new CorporationKernelError("RECRUITMENT_APPROVAL_REQUIRED", 400);
      }

      const department = state.departments.find((item) => item.departmentId === draft.departmentId && item.status === "ACTIVE");
      if (!department) throw new CorporationKernelError("DEPARTMENT_NOT_FOUND", 404);

      const at = iso();
      const candidate: RoleContract = {
        roleId: `ROLE-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: cleanText(draft.name, "ROLE_NAME_INVALID", 160),
        departmentId: draft.departmentId,
        mission: cleanText(draft.mission, "ROLE_MISSION_INVALID"),
        capabilities: cleanList(draft.capabilities, "ROLE_CAPABILITIES_INVALID"),
        allowedEffects: [...new Set(draft.allowedEffects.map((item) => item.trim()).filter(Boolean))],
        allowedTools: [...new Set(draft.allowedTools.map((item) => item.trim()).filter(Boolean))],
        decisionRights: cleanList(draft.decisionRights, "ROLE_DECISION_RIGHTS_INVALID"),
        successMeasures: cleanList(draft.successMeasures, "ROLE_SUCCESS_MEASURES_INVALID"),
        risk: draft.risk,
        status: "ACTIVE",
        version: 1,
        constitutionalSeed: false,
        createdBy: "HR",
        recruitmentId,
        createdAt: at,
        updatedAt: at
      };

      if (!(await this.capabilities.roleWithinExecutorCeiling(candidate))) {
        throw new CorporationKernelError("ROLE_EXECUTOR_CEILING_UNAVAILABLE", 409);
      }

      const statement = makeHllStatement({
        subject: "ROLE_CONTRACT",
        proposition: `Role contract ${candidate.roleId} may become an active corporate capability.`,
        payload: candidate,
        provenance: {
          sourceType: "DEPARTMENT",
          sourceId: "DEPT-HR",
          evidenceRefs: [`recruitment:${request.recruitmentId}`],
          observedAt: at
        },
        requestedBrainActions: ["corporation.activate-role"]
      });
      const decision = await this.ports.hll.assess(statement);
      this.requireAllowed(decision, "corporation.activate-role");

      const role: RoleContract = { ...candidate, hllDecision: decision };
      state.roles.push(role);
      request.status = "HIRED";
      request.resultingRoleId = role.roleId;
      request.updatedAt = at;
      state.updatedAt = at;
      await this.ports.state.save(state);
      await this.event("ROLE_ACTIVATED", role.roleId, {
        recruitmentId,
        hllDecisionId: decision.decisionId
      });

      await this.planUnlocked(state, request.taskId);
      return role;
    });
  }

  async compareSolutions(
    taskId: string,
    candidates: SolutionCandidate[],
    policy?: CandidatePolicy
  ): Promise<CandidateComparison> {
    const state = await this.snapshot();
    if (!state.tasks.some((item) => item.taskId === taskId)) {
      throw new CorporationKernelError("TASK_NOT_FOUND", 404);
    }
    if (candidates.some((item) => item.taskId !== taskId)) {
      throw new CorporationKernelError("CANDIDATE_TASK_MISMATCH", 400);
    }

    const result = compareCandidates(candidates, policy);
    await this.event("CANDIDATES_COMPARED", taskId, {
      candidates: candidates.length,
      eligible: result.eligible.length,
      pareto: result.paretoFront.length,
      selectedCandidateId: result.selected?.candidateId ?? null
    });
    return result;
  }

  private async planUnlocked(state: CorporationSnapshot, taskId: string): Promise<CorporateTask> {
    const task = state.tasks.find((item) => item.taskId === taskId);
    if (!task) throw new CorporationKernelError("TASK_NOT_FOUND", 404);
    this.requireAllowed(task.hllDecision, "corporation.plan-task");

    const assigned = new Set<string>();
    const missing: string[] = [];

    for (const capability of task.requiredCapabilities) {
      const matches = await this.capabilities.rolesSatisfying(state.roles, [capability]);
      const selected = matches[0];
      if (selected) assigned.add(selected.role.roleId);
      else missing.push(capability);
    }

    const recruitmentIds = new Set(task.recruitmentIds);
    for (const capability of missing) {
      this.requireAllowed(task.hllDecision, "corporation.recruit");

      let request = state.recruitments.find((item) =>
        item.taskId === task.taskId
        && item.status !== "REJECTED"
        && item.missingCapabilities.length === 1
        && item.missingCapabilities[0]?.toLowerCase() === capability.toLowerCase()
      );

      if (!request) {
        const at = iso();
        const requestedEffects = [...task.requestedEffects];
        const risk = riskForEffects(requestedEffects);
        const candidate: RecruitmentRequest = {
          recruitmentId: `RECRUIT-${randomUUID().slice(0, 8).toUpperCase()}`,
          taskId: task.taskId,
          departmentId: task.departmentId ?? departmentForPlane(task.plane),
          requestedRoleName: `${task.plane.replace(/_/g, " ")} ${capability} specialist`,
          reason: `Capability gap for ${task.taskId}: ${capability}`,
          missingCapabilities: [capability],
          requestedEffects,
          requestedTools: [],
          risk,
          status: "PROPOSED",
          approvalRequired: risk === "HIGH" || risk === "CRITICAL",
          createdAt: at,
          updatedAt: at
        };

        const statement = makeHllStatement({
          subject: "RECRUITMENT",
          proposition: `The Corporation has a capability gap requiring recruitment ${candidate.recruitmentId}.`,
          payload: candidate,
          provenance: {
            sourceType: "SYSTEM",
            sourceId: "corporation-kernel",
            evidenceRefs: [`task:${task.taskId}`],
            observedAt: at
          },
          requestedBrainActions: ["corporation.open-recruitment"]
        });
        const decision = await this.ports.hll.assess(statement);
        request = {
          ...candidate,
          hllDecision: decision,
          status: decision.verdict === "BLOCK"
            ? "BLOCKED"
            : decision.truthState === "RATIFIED"
              && decision.verdict === "ALLOW"
              && decision.allowedBrainActions.includes("corporation.open-recruitment")
              ? "OPEN"
              : "NEEDS_REVISION"
        };
        state.recruitments.push(request);
        await this.event("RECRUITMENT_OPENED", request.recruitmentId, {
          taskId: task.taskId,
          capability,
          status: request.status
        });
      }
      recruitmentIds.add(request.recruitmentId);
    }

    task.assignedRoleIds = [...assigned];
    task.recruitmentIds = [...recruitmentIds];

    if (missing.length) {
      const related = state.recruitments.filter((item) => recruitmentIds.has(item.recruitmentId));
      task.status = related.some((item) => item.status === "BLOCKED" || item.status === "REJECTED")
        ? "BLOCKED"
        : "WAITING_FOR_ROLE";
      task.updatedAt = iso();
      state.updatedAt = task.updatedAt;
      await this.ports.state.save(state);
      return task;
    }

    const roles = state.roles.filter((role) => assigned.has(role.roleId) || role.roleId === "ROLE-RESEARCH" || role.roleId === "ROLE-AUDITOR");
    const plan = buildBaselinePlan(task, roles);
    const statement = makeHllStatement({
      subject: "DELEGATION",
      proposition: `Execution plan ${plan.planId} for ${task.taskId} is grounded enough for delegation.`,
      payload: {
        taskId: task.taskId,
        assignedRoleIds: task.assignedRoleIds,
        plan
      },
      provenance: {
        sourceType: "SYSTEM",
        sourceId: "corporation-kernel",
        evidenceRefs: [
          `task-decision:${task.hllDecision.decisionId}`,
          ...task.recruitmentIds.map((id) => `recruitment:${id}`)
        ],
        observedAt: iso()
      },
      requestedBrainActions: ["corporation.delegate-task"]
    });
    const decision = await this.ports.hll.assess(statement);
    const finalPlan: ExecutionPlan = { ...plan, hllDecision: decision };
    task.plan = finalPlan;
    task.status = decision.verdict === "BLOCK"
      ? "BLOCKED"
      : decision.truthState === "RATIFIED"
        && decision.verdict === "ALLOW"
        && decision.allowedBrainActions.includes("corporation.delegate-task")
        ? "READY"
        : "NEEDS_REVISION";
    task.updatedAt = iso();
    state.updatedAt = task.updatedAt;
    await this.ports.state.save(state);
    await this.event("TASK_PLANNED", task.taskId, {
      planId: plan.planId,
      status: task.status,
      assignedRoleIds: task.assignedRoleIds
    });
    return task;
  }

  private requireAllowed(decision: HllDecision, action: string): void {
    try {
      assertHllAllows(decision, action);
    } catch (error) {
      const code = error instanceof Error ? error.message : "HLL_ACTION_BLOCKED";
      throw new CorporationKernelError(code, code === "HLL_BRAIN_ACTION_NOT_ALLOWED" ? 403 : 409);
    }
  }

  private async event(type: string, subjectId: string, payload: Record<string, unknown>): Promise<void> {
    const event: CorporateEvent = {
      eventId: `EVT-${randomUUID().slice(0, 12).toUpperCase()}`,
      type,
      subjectId,
      at: iso(),
      payload
    };
    await this.ports.events.append(event);
  }

  private async mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.serial.then(fn, fn);
    this.serial = run.then(() => undefined, () => undefined);
    return run;
  }
}
