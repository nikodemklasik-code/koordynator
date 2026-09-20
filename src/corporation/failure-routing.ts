import { randomUUID } from "node:crypto";

export type WorkUnitKind =
  | "BUILD"
  | "DIAGNOSTICS"
  | "REPAIR"
  | "VERIFICATION"
  | "QC"
  | "SECURITY"
  | "ESCALATION";

export type WorkFailure = {
  failureId: string;
  taskId: string;
  stageId: string;
  originatingUnit: WorkUnitKind;
  originatingRoleId: string;
  errorCode: string;
  summary: string;
  evidenceRefs: string[];
  retryable: boolean;
  securityRelevant: boolean;
  createdAt: string;
};

export type FailureRoute = {
  failureId: string;
  nextUnits: WorkUnitKind[];
  originatingUnitMayRepair: boolean;
  requiresIndependentVerifier: boolean;
  rationale: string[];
};

export const STRICT_SEPARATION_OF_DUTIES = {
  BUILD: ["BUILD"] as WorkUnitKind[],
  DIAGNOSTICS: ["DIAGNOSTICS"] as WorkUnitKind[],
  REPAIR: ["REPAIR"] as WorkUnitKind[],
  VERIFICATION: ["VERIFICATION"] as WorkUnitKind[],
  QC: ["QC"] as WorkUnitKind[],
  SECURITY: ["SECURITY"] as WorkUnitKind[],
  ESCALATION: ["ESCALATION"] as WorkUnitKind[]
};

export function createWorkFailure(input: Omit<WorkFailure, "failureId" | "createdAt">): WorkFailure {
  return {
    ...input,
    evidenceRefs: [...new Set(input.evidenceRefs)],
    failureId: `FAIL-${randomUUID().slice(0, 10).toUpperCase()}`,
    createdAt: new Date().toISOString()
  };
}

/**
 * A Builder builds. It does not diagnose, repair and certify its own failure.
 *
 * Failure handling is deliberately transferred to separate work units:
 * diagnostics -> repair -> independent verification -> QC.
 */
export function routeFailure(failure: WorkFailure): FailureRoute {
  if (failure.securityRelevant) {
    return {
      failureId: failure.failureId,
      nextUnits: ["SECURITY", "DIAGNOSTICS", "REPAIR", "VERIFICATION", "QC"],
      originatingUnitMayRepair: false,
      requiresIndependentVerifier: true,
      rationale: [
        "security-relevant failure requires Security participation",
        "originating unit cannot repair or certify its own failure",
        "repair is independently verified before QC closure"
      ]
    };
  }

  if (failure.originatingUnit === "BUILD") {
    return {
      failureId: failure.failureId,
      nextUnits: ["DIAGNOSTICS", "REPAIR", "VERIFICATION", "QC"],
      originatingUnitMayRepair: false,
      requiresIndependentVerifier: true,
      rationale: [
        "Builder remains focused on the assigned build objective",
        "diagnosis and repair belong to separate responsibility contracts",
        "verification must remain independent from both builder and repair unit"
      ]
    };
  }

  if (failure.originatingUnit === "REPAIR") {
    return {
      failureId: failure.failureId,
      nextUnits: ["DIAGNOSTICS", "ESCALATION", "VERIFICATION", "QC"],
      originatingUnitMayRepair: false,
      requiresIndependentVerifier: true,
      rationale: [
        "failed repair is re-diagnosed rather than recursively self-repaired",
        "repeated failure may escalate",
        "closure still requires independent verification"
      ]
    };
  }

  if (failure.originatingUnit === "VERIFICATION" || failure.originatingUnit === "QC") {
    return {
      failureId: failure.failureId,
      nextUnits: ["DIAGNOSTICS", "ESCALATION"],
      originatingUnitMayRepair: false,
      requiresIndependentVerifier: true,
      rationale: [
        "control functions report and escalate; they do not mutate the artifact they control"
      ]
    };
  }

  return {
    failureId: failure.failureId,
    nextUnits: ["DIAGNOSTICS", "REPAIR", "VERIFICATION", "QC"],
    originatingUnitMayRepair: false,
    requiresIndependentVerifier: true,
    rationale: [
      "separation of duties is the default",
      "failure management is transferred to purpose-built work units"
    ]
  };
}

export function assertUnitMayPerform(unit: WorkUnitKind, actionUnit: WorkUnitKind): void {
  if (!STRICT_SEPARATION_OF_DUTIES[unit].includes(actionUnit)) {
    throw new Error(`SEPARATION_OF_DUTIES_VIOLATION:${unit}->${actionUnit}`);
  }
}
