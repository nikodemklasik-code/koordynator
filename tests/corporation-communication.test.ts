import { describe, expect, it } from "vitest";
import {
  defaultCommunicationGraph,
  departmentDependencies,
  routeCorporateMessage,
  validateCommunicationGraph
} from "../src/corporation/communication.js";
import { makeHllStatement } from "../src/corporation/hll.js";
import { defaultOrganizationModel } from "../src/corporation/organization.js";
import type { HllDecision } from "../src/corporation/domain.js";
import { createApprovalReceipt, createDecisionReceipt } from "../src/corporation/receipts.js";

const HLL_AUTHORITY = { authorityId: "hll-test", epoch: "1" };
const EMERGENCY_AUTHORITY = { authorityId: "incident-command", epoch: "1" };

function communicationHll() {
  const statement = makeHllStatement({
    subject: "COMMUNICATION",
    proposition: "This material corporate communication may be routed.",
    payload: { route: "DEPT-PRODUCT->DEPT-PRODUCTION" },
    provenance: {
      sourceType: "SYSTEM",
      sourceId: "communication-router",
      evidenceRefs: ["knowledge:handoff"],
      observedAt: new Date().toISOString()
    },
    requestedBrainActions: ["RECORD"]
  });
  const decision: HllDecision = {
    decisionId: `DEC-${statement.statementId}`,
    statementId: statement.statementId,
    subjectId: `SUBJECT-${statement.statementId}`,
    truthState: "CONFIRMED",
    eligibleForFact: true,
    blockers: [],
    allowedBrainActions: [{ action: "RECORD", scope: "INTERNAL" }],
    provenanceIds: [`PROV-${statement.statementId}`],
    hllVersion: "HLL/1.0",
  };
  return {
    statement,
    decision,
    receipt: createDecisionReceipt({
      statement,
      decision,
      authority: HLL_AUTHORITY
    })
  };
}

describe("interdepartmental communication graph", () => {
  it("declares a valid dependency network across the full Corporation", () => {
    const organization = defaultOrganizationModel();
    const graph = defaultCommunicationGraph();

    expect(() => validateCommunicationGraph(graph, organization)).not.toThrow();
    expect(graph.dependencies.length).toBeGreaterThan(30);

    const product = organization.departments.find((item) => item.departmentId === "DEPT-PRODUCT")!;
    const deps = departmentDependencies(graph, product);

    expect(deps.outbound.map((item) => item.toDepartmentId)).toEqual(expect.arrayContaining([
      "DEPT-RESEARCH",
      "DEPT-DATA",
      "DEPT-MARKETING",
      "DEPT-PRODUCTION",
      "DEPT-LEGAL",
      "DEPT-FINANCE"
    ]));
    expect(deps.inbound.map((item) => item.fromDepartmentId)).toEqual(expect.arrayContaining([
      "DEPT-RESEARCH",
      "DEPT-DATA",
      "DEPT-SALES",
      "DEPT-CUSTOMER-SUCCESS",
      "DEPT-QC"
    ]));
  });

  it("requires a knowledge package and statement-bound HLL receipt for Product -> Production handoff", () => {
    const organization = defaultOrganizationModel();
    const graph = defaultCommunicationGraph();

    expect(() => routeCorporateMessage({
      graph,
      organization,
      fromDepartmentId: "DEPT-PRODUCT",
      toDepartmentId: "DEPT-PRODUCTION",
      kind: "HANDOFF",
      priority: "P1",
      subject: "Build approved feature"
    })).toThrow("COMM_KNOWLEDGE_PACKAGE_REQUIRED");

    expect(() => routeCorporateMessage({
      graph,
      organization,
      fromDepartmentId: "DEPT-PRODUCT",
      toDepartmentId: "DEPT-PRODUCTION",
      kind: "HANDOFF",
      priority: "P1",
      subject: "Build approved feature",
      knowledgePackageId: "KPACK-1"
    })).toThrow("COMM_HLL_DECISION_RECEIPT_REQUIRED");

    const hll = communicationHll();
    const routed = routeCorporateMessage({
      graph,
      organization,
      fromDepartmentId: "DEPT-PRODUCT",
      toDepartmentId: "DEPT-PRODUCTION",
      kind: "HANDOFF",
      priority: "P1",
      subject: "Build approved feature",
      taskId: "CORP-1",
      stageId: "STAGE-PRODUCT",
      knowledgePackageId: "KPACK-1",
      evidenceRefs: ["product-spec:1", "research:2"],
      hllStatement: hll.statement,
      hllDecision: hll.decision,
      hllReceipt: hll.receipt
    });

    expect(routed.message.blocking).toBe(true);
    expect(routed.message.requiresAcknowledgement).toBe(true);
    expect(routed.message.policyClassification.material).toBe(true);
    expect(routed.observerDepartmentIds).toContain("DEPT-QC");
  });

  it("keeps Testing -> Production feedback non-blocking", () => {
    const routed = routeCorporateMessage({
      graph: defaultCommunicationGraph(),
      organization: defaultOrganizationModel(),
      fromDepartmentId: "DEPT-TESTING",
      toDepartmentId: "DEPT-PRODUCTION",
      kind: "EVIDENCE",
      priority: "P1",
      subject: "Regression found",
      evidenceRefs: ["test:regression-42"]
    });

    expect(routed.dependency.kind).toBe("FEEDBACK");
    expect(routed.message.blocking).toBe(false);
    expect(routed.message.requiresAcknowledgement).toBe(true);
  });

  it("derives external/material classification instead of trusting caller booleans", () => {
    const graph = defaultCommunicationGraph();
    graph.dependencies.push({
      dependencyId: "DEP-DEPT-PRODUCT-DEPT-CEO-INFORMATION",
      fromDepartmentId: "DEPT-PRODUCT",
      toDepartmentId: "DEPT-CEO",
      kind: "INFORMATION",
      messageKinds: ["DECISION"],
      purpose: "Material product commitment sent to executive office.",
      blocking: false,
      knowledgePackageRequired: false,
      hllRequired: false,
      qcVisible: false
    });

    const routed = routeCorporateMessage({
      graph,
      organization: defaultOrganizationModel(),
      fromDepartmentId: "DEPT-PRODUCT",
      toDepartmentId: "DEPT-CEO",
      kind: "DECISION",
      priority: "P1",
      subject: "External commercial launch commitment",
      effects: ["publish"],
      destinationClass: "EXTERNAL_PUBLIC"
    });

    expect(routed.message.policyClassification.externalEffect).toBe(true);
    expect(routed.message.policyClassification.material).toBe(true);
    expect(routed.observerDepartmentIds).toEqual(expect.arrayContaining([
      "DEPT-QC",
      "DEPT-LEGAL",
      "DEPT-FINANCE",
      "DEPT-COMPLIANCE-RISK"
    ]));
  });

  it("prevents an undelegated Agent from a material handoff and requires a bound receipt for P0 bypass", () => {
    const organization = defaultOrganizationModel();
    const graph = defaultCommunicationGraph();
    const productAgent = organization.positions.find((item) =>
      item.departmentId === "DEPT-PRODUCT" && item.rank === "AGENT"
    )!;

    expect(() => routeCorporateMessage({
      graph,
      organization,
      fromDepartmentId: "DEPT-PRODUCT",
      toDepartmentId: "DEPT-PRODUCTION",
      fromPositionId: productAgent.positionId,
      kind: "HANDOFF",
      priority: "P1",
      subject: "Material product handoff",
      knowledgePackageId: "KPACK-AGENT"
    })).toThrow("COMM_AGENT_MATERIAL_CROSS_DEPARTMENT_REQUIRES_DELEGATION");

    graph.dependencies.push({
      dependencyId: "DEP-DEPT-PRODUCT-DEPT-CEO-ESCALATION",
      fromDepartmentId: "DEPT-PRODUCT",
      toDepartmentId: "DEPT-CEO",
      kind: "INFORMATION",
      messageKinds: ["ESCALATION"],
      purpose: "Emergency escalation path.",
      blocking: false,
      knowledgePackageRequired: false,
      hllRequired: false,
      qcVisible: true
    });

    const policyPayload = {
      kind: "ESCALATION" as const,
      priority: "P0" as const,
      dependencyKind: "INFORMATION" as const,
      effects: [],
      dataClasses: [],
      destinationClass: "INTERNAL" as const
    };
    const approval = createApprovalReceipt({
      authority: EMERGENCY_AUTHORITY,
      action: "corporation.declare-p0",
      subjectId: "DEPT-PRODUCT->DEPT-CEO:ESCALATION",
      payload: policyPayload,
      scope: { priority: "P0", kind: "ESCALATION" },
      validUntil: new Date(Date.now() + 60_000).toISOString()
    });

    const escalation = routeCorporateMessage({
      graph,
      organization,
      fromDepartmentId: "DEPT-PRODUCT",
      toDepartmentId: "DEPT-CEO",
      fromPositionId: productAgent.positionId,
      kind: "ESCALATION",
      priority: "P0",
      subject: "Critical risk escalation",
      emergencyApproval: approval,
      emergencyAuthority: EMERGENCY_AUTHORITY
    });

    expect(escalation.message.priority).toBe("P0");
    expect(escalation.message.fromPositionId).toBe(productAgent.positionId);
    expect(escalation.message.policyClassification.highRisk).toBe(true);
  });

  it("rejects undeclared department-to-department communication paths", () => {
    expect(() => routeCorporateMessage({
      graph: defaultCommunicationGraph(),
      organization: defaultOrganizationModel(),
      fromDepartmentId: "DEPT-MARKETING",
      toDepartmentId: "DEPT-SECURITY",
      kind: "TASK_REQUEST",
      priority: "P2",
      subject: "Undeclared route"
    })).toThrow("COMM_DEPENDENCY_NOT_DECLARED");
  });
});
