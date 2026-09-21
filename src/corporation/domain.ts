import type { DecisionReceipt, HllRecordReceipt } from "./receipts.js";

export type CorporateRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type CorporatePlane =
  | "EXECUTIVE"
  | "STRATEGY"
  | "PRODUCT"
  | "MARKETING"
  | "SALES"
  | "LEGAL"
  | "HR"
  | "FINANCE"
  | "PRODUCTION"
  | "TESTING"
  | "QUALITY_CONTROL"
  | "SECURITY"
  | "OPERATIONS"
  | "INTERNAL_DEVELOPMENT"
  | "RESEARCH"
  | "DATA"
  | "CUSTOMER_SUCCESS"
  | "PROCUREMENT"
  | "COMPLIANCE_RISK"
  | "SCIENTIFIC_RESEARCH"
  | "INNOVATION"
  | "VENTURE_STUDIO"
  | "GROWTH"
  | "CORPORATE_INTELLIGENCE"
  | "LEGAL_PRODUCT";

export type HllTruthState =
  | "UNKNOWN"
  | "STATEMENT"
  | "HYPOTHESIS"
  | "ANTITHESIS"
  | "SUPPORTED"
  | "CONFIRMED"
  | "FALSE"
  | "CONTRADICTED"
  | "ERROR"
  | "UNRESOLVED"
  | "EXPIRED";

export type HllBrainAction =
  | "RECORD"
  | "DO_NOT_RECORD"
  | "DEFER"
  | "REGISTER_UNRESOLVED"
  | "NAME"
  | "RENAME_REPRESENTATION"
  | "ORDER"
  | "INDEX"
  | "EVIDENCE"
  | "RENDER"
  | "UPDATE_RECORD"
  | "EXTERNAL_SEND";

export type HllActionScope = "INTERNAL" | "EXTERNAL";

export type HllActionPermission = {
  action: HllBrainAction;
  scope: HllActionScope;
};

export type HllProvenance = {
  sourceType: "OWNER" | "SYSTEM" | "DEPARTMENT" | "ROLE" | "TOOL" | "EXTERNAL";
  sourceId: string;
  evidenceRefs: string[];
  observedAt: string;
  sourceLocator?: string;
  contentHash?: string;
  verified?: boolean;
};

export type HllStatement = {
  statementId: string;
  subject:
    | "GOAL"
    | "PRODUCT"
    | "PROGRAM"
    | "PROJECT"
    | "PORTFOLIO_DECISION"
    | "DEPARTMENT"
    | "POSITION"
    | "ROLE_CONTRACT"
    | "ACCOUNTABILITY_CONTRACT"
    | "AGENT"
    | "MODEL"
    | "PROVIDER"
    | "SKILL"
    | "CAPABILITY"
    | "CAPABILITY_LEASE"
    | "RECRUITMENT"
    | "DELEGATION"
    | "TASK"
    | "STAGE"
    | "EXECUTION"
    | "EXECUTION_RESULT"
    | "VERIFICATION_RECEIPT"
    | "QUALITY_GATE"
    | "COMMUNICATION"
    | "SECURITY_FINDING"
    | "SELF_IMPROVEMENT"
    | "PRODUCT_DECISION"
    | "HYPOTHESIS"
    | "FALSIFICATION"
    | "INCIDENT"
    | "SOLUTION"
    | "FAILURE_MEMORY"
    | "SOLUTION_MEMORY"
    | "INNOVATION_SIGNAL"
    | "INNOVATION_OPPORTUNITY"
    | "MARKETING_POLICY"
    | "CHANNEL_OPPORTUNITY"
    | "OUTREACH"
    | "BUDGET"
    | "COST_COMMITMENT"
    | "COST_BURDEN"
    | "STAGE_COMMITMENT"
    | "STAGE_TRACE"
    | "STAGE_FRAGMENT"
    | "STAGE_VALIDATION";
  proposition: string;
  payload: Record<string, unknown>;
  provenance: HllProvenance;
  requestedBrainActions: HllBrainAction[];
  fingerprint: string;
};

export type HllDecision = {
  decisionId: string;
  statementId: string;
  subjectId: string;
  truthState: HllTruthState;
  eligibleForFact: boolean;
  blockers: string[];
  allowedBrainActions: HllActionPermission[];
  provenanceIds: string[];
  hllVersion: string;
  semanticHash?: string;
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
  hllStatement?: HllStatement;
  hllReceipt?: DecisionReceipt;
  hllRecordReceipt?: HllRecordReceipt;
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
  hllStatement?: HllStatement;
  hllReceipt?: DecisionReceipt;
  hllRecordReceipt?: HllRecordReceipt;
};

export type RecruitmentCapabilityCeiling = {
  capabilities: string[];
  effects: string[];
  tools: string[];
  decisionRights: string[];
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
  requestedDecisionRights: string[];
  capabilityCeiling: RecruitmentCapabilityCeiling;
  risk: CorporateRisk;
  status: "PROPOSED" | "OPEN" | "NEEDS_REVISION" | "BLOCKED" | "HIRED" | "REJECTED";
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
  hllDecision?: HllDecision;
  hllStatement?: HllStatement;
  hllReceipt?: DecisionReceipt;
  hllRecordReceipt?: HllRecordReceipt;
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

export type CorporateGoalContext = {
  goalId: string;
  statement: string;
  product?: {
    productId: string;
    mission: string;
  };
  project?: {
    projectId: string;
    objective: string;
    productId?: string;
  };
};

export type CorporateTaskInput = {
  goal: CorporateGoalContext;
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
  hllStatement?: HllStatement;
  hllReceipt?: DecisionReceipt;
  hllRecordReceipt?: HllRecordReceipt;
};

export type CorporateTask = CorporateTaskInput & {
  taskId: string;
  status: CorporateTaskStatus;
  assignedRoleIds: string[];
  recruitmentIds: string[];
  hllDecision: HllDecision;
  hllStatement: HllStatement;
  hllReceipt: DecisionReceipt;
  hllRecordReceipt?: HllRecordReceipt;
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

export type CorporationSnapshot = {
  schemaVersion: 1;
  revision: number;
  language: "HLL";
  departments: Department[];
  roles: RoleContract[];
  recruitments: RecruitmentRequest[];
  tasks: CorporateTask[];
  updatedAt: string;
};
