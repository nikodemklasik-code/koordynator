export type CorporateRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type CorporatePlane =
  | "INTERNAL_DEVELOPMENT"
  | "PRODUCT"
  | "SECURITY"
  | "OPERATIONS"
  | "HR"
  | "LEGAL_PRODUCT";

export type CorporateTruthState =
  | "PROPOSED"
  | "SUPPORTED"
  | "CONTESTED"
  | "RATIFIED"
  | "REJECTED"
  | "UNKNOWN";

export type HllVerdict = "ALLOW" | "REVISE" | "BLOCK";

export type HllProvenance = {
  sourceType: "OWNER" | "SYSTEM" | "DEPARTMENT" | "ROLE" | "TOOL" | "EXTERNAL";
  sourceId: string;
  evidenceRefs: string[];
  observedAt: string;
};

export type HllStatement = {
  statementId: string;
  subject:
    | "TASK"
    | "DEPARTMENT"
    | "ROLE_CONTRACT"
    | "RECRUITMENT"
    | "DELEGATION"
    | "EXECUTION_RESULT"
    | "SECURITY_FINDING"
    | "SELF_IMPROVEMENT"
    | "PRODUCT_DECISION";
  proposition: string;
  payload: Record<string, unknown>;
  provenance: HllProvenance;
  requestedBrainActions: string[];
  fingerprint: string;
};

export type HllDecision = {
  decisionId: string;
  statementId: string;
  truthState: CorporateTruthState;
  verdict: HllVerdict;
  reasons: string[];
  allowedBrainActions: string[];
  requiredAuthorisations: string[];
  decidedAt: string;
  canonicalRecord?: string;
  canonicalFingerprint?: string;
};

export type Department = {
  departmentId: string;
  name: string;
  plane: CorporatePlane;
  mission: string;
  responsibilities: string[];
  risk: CorporateRisk;
  status: "ACTIVE" | "PAUSED";
  constitutionalSeed: boolean;
  createdAt: string;
  hllDecision?: HllDecision;
};

export type RoleContract = {
  roleId: string;
  name: string;
  departmentId: string;
  mission: string;
  capabilities: string[];
  allowedEffects: string[];
  allowedTools: string[];
  decisionRights: string[];
  successMeasures: string[];
  risk: CorporateRisk;
  status: "ACTIVE" | "PAUSED" | "RETIRED";
  version: number;
  constitutionalSeed: boolean;
  createdBy: "CONSTITUTION" | "HR";
  createdAt: string;
  updatedAt: string;
  recruitmentId?: string;
  hllDecision?: HllDecision;
};

export type RecruitmentRequest = {
  recruitmentId: string;
  taskId: string;
  departmentId: string;
  requestedRoleName: string;
  reason: string;
  missingCapabilities: string[];
  requestedEffects: string[];
  requestedTools: string[];
  risk: CorporateRisk;
  status: "PROPOSED" | "OPEN" | "NEEDS_REVISION" | "BLOCKED" | "HIRED" | "REJECTED";
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
  hllDecision?: HllDecision;
  resultingRoleId?: string;
};

export type CorporateTaskStatus =
  | "PROPOSED"
  | "NEEDS_REVISION"
  | "WAITING_FOR_ROLE"
  | "READY"
  | "DELEGATED"
  | "VERIFYING"
  | "DONE"
  | "BLOCKED";

export type CorporateTaskInput = {
  objective: string;
  plane: CorporatePlane;
  departmentId?: string;
  whyNow: string;
  productImpact: string;
  securityImpact: string;
  acceptanceCriteria: string[];
  dependencies: string[];
  requiredCapabilities: string[];
  requestedEffects: string[];
  priority: "P0" | "P1" | "P2" | "P3";
  successDefinition: string;
  provenance: HllProvenance;
};

export type ExecutionStage = {
  stageId: string;
  taskId: string;
  order: number;
  roleId: string;
  objective: string;
  requiredCapabilities: string[];
  expectedEvidence: string[];
  successCondition: string;
  status: "PLANNED" | "READY" | "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
};

export type ExecutionPlan = {
  planId: string;
  taskId: string;
  stages: ExecutionStage[];
  generatedAt: string;
  hllDecision?: HllDecision;
};

export type CorporateTask = CorporateTaskInput & {
  taskId: string;
  status: CorporateTaskStatus;
  assignedRoleIds: string[];
  recruitmentIds: string[];
  hllDecision: HllDecision;
  plan?: ExecutionPlan;
  createdAt: string;
  updatedAt: string;
};

export type ExecutorDescriptor = {
  executorId: string;
  capabilities: string[];
  effects: string[];
  tools: string[];
  risk: CorporateRisk;
  healthy: boolean;
  costClass: "FREE" | "LOW" | "STANDARD" | "HIGH";
};

export type SolutionMetrics = {
  correctness: number;
  security: number;
  maintainability: number;
  reversibility: number;
  architectureFit: number;
  productValue: number;
  regressionRisk: number;
  complexity: number;
  moneyCost: number;
  tokenCost: number;
  latency: number;
};

export type SolutionCandidate = {
  candidateId: string;
  taskId: string;
  description: string;
  verified: boolean;
  metrics: SolutionMetrics;
  evidenceRefs: string[];
};

export type CorporateEvent = {
  eventId: string;
  type: string;
  subjectId: string;
  at: string;
  payload: Record<string, unknown>;
};
