import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TaskRole } from "../domain/task-envelope.js";

export type CorporatePlane =
  | "INTERNAL_DEVELOPMENT"
  | "PRODUCT"
  | "SECURITY"
  | "OPERATIONS"
  | "HR"
  | "LEGAL_PRODUCT";

export type DepartmentStatus = "ACTIVE" | "PAUSED";
export type RoleContractStatus = "ACTIVE" | "PAUSED" | "RETIRED";
export type RecruitmentStatus = "OPEN" | "HIRED" | "REJECTED";
export type CorporateTaskStatus =
  | "PROPOSED"
  | "NEEDS_REVISION"
  | "WAITING_FOR_ROLE"
  | "READY"
  | "BLOCKED"
  | "DELEGATED"
  | "DONE";

export type HarmoniaVerdict = "ALLOW" | "REVISE" | "BLOCK";

export type Department = {
  departmentId: string;
  name: string;
  plane: CorporatePlane;
  mission: string;
  responsibilities: string[];
  riskClass: "STANDARD" | "ELEVATED" | "HIGH";
  status: DepartmentStatus;
  createdAt: string;
};

export type RoleContract = {
  roleId: string;
  name: string;
  departmentId: string;
  mission: string;
  requiredCapabilities: string[];
  allowedTools: string[];
  executionRole: TaskRole;
  decisionRights: string[];
  successMeasures: string[];
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  status: RoleContractStatus;
  version: number;
  createdBy: "SYSTEM" | "HR";
  recruitmentId?: string;
  createdAt: string;
  updatedAt: string;
};

export type RecruitmentRequest = {
  recruitmentId: string;
  requestedRoleName: string;
  departmentId: string;
  reason: string;
  requiredCapabilities: string[];
  requestedTools: string[];
  executionRole: TaskRole;
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  approvalRequired: boolean;
  taskIds: string[];
  status: RecruitmentStatus;
  resultingRoleId?: string;
  createdAt: string;
  updatedAt: string;
};

export type HarmoniaTaskReview = {
  verdict: HarmoniaVerdict;
  reasons: string[];
  reviewedAt: string;
  product: "HARMONIA";
};

export type ExecutionPhase = {
  phase: "DISCOVERY" | "BUILD" | "SECURITY" | "VERIFY" | "DELIVERY";
  roleId?: string;
  executionRole: TaskRole;
  objective: string;
  successCondition: string;
};

export type CorporateTask = {
  corporateTaskId: string;
  objective: string;
  plane: CorporatePlane;
  departmentId: string;
  whyNow: string;
  productImpact: string;
  securityImpact: string;
  acceptanceCriteria: string[];
  dependencies: string[];
  requiredCapabilities: string[];
  priority: "P0" | "P1" | "P2" | "P3";
  status: CorporateTaskStatus;
  harmonia: HarmoniaTaskReview;
  assignedRoleIds: string[];
  recruitmentIds: string[];
  plan: ExecutionPhase[];
  successDefinition: string;
  createdAt: string;
  updatedAt: string;
};

export type CorporateState = {
  departments: Department[];
  roles: RoleContract[];
  recruitments: RecruitmentRequest[];
  tasks: CorporateTask[];
  updatedAt: string;
};

export type CorporateTaskRequest = {
  objective: string;
  plane: CorporatePlane;
  departmentId?: string;
  whyNow: string;
  productImpact: string;
  securityImpact: string;
  acceptanceCriteria: string[];
  dependencies?: string[];
  requiredCapabilities: string[];
  priority?: "P0" | "P1" | "P2" | "P3";
  successDefinition: string;
};

export class CorporateOrchestratorError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "CorporateOrchestratorError";
  }
}

const DEFAULT_DEPARTMENTS: Array<Omit<Department, "createdAt">> = [
  {
    departmentId: "DEPT-INTERNAL-DEVELOPMENT",
    name: "Internal Development",
    plane: "INTERNAL_DEVELOPMENT",
    mission: "Improve Koordynator's own architecture, reliability and autonomous operating capability.",
    responsibilities: ["platform architecture", "runtime", "developer tooling", "self-improvement"],
    riskClass: "ELEVATED",
    status: "ACTIVE"
  },
  {
    departmentId: "DEPT-PRODUCT",
    name: "Product",
    plane: "PRODUCT",
    mission: "Turn strategy and user needs into coherent product outcomes.",
    responsibilities: ["product design", "requirements", "roadmap", "UX"],
    riskClass: "STANDARD",
    status: "ACTIVE"
  },
  {
    departmentId: "DEPT-SECURITY",
    name: "Security",
    plane: "SECURITY",
    mission: "Prevent unsafe capability expansion and protect systems, users and data.",
    responsibilities: ["threat modelling", "security gates", "access control", "incident response"],
    riskClass: "HIGH",
    status: "ACTIVE"
  },
  {
    departmentId: "DEPT-OPERATIONS",
    name: "Operations",
    plane: "OPERATIONS",
    mission: "Keep services healthy, observable and recoverable.",
    responsibilities: ["health", "availability", "backups", "operational response"],
    riskClass: "ELEVATED",
    status: "ACTIVE"
  },
  {
    departmentId: "DEPT-HR",
    name: "HR / Recruitment",
    plane: "HR",
    mission: "Create bounded internal roles and contracts when the Corporation lacks required capability.",
    responsibilities: ["role contracts", "recruitment", "capability mapping", "role lifecycle"],
    riskClass: "STANDARD",
    status: "ACTIVE"
  },
  {
    departmentId: "DEPT-HARMONIA",
    name: "Legal Product / Harmonia",
    plane: "LEGAL_PRODUCT",
    mission: "Protect the coherence, legal-product value and governance of Harmonia.",
    responsibilities: ["product sense", "legal workflow fit", "governance review", "quality criteria"],
    riskClass: "ELEVATED",
    status: "ACTIVE"
  }
];

const DEFAULT_ROLES: Array<Omit<RoleContract, "createdAt" | "updatedAt">> = [
  {
    roleId: "ROLE-RESEARCH",
    name: "Research",
    departmentId: "DEPT-PRODUCT",
    mission: "Gather and synthesise evidence before execution.",
    requiredCapabilities: ["research"],
    allowedTools: ["fs.read", "web.search"],
    executionRole: "research",
    decisionRights: ["recommend"],
    successMeasures: ["evidence-backed findings"],
    riskClass: "LOW",
    status: "ACTIVE",
    version: 1,
    createdBy: "SYSTEM"
  },
  {
    roleId: "ROLE-BUILDER",
    name: "Builder",
    departmentId: "DEPT-INTERNAL-DEVELOPMENT",
    mission: "Implement approved scoped changes.",
    requiredCapabilities: ["code", "implementation"],
    allowedTools: ["fs.read", "fs.write"],
    executionRole: "code",
    decisionRights: ["implement-within-scope"],
    successMeasures: ["tests pass", "scope respected"],
    riskClass: "MEDIUM",
    status: "ACTIVE",
    version: 1,
    createdBy: "SYSTEM"
  },
  {
    roleId: "ROLE-BROWSER",
    name: "Browser Operator",
    departmentId: "DEPT-OPERATIONS",
    mission: "Execute approved browser checks and supported interactive workflows.",
    requiredCapabilities: ["browser"],
    allowedTools: ["browser"],
    executionRole: "browser",
    decisionRights: ["navigate-approved-sites"],
    successMeasures: ["workflow completed", "receipt captured"],
    riskClass: "MEDIUM",
    status: "ACTIVE",
    version: 1,
    createdBy: "SYSTEM"
  },
  {
    roleId: "ROLE-AUDITOR",
    name: "Auditor",
    departmentId: "DEPT-SECURITY",
    mission: "Independently review evidence, scope and verification results.",
    requiredCapabilities: ["audit", "review"],
    allowedTools: ["fs.read"],
    executionRole: "audit",
    decisionRights: ["review", "return-for-revision"],
    successMeasures: ["independent verdict", "traceable evidence"],
    riskClass: "LOW",
    status: "ACTIVE",
    version: 1,
    createdBy: "SYSTEM"
  },
  {
    roleId: "ROLE-DEPLOY",
    name: "Release Operator",
    departmentId: "DEPT-OPERATIONS",
    mission: "Perform explicitly approved release actions.",
    requiredCapabilities: ["deploy", "release"],
    allowedTools: ["release"],
    executionRole: "deploy",
    decisionRights: ["release-after-approval"],
    successMeasures: ["release receipt", "rollback readiness"],
    riskClass: "HIGH",
    status: "ACTIVE",
    version: 1,
    createdBy: "SYSTEM"
  }
];

const EXECUTION_TOOL_CEILING: Record<TaskRole, Set<string>> = {
  research: new Set(["fs.read", "web.search"]),
  code: new Set(["fs.read", "fs.write"]),
  browser: new Set(["browser"]),
  audit: new Set(["fs.read"]),
  deploy: new Set(["release"])
};

function now(): string {
  return new Date().toISOString();
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function requireText(value: unknown, code: string, max = 1200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new CorporateOrchestratorError(code, 400);
  }
  return value.trim();
}

function requireList(value: unknown, code: string): string[] {
  if (!Array.isArray(value)) throw new CorporateOrchestratorError(code, 400);
  const clean = uniq(value.map((item) => typeof item === "string" ? item : ""));
  if (!clean.length) throw new CorporateOrchestratorError(code, 400);
  return clean;
}

function taskId(): string {
  return `CORP-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function recruitmentId(): string {
  return `RECRUIT-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function roleId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 36) || "ROLE";
  return `ROLE-${slug}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function reviewTask(input: CorporateTaskRequest): HarmoniaTaskReview {
  const reasons: string[] = [];

  if (input.objective.trim().length < 12) reasons.push("OBJECTIVE_TOO_VAGUE");
  if (input.whyNow.trim().length < 12) reasons.push("WHY_NOW_INSUFFICIENT");
  if (input.productImpact.trim().length < 12) reasons.push("PRODUCT_IMPACT_INSUFFICIENT");
  if (!input.acceptanceCriteria.length) reasons.push("ACCEPTANCE_CRITERIA_MISSING");
  if (!input.requiredCapabilities.length) reasons.push("CAPABILITIES_MISSING");
  if (input.successDefinition.trim().length < 12) reasons.push("SUCCESS_DEFINITION_INSUFFICIENT");

  const security = input.securityImpact.trim().toUpperCase();
  if (security.includes("BYPASS") || security.includes("DISABLE SECURITY") || security.includes("STEAL")) {
    return {
      verdict: "BLOCK",
      reasons: ["SECURITY_CONFLICT"],
      reviewedAt: now(),
      product: "HARMONIA"
    };
  }

  return {
    verdict: reasons.length ? "REVISE" : "ALLOW",
    reasons,
    reviewedAt: now(),
    product: "HARMONIA"
  };
}

function mapExecutionRole(capabilities: string[]): TaskRole {
  const lower = capabilities.map((item) => item.toLowerCase());
  if (lower.some((item) => /deploy|release/.test(item))) return "deploy";
  if (lower.some((item) => /browser|ui|e2e|web interaction/.test(item))) return "browser";
  if (lower.some((item) => /audit|review|security review/.test(item))) return "audit";
  if (lower.some((item) => /code|implementation|build|refactor|fix/.test(item))) return "code";
  return "research";
}

function riskFor(executionRole: TaskRole, tools: string[]): "LOW" | "MEDIUM" | "HIGH" {
  if (executionRole === "deploy" || tools.some((tool) => /deploy|release|vault|secret|merge/.test(tool))) return "HIGH";
  if (executionRole === "code" || executionRole === "browser") return "MEDIUM";
  return "LOW";
}

function toolsFor(executionRole: TaskRole): string[] {
  return [...EXECUTION_TOOL_CEILING[executionRole]];
}

function departmentForPlane(plane: CorporatePlane): string {
  return {
    INTERNAL_DEVELOPMENT: "DEPT-INTERNAL-DEVELOPMENT",
    PRODUCT: "DEPT-PRODUCT",
    SECURITY: "DEPT-SECURITY",
    OPERATIONS: "DEPT-OPERATIONS",
    HR: "DEPT-HR",
    LEGAL_PRODUCT: "DEPT-HARMONIA"
  }[plane];
}

export class CorporateOrchestrator {
  private readonly root: string;
  private readonly statePath: string;
  private writing: Promise<unknown> = Promise.resolve();

  constructor(stateDir: string) {
    this.root = join(resolve(stateDir), "corporation");
    this.statePath = join(this.root, "state.json");
  }

  async snapshot(): Promise<CorporateState> {
    try {
      return JSON.parse(await readFile(this.statePath, "utf8")) as CorporateState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const createdAt = now();
      const state: CorporateState = {
        departments: DEFAULT_DEPARTMENTS.map((item) => ({ ...item, createdAt })),
        roles: DEFAULT_ROLES.map((item) => ({ ...item, createdAt, updatedAt: createdAt })),
        recruitments: [],
        tasks: [],
        updatedAt: createdAt
      };
      await this.persist(state);
      return state;
    }
  }

  async createDepartment(input: {
    name: string;
    plane: CorporatePlane;
    mission: string;
    responsibilities: string[];
    riskClass?: "STANDARD" | "ELEVATED" | "HIGH";
  }): Promise<Department> {
    return this.serial(async () => {
      const state = await this.snapshot();
      const name = requireText(input.name, "DEPARTMENT_NAME_INVALID", 120);
      const existing = state.departments.find((item) => item.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;

      const department: Department = {
        departmentId: `DEPT-${randomUUID().slice(0, 8).toUpperCase()}`,
        name,
        plane: input.plane,
        mission: requireText(input.mission, "DEPARTMENT_MISSION_INVALID"),
        responsibilities: requireList(input.responsibilities, "DEPARTMENT_RESPONSIBILITIES_INVALID"),
        riskClass: input.riskClass ?? "STANDARD",
        status: "ACTIVE",
        createdAt: now()
      };
      state.departments.push(department);
      state.updatedAt = now();
      await this.persist(state);
      return department;
    });
  }

  async submitTask(input: CorporateTaskRequest): Promise<CorporateTask> {
    return this.serial(async () => {
      const state = await this.snapshot();
      const departmentId = input.departmentId?.trim() || departmentForPlane(input.plane);
      const department = state.departments.find((item) => item.departmentId === departmentId && item.status === "ACTIVE");
      if (!department) throw new CorporateOrchestratorError("CORPORATE_DEPARTMENT_NOT_FOUND", 404);

      const normalized: CorporateTaskRequest = {
        objective: requireText(input.objective, "CORPORATE_TASK_OBJECTIVE_INVALID"),
        plane: input.plane,
        departmentId,
        whyNow: requireText(input.whyNow, "CORPORATE_TASK_WHY_NOW_INVALID"),
        productImpact: requireText(input.productImpact, "CORPORATE_TASK_PRODUCT_IMPACT_INVALID"),
        securityImpact: requireText(input.securityImpact, "CORPORATE_TASK_SECURITY_IMPACT_INVALID"),
        acceptanceCriteria: requireList(input.acceptanceCriteria, "CORPORATE_TASK_ACCEPTANCE_INVALID"),
        dependencies: uniq(input.dependencies ?? []),
        requiredCapabilities: requireList(input.requiredCapabilities, "CORPORATE_TASK_CAPABILITIES_INVALID"),
        priority: input.priority ?? "P2",
        successDefinition: requireText(input.successDefinition, "CORPORATE_TASK_SUCCESS_INVALID")
      };

      const harmonia = reviewTask(normalized);
      const createdAt = now();
      const task: CorporateTask = {
        corporateTaskId: taskId(),
        objective: normalized.objective,
        plane: normalized.plane,
        departmentId,
        whyNow: normalized.whyNow,
        productImpact: normalized.productImpact,
        securityImpact: normalized.securityImpact,
        acceptanceCriteria: normalized.acceptanceCriteria,
        dependencies: normalized.dependencies ?? [],
        requiredCapabilities: normalized.requiredCapabilities,
        priority: normalized.priority ?? "P2",
        status: harmonia.verdict === "ALLOW" ? "PROPOSED" : harmonia.verdict === "REVISE" ? "NEEDS_REVISION" : "BLOCKED",
        harmonia,
        assignedRoleIds: [],
        recruitmentIds: [],
        plan: [],
        successDefinition: normalized.successDefinition,
        createdAt,
        updatedAt: createdAt
      };

      state.tasks.push(task);
      state.updatedAt = createdAt;
      await this.persist(state);

      if (harmonia.verdict !== "ALLOW") return task;
      return this.planUnlocked(state, task.corporateTaskId);
    });
  }

  async replan(corporateTaskId: string): Promise<CorporateTask> {
    return this.serial(async () => {
      const state = await this.snapshot();
      return this.planUnlocked(state, corporateTaskId);
    });
  }

  async hire(recruitmentIdValue: string, approved = false): Promise<RoleContract> {
    return this.serial(async () => {
      const state = await this.snapshot();
      const request = state.recruitments.find((item) => item.recruitmentId === recruitmentIdValue);
      if (!request) throw new CorporateOrchestratorError("RECRUITMENT_NOT_FOUND", 404);
      if (request.status === "HIRED" && request.resultingRoleId) {
        const role = state.roles.find((item) => item.roleId === request.resultingRoleId);
        if (role) return role;
      }
      if (request.approvalRequired && approved !== true) {
        throw new CorporateOrchestratorError("RECRUITMENT_APPROVAL_REQUIRED", 400);
      }

      const ceiling = EXECUTION_TOOL_CEILING[request.executionRole];
      if (request.requestedTools.some((tool) => !ceiling.has(tool))) {
        throw new CorporateOrchestratorError("RECRUITMENT_TOOL_CEILING_EXCEEDED", 403);
      }

      const createdAt = now();
      const role: RoleContract = {
        roleId: roleId(request.requestedRoleName),
        name: request.requestedRoleName,
        departmentId: request.departmentId,
        mission: request.reason,
        requiredCapabilities: request.requiredCapabilities,
        allowedTools: request.requestedTools,
        executionRole: request.executionRole,
        decisionRights: request.executionRole === "code"
          ? ["implement-within-scope"]
          : request.executionRole === "deploy"
            ? ["release-after-approval"]
            : ["recommend"],
        successMeasures: ["task acceptance criteria satisfied", "verification receipt recorded"],
        riskClass: request.riskClass,
        status: "ACTIVE",
        version: 1,
        createdBy: "HR",
        recruitmentId: request.recruitmentId,
        createdAt,
        updatedAt: createdAt
      };

      state.roles.push(role);
      request.status = "HIRED";
      request.resultingRoleId = role.roleId;
      request.updatedAt = createdAt;
      state.updatedAt = createdAt;
      await this.persist(state);

      for (const task of state.tasks.filter((item) => item.recruitmentIds.includes(request.recruitmentId))) {
        await this.planUnlocked(state, task.corporateTaskId);
      }
      return role;
    });
  }

  async portfolio(): Promise<CorporateTask[]> {
    const state = await this.snapshot();
    const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return [...state.tasks].sort((a, b) =>
      rank[a.priority] - rank[b.priority]
      || Date.parse(a.createdAt) - Date.parse(b.createdAt)
    );
  }

  private async planUnlocked(state: CorporateState, corporateTaskId: string): Promise<CorporateTask> {
    const task = state.tasks.find((item) => item.corporateTaskId === corporateTaskId);
    if (!task) throw new CorporateOrchestratorError("CORPORATE_TASK_NOT_FOUND", 404);
    if (task.harmonia.verdict !== "ALLOW") return task;

    const missing: string[] = [];
    const assigned = new Set<string>();

    for (const capability of task.requiredCapabilities) {
      const role = state.roles.find((candidate) =>
        candidate.status === "ACTIVE"
        && candidate.requiredCapabilities.some((item) => item.toLowerCase() === capability.toLowerCase())
      );
      if (role) assigned.add(role.roleId);
      else missing.push(capability);
    }

    const recruitmentIds = new Set(task.recruitmentIds);
    if (missing.length) {
      const executionRole = mapExecutionRole(missing);
      const requestedTools = toolsFor(executionRole);
      const riskClass = riskFor(executionRole, requestedTools);
      const roleName = `${task.plane.replace(/_/g, " ")} ${executionRole} specialist`;

      let recruitment = state.recruitments.find((item) =>
        item.status === "OPEN"
        && item.departmentId === task.departmentId
        && item.executionRole === executionRole
        && missing.every((capability) => item.requiredCapabilities.includes(capability))
      );

      if (!recruitment) {
        const createdAt = now();
        recruitment = {
          recruitmentId: recruitmentId(),
          requestedRoleName: roleName,
          departmentId: task.departmentId,
          reason: `Required by ${task.corporateTaskId}: ${task.objective}`,
          requiredCapabilities: uniq(missing),
          requestedTools,
          executionRole,
          riskClass,
          approvalRequired: riskClass === "HIGH",
          taskIds: [task.corporateTaskId],
          status: "OPEN",
          createdAt,
          updatedAt: createdAt
        };
        state.recruitments.push(recruitment);
      } else if (!recruitment.taskIds.includes(task.corporateTaskId)) {
        recruitment.taskIds.push(task.corporateTaskId);
        recruitment.updatedAt = now();
      }

      recruitmentIds.add(recruitment.recruitmentId);
    }

    task.assignedRoleIds = [...assigned];
    task.recruitmentIds = [...recruitmentIds];
    task.status = missing.length ? "WAITING_FOR_ROLE" : "READY";
    task.plan = this.executionPlan(task, state.roles.filter((role) => assigned.has(role.roleId)));
    task.updatedAt = now();
    state.updatedAt = task.updatedAt;
    await this.persist(state);
    return task;
  }

  private executionPlan(task: CorporateTask, roles: RoleContract[]): ExecutionPhase[] {
    const research = roles.find((role) => role.executionRole === "research") ?? DEFAULT_ROLES.find((role) => role.executionRole === "research")!;
    const code = roles.find((role) => role.executionRole === "code");
    const security = roles.find((role) => role.executionRole === "audit") ?? DEFAULT_ROLES.find((role) => role.executionRole === "audit")!;

    const phases: ExecutionPhase[] = [
      {
        phase: "DISCOVERY",
        roleId: research.roleId,
        executionRole: "research",
        objective: `Establish evidence, dependencies and constraints for: ${task.objective}`,
        successCondition: "Inputs and risks are explicit enough to execute without guessing."
      }
    ];

    if (code) {
      phases.push({
        phase: "BUILD",
        roleId: code.roleId,
        executionRole: "code",
        objective: task.objective,
        successCondition: task.successDefinition
      });
    }

    phases.push({
      phase: "SECURITY",
      roleId: security.roleId,
      executionRole: "audit",
      objective: `Review security and mandate impact: ${task.securityImpact}`,
      successCondition: "No unresolved security or mandate conflict remains."
    });

    phases.push({
      phase: "VERIFY",
      roleId: security.roleId,
      executionRole: "audit",
      objective: "Verify acceptance criteria and execution receipts independently.",
      successCondition: task.acceptanceCriteria.join("; ")
    });

    phases.push({
      phase: "DELIVERY",
      executionRole: "deploy",
      objective: "Prepare the verified result for explicit release approval.",
      successCondition: "All required receipts pass and release remains operator-approved."
    });

    return phases;
  }

  private async serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writing.then(fn, fn);
    this.writing = run.then(() => undefined, () => undefined);
    return run;
  }

  private async persist(state: CorporateState): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const tmp = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, this.statePath);
  }
}
