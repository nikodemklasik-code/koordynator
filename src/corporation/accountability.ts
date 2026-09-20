import { randomUUID } from "node:crypto";
import type { CorporateRisk, RoleContract } from "./domain.js";

export type ResponsibilityConsequence =
  | "RETRY_NOT_ALLOWED"
  | "RETURN_TO_MANAGER"
  | "ESCALATE_DIAGNOSTICS"
  | "ESCALATE_REPAIR"
  | "ESCALATE_SECURITY"
  | "ESCALATE_QC"
  | "BLOCK_HANDOFF"
  | "REQUIRE_HUMAN_APPROVAL";

export type ConfirmationRequirement = {
  confirmationId: string;
  description: string;
  evidenceKinds: string[];
  mandatory: boolean;
};

export type AccountabilityContract = {
  accountabilityId: string;
  roleId: string;
  version: number;
  responsibilityScope: string[];
  forbiddenScope: string[];
  expectedOutputs: string[];
  confirmationRequirements: ConfirmationRequirement[];
  failureConsequences: ResponsibilityConsequence[];
  escalationTargets: string[];
  domainStandards: string[];
  risk: CorporateRisk;
  effectiveFrom: string;
};

export type AssignmentReceipt = {
  assignmentId: string;
  taskId: string;
  stageId: string;
  roleId: string;
  accountabilityId: string;
  objective: string;
  allowedActions: string[];
  prohibitedActions: string[];
  requiredConfirmations: string[];
  acceptedAt: string;
};

export function accountabilityForRole(
  role: RoleContract,
  input: {
    responsibilityScope?: string[];
    forbiddenScope?: string[];
    expectedOutputs?: string[];
    confirmations?: Array<Omit<ConfirmationRequirement, "confirmationId">>;
    failureConsequences?: ResponsibilityConsequence[];
    escalationTargets?: string[];
    domainStandards?: string[];
  } = {}
): AccountabilityContract {
  const defaultForbidden = [
    "change-own-role-contract",
    "expand-own-capabilities",
    "self-certify-output",
    "repair-unrelated-system-failure",
    "change-task-objective"
  ];

  return {
    accountabilityId: `ACC-${randomUUID().slice(0, 10).toUpperCase()}`,
    roleId: role.roleId,
    version: role.version,
    responsibilityScope: [...new Set(input.responsibilityScope ?? role.capabilities)],
    forbiddenScope: [...new Set([...(input.forbiddenScope ?? []), ...defaultForbidden])],
    expectedOutputs: [...new Set(input.expectedOutputs ?? role.successMeasures)],
    confirmationRequirements: (input.confirmations ?? role.successMeasures.map((description) => ({
      description,
      evidenceKinds: ["execution-receipt"],
      mandatory: true
    }))).map((confirmation) => ({
      ...confirmation,
      confirmationId: `CONF-${randomUUID().slice(0, 8).toUpperCase()}`
    })),
    failureConsequences: [...new Set(input.failureConsequences ?? [
      "RETURN_TO_MANAGER",
      "ESCALATE_DIAGNOSTICS",
      "BLOCK_HANDOFF"
    ])],
    escalationTargets: [...new Set(input.escalationTargets ?? [
      "DEPT-TESTING",
      "DEPT-QC"
    ])],
    domainStandards: [...new Set(input.domainStandards ?? [])],
    risk: role.risk,
    effectiveFrom: new Date().toISOString()
  };
}

export function createAssignmentReceipt(input: {
  taskId: string;
  stageId: string;
  role: RoleContract;
  accountability: AccountabilityContract;
  objective: string;
}): AssignmentReceipt {
  if (input.accountability.roleId !== input.role.roleId) {
    throw new Error("ACCOUNTABILITY_ROLE_MISMATCH");
  }

  return {
    assignmentId: `ASSIGN-${randomUUID().slice(0, 10).toUpperCase()}`,
    taskId: input.taskId,
    stageId: input.stageId,
    roleId: input.role.roleId,
    accountabilityId: input.accountability.accountabilityId,
    objective: input.objective,
    allowedActions: [...input.role.decisionRights],
    prohibitedActions: [...input.accountability.forbiddenScope],
    requiredConfirmations: input.accountability.confirmationRequirements
      .filter((item) => item.mandatory)
      .map((item) => item.confirmationId),
    acceptedAt: new Date().toISOString()
  };
}

export function assertAgentMayAct(
  receipt: AssignmentReceipt,
  action: string
): void {
  if (receipt.prohibitedActions.includes(action)) {
    throw new Error(`ASSIGNMENT_ACTION_FORBIDDEN:${action}`);
  }
  if (!receipt.allowedActions.includes(action)) {
    throw new Error(`ASSIGNMENT_ACTION_NOT_GRANTED:${action}`);
  }
}
