import { randomUUID } from "node:crypto";
import type { HllDecision } from "./domain.js";
import type { DepartmentCharter, OrganizationModel } from "./organization.js";

export type CommunicationDependencyKind =
  | "BLOCKING"
  | "CONTROL"
  | "SERVICE"
  | "ADVISORY"
  | "FEEDBACK"
  | "INFORMATION";

export type CorporateMessageKind =
  | "TASK_REQUEST"
  | "STATUS"
  | "EVIDENCE"
  | "DECISION"
  | "HANDOFF"
  | "REVIEW_REQUEST"
  | "APPROVAL_REQUEST"
  | "QUALITY_GATE"
  | "LEGAL_REVIEW"
  | "SECURITY_REVIEW"
  | "FINANCE_REVIEW"
  | "VENDOR_REVIEW"
  | "RISK_ALERT"
  | "INCIDENT"
  | "ESCALATION"
  | "CUSTOMER_FEEDBACK"
  | "MARKET_FEEDBACK";

export type CommunicationDependency = {
  dependencyId: string;
  fromDepartmentId: string;
  toDepartmentId: string;
  kind: CommunicationDependencyKind;
  messageKinds: CorporateMessageKind[];
  purpose: string;
  blocking: boolean;
  knowledgePackageRequired: boolean;
  hllRequired: boolean;
  qcVisible: boolean;
  escalationDepartmentId?: string;
};

export type CrossCuttingCommunicationRule = {
  ruleId: string;
  observerDepartmentId: string;
  kinds: CorporateMessageKind[];
  when: "ALWAYS" | "MATERIAL" | "HIGH_RISK" | "EXTERNAL_EFFECT";
  purpose: string;
};

export type CorporateCommunicationGraph = {
  dependencies: CommunicationDependency[];
  crossCuttingRules: CrossCuttingCommunicationRule[];
};

export type CorporateMessagePriority = "P0" | "P1" | "P2" | "P3";

export type CorporateMessage = {
  messageId: string;
  correlationId: string;
  parentMessageId?: string;
  taskId?: string;
  stageId?: string;
  fromDepartmentId: string;
  toDepartmentId: string;
  fromPositionId?: string;
  toPositionId?: string;
  kind: CorporateMessageKind;
  priority: CorporateMessagePriority;
  subject: string;
  bodyRef?: string;
  knowledgePackageId?: string;
  evidenceRefs: string[];
  requiresAcknowledgement: boolean;
  blocking: boolean;
  hllDecision?: HllDecision;
  createdAt: string;
  dueAt?: string;
};

export type RoutedCorporateMessage = {
  message: CorporateMessage;
  dependency: CommunicationDependency;
  observerDepartmentIds: string[];
};

export type CommunicationReceipt = {
  receiptId: string;
  messageId: string;
  departmentId: string;
  status: "ACKNOWLEDGED" | "ACCEPTED" | "REJECTED" | "RESPONDED" | "ESCALATED";
  detail?: string;
  evidenceRefs: string[];
  at: string;
};

const dep = (
  fromDepartmentId: string,
  toDepartmentId: string,
  kind: CommunicationDependencyKind,
  messageKinds: CorporateMessageKind[],
  purpose: string,
  options: {
    blocking?: boolean;
    knowledgePackageRequired?: boolean;
    hllRequired?: boolean;
    qcVisible?: boolean;
    escalationDepartmentId?: string;
  } = {}
): CommunicationDependency => ({
  dependencyId: `DEP-${fromDepartmentId}-${toDepartmentId}-${kind}`,
  fromDepartmentId,
  toDepartmentId,
  kind,
  messageKinds,
  purpose,
  blocking: options.blocking ?? ["BLOCKING", "CONTROL"].includes(kind),
  knowledgePackageRequired: options.knowledgePackageRequired ?? messageKinds.includes("HANDOFF"),
  hllRequired: options.hllRequired ?? ["BLOCKING", "CONTROL"].includes(kind),
  qcVisible: options.qcVisible ?? ["BLOCKING", "CONTROL"].includes(kind),
  ...(options.escalationDepartmentId === undefined
    ? {}
    : { escalationDepartmentId: options.escalationDepartmentId })
});

export function defaultCommunicationGraph(): CorporateCommunicationGraph {
  const dependencies: CommunicationDependency[] = [
    dep("DEPT-CEO", "DEPT-STRATEGY", "CONTROL", ["TASK_REQUEST", "DECISION"], "Executive direction enters the corporate portfolio.", { escalationDepartmentId: "DEPT-CEO" }),
    dep("DEPT-STRATEGY", "DEPT-PRODUCT", "ADVISORY", ["TASK_REQUEST", "DECISION"], "Strategic priorities constrain product planning."),
    dep("DEPT-STRATEGY", "DEPT-FINANCE", "ADVISORY", ["FINANCE_REVIEW", "DECISION"], "Strategy and capacity assumptions are financially tested."),
    dep("DEPT-STRATEGY", "DEPT-COMPLIANCE-RISK", "ADVISORY", ["RISK_ALERT", "REVIEW_REQUEST"], "Strategic commitments are checked against enterprise risk."),

    dep("DEPT-PRODUCT", "DEPT-RESEARCH", "SERVICE", ["TASK_REQUEST", "REVIEW_REQUEST"], "Product requests evidence, market and user research."),
    dep("DEPT-RESEARCH", "DEPT-PRODUCT", "INFORMATION", ["EVIDENCE", "MARKET_FEEDBACK"], "Research returns traceable evidence and uncertainty."),
    dep("DEPT-PRODUCT", "DEPT-DATA", "SERVICE", ["TASK_REQUEST", "REVIEW_REQUEST"], "Product requests analytics and decision-grade metrics."),
    dep("DEPT-DATA", "DEPT-PRODUCT", "INFORMATION", ["EVIDENCE", "STATUS"], "Data returns metrics, experiment results and data-quality evidence."),

    dep("DEPT-PRODUCT", "DEPT-MARKETING", "BLOCKING", ["HANDOFF"], "Approved product positioning and release facts are handed to Marketing.", { knowledgePackageRequired: true }),
    dep("DEPT-MARKETING", "DEPT-SALES", "BLOCKING", ["HANDOFF"], "Market messaging and qualified demand are handed to Sales.", { knowledgePackageRequired: true }),
    dep("DEPT-SALES", "DEPT-PRODUCT", "FEEDBACK", ["CUSTOMER_FEEDBACK", "MARKET_FEEDBACK"], "Sales returns objections, demand and commercial feedback."),
    dep("DEPT-CUSTOMER-SUCCESS", "DEPT-PRODUCT", "FEEDBACK", ["CUSTOMER_FEEDBACK", "EVIDENCE"], "Customer outcomes and support evidence return to Product."),

    dep("DEPT-PRODUCT", "DEPT-PRODUCTION", "BLOCKING", ["HANDOFF", "TASK_REQUEST"], "Product hands an approved build package to Production.", { knowledgePackageRequired: true }),
    dep("DEPT-PRODUCTION", "DEPT-TESTING", "BLOCKING", ["HANDOFF", "REVIEW_REQUEST"], "Build output moves to independent technical verification.", { knowledgePackageRequired: true }),
    dep("DEPT-TESTING", "DEPT-PRODUCTION", "FEEDBACK", ["EVIDENCE", "STATUS"], "Testing returns failures and reproducible evidence without creating a blocking cycle."),
    dep("DEPT-TESTING", "DEPT-QC", "CONTROL", ["QUALITY_GATE", "HANDOFF"], "Independent test evidence is submitted to QC.", { knowledgePackageRequired: true }),
    dep("DEPT-PRODUCTION", "DEPT-SECURITY", "CONTROL", ["SECURITY_REVIEW", "REVIEW_REQUEST"], "Security-sensitive changes require Security review.", { escalationDepartmentId: "DEPT-CEO" }),
    dep("DEPT-PRODUCTION", "DEPT-OPERATIONS", "BLOCKING", ["HANDOFF"], "Verified release candidate moves to Operations.", { knowledgePackageRequired: true }),

    dep("DEPT-QC", "DEPT-PRODUCT", "CONTROL", ["QUALITY_GATE", "REVIEW_REQUEST"], "QC may return product work for correction when evidence or acceptance quality is insufficient.", { blocking: true }),
    dep("DEPT-QC", "DEPT-PRODUCTION", "CONTROL", ["QUALITY_GATE", "REVIEW_REQUEST"], "QC gates material production handoffs.", { blocking: true }),
    dep("DEPT-QC", "DEPT-TESTING", "CONTROL", ["QUALITY_GATE", "REVIEW_REQUEST"], "QC reviews the sufficiency and independence of verification.", { blocking: true }),
    dep("DEPT-QC", "DEPT-MARKETING", "CONTROL", ["QUALITY_GATE", "REVIEW_REQUEST"], "Material public claims require evidence-quality control.", { blocking: true }),
    dep("DEPT-QC", "DEPT-SALES", "CONTROL", ["QUALITY_GATE", "REVIEW_REQUEST"], "Material sales claims require evidence-quality control.", { blocking: true }),
    dep("DEPT-QC", "DEPT-HR", "CONTROL", ["QUALITY_GATE", "REVIEW_REQUEST"], "Recruitment and Role Contract quality may be audited by QC.", { blocking: false }),
    dep("DEPT-QC", "DEPT-CEO", "INFORMATION", ["ESCALATION", "RISK_ALERT"], "Unresolved systemic quality failures escalate to the CEO Office.", { blocking: false, hllRequired: true, qcVisible: true }),

    dep("DEPT-PRODUCT", "DEPT-LEGAL", "CONTROL", ["LEGAL_REVIEW", "REVIEW_REQUEST"], "Legally material product decisions require Legal review."),
    dep("DEPT-MARKETING", "DEPT-LEGAL", "CONTROL", ["LEGAL_REVIEW", "REVIEW_REQUEST"], "Regulated, contractual or material public claims require Legal review."),
    dep("DEPT-SALES", "DEPT-LEGAL", "CONTROL", ["LEGAL_REVIEW", "APPROVAL_REQUEST"], "Contracts and legally material commitments require Legal review."),
    dep("DEPT-PROCUREMENT", "DEPT-LEGAL", "CONTROL", ["VENDOR_REVIEW", "LEGAL_REVIEW"], "Vendor commitments require legal review."),
    dep("DEPT-PROCUREMENT", "DEPT-SECURITY", "CONTROL", ["VENDOR_REVIEW", "SECURITY_REVIEW"], "Providers with data/tool access require security review."),
    dep("DEPT-PROCUREMENT", "DEPT-FINANCE", "CONTROL", ["VENDOR_REVIEW", "FINANCE_REVIEW"], "Vendor spend and financial exposure require Finance review."),

    dep("DEPT-PRODUCT", "DEPT-FINANCE", "CONTROL", ["FINANCE_REVIEW", "APPROVAL_REQUEST"], "Material roadmap spend and unit economics require Finance review.", { blocking: false }),
    dep("DEPT-SALES", "DEPT-FINANCE", "INFORMATION", ["EVIDENCE", "STATUS"], "Pipeline and commercial outcomes feed financial forecasting."),
    dep("DEPT-FINANCE", "DEPT-CEO", "CONTROL", ["RISK_ALERT", "ESCALATION"], "Material budget, solvency or financial-control issues escalate to the CEO Office.", { blocking: false }),

    dep("DEPT-SECURITY", "DEPT-OPERATIONS", "CONTROL", ["INCIDENT", "SECURITY_REVIEW"], "Security controls and incidents drive operational containment.", { blocking: true }),
    dep("DEPT-OPERATIONS", "DEPT-SECURITY", "INFORMATION", ["INCIDENT", "EVIDENCE"], "Operations returns runtime evidence and incident telemetry."),
    dep("DEPT-SECURITY", "DEPT-CEO", "CONTROL", ["ESCALATION", "RISK_ALERT"], "Critical security risk escalates to the CEO Office.", { blocking: false }),

    dep("DEPT-COMPLIANCE-RISK", "DEPT-LEGAL", "CONTROL", ["REVIEW_REQUEST", "RISK_ALERT"], "Material compliance findings are reviewed with Legal.", { blocking: true }),
    dep("DEPT-COMPLIANCE-RISK", "DEPT-CEO", "CONTROL", ["ESCALATION", "RISK_ALERT"], "Enterprise risk beyond departmental mandate escalates to the CEO Office.", { blocking: false }),

    dep("DEPT-HR", "DEPT-INTERNAL-DEVELOPMENT", "SERVICE", ["TASK_REQUEST", "STATUS"], "HR supplies ratified Role Contracts for internal-development capability gaps.", { blocking: false }),
    dep("DEPT-HR", "DEPT-PRODUCTION", "SERVICE", ["TASK_REQUEST", "STATUS"], "HR supplies ratified Role Contracts for production capability gaps.", { blocking: false }),
    dep("DEPT-HR", "DEPT-PRODUCT", "SERVICE", ["TASK_REQUEST", "STATUS"], "HR supplies ratified Role Contracts for product capability gaps.", { blocking: false }),
    dep("DEPT-HR", "DEPT-SECURITY", "SERVICE", ["TASK_REQUEST", "STATUS"], "HR supplies ratified Role Contracts for security capability gaps.", { blocking: false }),

    dep("DEPT-INTERNAL-DEVELOPMENT", "DEPT-TESTING", "BLOCKING", ["HANDOFF", "REVIEW_REQUEST"], "Internal platform changes require independent verification.", { knowledgePackageRequired: true }),
    dep("DEPT-INTERNAL-DEVELOPMENT", "DEPT-SECURITY", "CONTROL", ["SECURITY_REVIEW", "REVIEW_REQUEST"], "Internal platform privilege or security changes require Security review."),
    dep("DEPT-INTERNAL-DEVELOPMENT", "DEPT-QC", "CONTROL", ["QUALITY_GATE", "HANDOFF"], "Self-improvement and platform changes require QC closure.", { knowledgePackageRequired: true }),

    dep("DEPT-OPERATIONS", "DEPT-DATA", "INFORMATION", ["EVIDENCE", "STATUS"], "Operational metrics feed corporate analytics."),
    dep("DEPT-DATA", "DEPT-STRATEGY", "INFORMATION", ["EVIDENCE", "STATUS"], "Decision-grade metrics feed strategy and portfolio management.")
  ];

  const crossCuttingRules: CrossCuttingCommunicationRule[] = [
    {
      ruleId: "RULE-QC-MATERIAL",
      observerDepartmentId: "DEPT-QC",
      kinds: ["HANDOFF", "QUALITY_GATE", "APPROVAL_REQUEST", "DECISION"],
      when: "MATERIAL",
      purpose: "QC observes material handoffs and decisions across the Corporation."
    },
    {
      ruleId: "RULE-SECURITY-HIGH-RISK",
      observerDepartmentId: "DEPT-SECURITY",
      kinds: ["RISK_ALERT", "INCIDENT", "APPROVAL_REQUEST"],
      when: "HIGH_RISK",
      purpose: "Security observes high-risk and incident communication."
    },
    {
      ruleId: "RULE-LEGAL-EXTERNAL",
      observerDepartmentId: "DEPT-LEGAL",
      kinds: ["LEGAL_REVIEW", "APPROVAL_REQUEST", "DECISION"],
      when: "EXTERNAL_EFFECT",
      purpose: "Legal observes legally material external commitments."
    },
    {
      ruleId: "RULE-FINANCE-EXTERNAL-SPEND",
      observerDepartmentId: "DEPT-FINANCE",
      kinds: ["FINANCE_REVIEW", "VENDOR_REVIEW", "APPROVAL_REQUEST", "DECISION"],
      when: "EXTERNAL_EFFECT",
      purpose: "Finance observes spend and vendor commitments."
    },
    {
      ruleId: "RULE-RISK-MATERIAL",
      observerDepartmentId: "DEPT-COMPLIANCE-RISK",
      kinds: ["RISK_ALERT", "DECISION", "APPROVAL_REQUEST"],
      when: "MATERIAL",
      purpose: "Compliance & Risk observes material control and risk decisions."
    }
  ];

  return { dependencies, crossCuttingRules };
}

export function validateCommunicationGraph(
  graph: CorporateCommunicationGraph,
  organization: OrganizationModel
): void {
  const departments = new Set(organization.departments.map((department) => department.departmentId));
  const ids = new Set<string>();

  for (const dependency of graph.dependencies) {
    if (ids.has(dependency.dependencyId)) throw new Error(`COMM_DUPLICATE_DEPENDENCY:${dependency.dependencyId}`);
    ids.add(dependency.dependencyId);

    if (!departments.has(dependency.fromDepartmentId)) {
      throw new Error(`COMM_FROM_DEPARTMENT_UNKNOWN:${dependency.fromDepartmentId}`);
    }
    if (!departments.has(dependency.toDepartmentId)) {
      throw new Error(`COMM_TO_DEPARTMENT_UNKNOWN:${dependency.toDepartmentId}`);
    }
    if (dependency.fromDepartmentId === dependency.toDepartmentId) {
      throw new Error(`COMM_SELF_DEPENDENCY:${dependency.dependencyId}`);
    }
  }

  for (const rule of graph.crossCuttingRules) {
    if (!departments.has(rule.observerDepartmentId)) {
      throw new Error(`COMM_OBSERVER_UNKNOWN:${rule.observerDepartmentId}`);
    }
  }
}

export function communicationDependency(
  graph: CorporateCommunicationGraph,
  fromDepartmentId: string,
  toDepartmentId: string,
  kind: CorporateMessageKind
): CommunicationDependency | undefined {
  return graph.dependencies.find((dependency) =>
    dependency.fromDepartmentId === fromDepartmentId
    && dependency.toDepartmentId === toDepartmentId
    && dependency.messageKinds.includes(kind)
  );
}

export function routeCorporateMessage(input: {
  graph: CorporateCommunicationGraph;
  organization: OrganizationModel;
  fromDepartmentId: string;
  toDepartmentId: string;
  fromPositionId?: string;
  toPositionId?: string;
  kind: CorporateMessageKind;
  priority: CorporateMessagePriority;
  subject: string;
  taskId?: string;
  stageId?: string;
  bodyRef?: string;
  knowledgePackageId?: string;
  evidenceRefs?: string[];
  material?: boolean;
  highRisk?: boolean;
  externalEffect?: boolean;
  correlationId?: string;
  parentMessageId?: string;
  hllDecision?: HllDecision;
}): RoutedCorporateMessage {
  validateCommunicationGraph(input.graph, input.organization);
  const dependency = communicationDependency(
    input.graph,
    input.fromDepartmentId,
    input.toDepartmentId,
    input.kind
  );
  if (!dependency) {
    throw new Error(
      `COMM_DEPENDENCY_NOT_DECLARED:${input.fromDepartmentId}->${input.toDepartmentId}:${input.kind}`
    );
  }

  if (dependency.knowledgePackageRequired && !input.knowledgePackageId) {
    throw new Error("COMM_KNOWLEDGE_PACKAGE_REQUIRED");
  }
  if (dependency.hllRequired && input.hllDecision?.truthState !== "RATIFIED") {
    throw new Error("COMM_HLL_RATIFICATION_REQUIRED");
  }

  const observers = new Set<string>();
  if (dependency.qcVisible && input.toDepartmentId !== "DEPT-QC" && input.fromDepartmentId !== "DEPT-QC") {
    observers.add("DEPT-QC");
  }

  for (const rule of input.graph.crossCuttingRules) {
    if (!rule.kinds.includes(input.kind)) continue;
    const applies = rule.when === "ALWAYS"
      || (rule.when === "MATERIAL" && input.material === true)
      || (rule.when === "HIGH_RISK" && input.highRisk === true)
      || (rule.when === "EXTERNAL_EFFECT" && input.externalEffect === true);

    if (applies && rule.observerDepartmentId !== input.fromDepartmentId && rule.observerDepartmentId !== input.toDepartmentId) {
      observers.add(rule.observerDepartmentId);
    }
  }

  const message: CorporateMessage = {
    messageId: `MSG-${randomUUID().slice(0, 10).toUpperCase()}`,
    correlationId: input.correlationId ?? `CORR-${randomUUID().slice(0, 10).toUpperCase()}`,
    ...(input.parentMessageId === undefined ? {} : { parentMessageId: input.parentMessageId }),
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    ...(input.stageId === undefined ? {} : { stageId: input.stageId }),
    fromDepartmentId: input.fromDepartmentId,
    toDepartmentId: input.toDepartmentId,
    ...(input.fromPositionId === undefined ? {} : { fromPositionId: input.fromPositionId }),
    ...(input.toPositionId === undefined ? {} : { toPositionId: input.toPositionId }),
    kind: input.kind,
    priority: input.priority,
    subject: input.subject.trim(),
    ...(input.bodyRef === undefined ? {} : { bodyRef: input.bodyRef }),
    ...(input.knowledgePackageId === undefined ? {} : { knowledgePackageId: input.knowledgePackageId }),
    evidenceRefs: [...new Set(input.evidenceRefs ?? [])],
    requiresAcknowledgement: dependency.blocking || ["P0", "P1"].includes(input.priority),
    blocking: dependency.blocking,
    ...(input.hllDecision === undefined ? {} : { hllDecision: input.hllDecision }),
    createdAt: new Date().toISOString()
  };

  return {
    message,
    dependency,
    observerDepartmentIds: [...observers].sort()
  };
}

export function departmentDependencies(
  graph: CorporateCommunicationGraph,
  department: DepartmentCharter
): {
  outbound: CommunicationDependency[];
  inbound: CommunicationDependency[];
  observes: CrossCuttingCommunicationRule[];
} {
  return {
    outbound: graph.dependencies.filter((dependency) => dependency.fromDepartmentId === department.departmentId),
    inbound: graph.dependencies.filter((dependency) => dependency.toDepartmentId === department.departmentId),
    observes: graph.crossCuttingRules.filter((rule) => rule.observerDepartmentId === department.departmentId)
  };
}
