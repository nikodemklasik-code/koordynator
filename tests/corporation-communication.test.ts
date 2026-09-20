import { describe, expect, it } from "vitest";
import {
  defaultCommunicationGraph,
  departmentDependencies,
  routeCorporateMessage,
  validateCommunicationGraph
} from "../src/corporation/communication.js";
import { defaultOrganizationModel } from "../src/corporation/organization.js";
import type { HllDecision } from "../src/corporation/domain.js";

function ratified(): HllDecision {
  return {
    decisionId: "DEC-COMM-1",
    statementId: "HLL-COMM-1",
    truthState: "RATIFIED",
    verdict: "ALLOW",
    reasons: [],
    allowedBrainActions: ["corporation.communicate", "corporation.handoff"],
    requiredAuthorisations: [],
    decidedAt: new Date().toISOString()
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

  it("requires a knowledge package and ratified HLL decision for material Product -> Production handoff", () => {
    const organization = defaultOrganizationModel();
    const graph = defaultCommunicationGraph();

    expect(() => routeCorporateMessage({
      graph,
      organization,
      fromDepartmentId: "DEPT-PRODUCT",
      toDepartmentId: "DEPT-PRODUCTION",
      kind: "HANDOFF",
      priority: "P1",
      subject: "Build approved feature",
      material: true
    })).toThrow("COMM_KNOWLEDGE_PACKAGE_REQUIRED");

    expect(() => routeCorporateMessage({
      graph,
      organization,
      fromDepartmentId: "DEPT-PRODUCT",
      toDepartmentId: "DEPT-PRODUCTION",
      kind: "HANDOFF",
      priority: "P1",
      subject: "Build approved feature",
      material: true,
      knowledgePackageId: "KPACK-1"
    })).toThrow("COMM_HLL_RATIFICATION_REQUIRED");

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
      material: true,
      knowledgePackageId: "KPACK-1",
      evidenceRefs: ["product-spec:1", "research:2"],
      hllDecision: ratified()
    });

    expect(routed.message.blocking).toBe(true);
    expect(routed.message.requiresAcknowledgement).toBe(true);
    expect(routed.observerDepartmentIds).toContain("DEPT-QC");
  });

  it("keeps Testing -> Production feedback non-blocking so verification can report failures without creating a circular gate", () => {
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

  it("adds cross-cutting Legal, Finance and QC observers for material external commitments", () => {
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
      material: true,
      externalEffect: true
    });

    expect(routed.observerDepartmentIds).toEqual(expect.arrayContaining([
      "DEPT-QC",
      "DEPT-LEGAL",
      "DEPT-FINANCE",
      "DEPT-COMPLIANCE-RISK"
    ]));
  });



  it("prevents an undelegated Agent from owning a material cross-department handoff but keeps P0 escalation open", () => {
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
      material: true,
      knowledgePackageId: "KPACK-AGENT",
      hllDecision: ratified()
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

    const escalation = routeCorporateMessage({
      graph,
      organization,
      fromDepartmentId: "DEPT-PRODUCT",
      toDepartmentId: "DEPT-CEO",
      fromPositionId: productAgent.positionId,
      kind: "ESCALATION",
      priority: "P0",
      subject: "Critical risk escalation",
      highRisk: true
    });

    expect(escalation.message.priority).toBe("P0");
    expect(escalation.message.fromPositionId).toBe(productAgent.positionId);
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
