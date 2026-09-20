import { randomUUID } from "node:crypto";
import type { CorporateRisk } from "./domain.js";

export type CorporateFunction =
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
  | "CUSTOM";

export type CorporateRank =
  | "CEO"
  | "HEAD"
  | "DIRECTOR"
  | "MANAGER"
  | "LEAD"
  | "AGENT";

export type DepartmentCharter = {
  departmentId: string;
  name: string;
  function: CorporateFunction;
  mission: string;
  responsibilities: string[];
  risk: CorporateRisk;
  independentControl: boolean;
  screenSlug: string;
  status: "ACTIVE" | "PAUSED";
};

export type CorporatePosition = {
  positionId: string;
  departmentId: string;
  rank: CorporateRank;
  title: string;
  reportsToPositionId?: string;
  roleContractId?: string;
  knowledgeScope: string[];
  decisionRights: string[];
  status: "ACTIVE" | "VACANT" | "PAUSED";
};

export type OrganizationModel = {
  departments: DepartmentCharter[];
  positions: CorporatePosition[];
};

const seed = (
  departmentId: string,
  name: string,
  fn: CorporateFunction,
  mission: string,
  responsibilities: string[],
  risk: CorporateRisk,
  independentControl = false
): DepartmentCharter => ({
  departmentId,
  name,
  function: fn,
  mission,
  responsibilities,
  risk,
  independentControl,
  screenSlug: `corporation/${departmentId.toLowerCase().replace(/^dept-/, "").replace(/[^a-z0-9]+/g, "-")}`,
  status: "ACTIVE"
});

export function defaultDepartmentCharters(): DepartmentCharter[] {
  return [
    seed(
      "DEPT-CEO",
      "CEO Office",
      "EXECUTIVE",
      "Own corporate direction, resolve cross-department conflicts and steward the complete portfolio.",
      ["corporate direction", "portfolio arbitration", "executive decisions", "owner interface"],
      "CRITICAL"
    ),
    seed(
      "DEPT-STRATEGY",
      "Strategy & Portfolio",
      "STRATEGY",
      "Maintain strategic coherence, priorities, dependencies and corporate capacity.",
      ["strategy", "portfolio", "prioritisation", "dependency management"],
      "HIGH"
    ),
    seed(
      "DEPT-PRODUCT",
      "Product",
      "PRODUCT",
      "Translate user and market needs into coherent product outcomes.",
      ["product discovery", "requirements", "roadmap", "UX", "product value"],
      "MEDIUM"
    ),
    seed(
      "DEPT-MARKETING",
      "Marketing",
      "MARKETING",
      "Create evidence-backed positioning, communication and demand generation.",
      ["positioning", "content", "campaigns", "market communication", "brand"],
      "MEDIUM"
    ),
    seed(
      "DEPT-SALES",
      "Sales & Business Development",
      "SALES",
      "Convert product value into sustainable commercial relationships.",
      ["sales", "partnerships", "pipeline", "commercial proposals"],
      "HIGH"
    ),
    seed(
      "DEPT-LEGAL",
      "Legal",
      "LEGAL",
      "Protect the Corporation's legal position and review legally material actions.",
      ["contracts", "legal review", "regulatory interpretation", "legal risk"],
      "CRITICAL",
      true
    ),
    seed(
      "DEPT-HR",
      "HR & Recruitment",
      "HR",
      "Create, maintain and retire bounded Role Contracts in response to real capability gaps.",
      ["recruitment", "role contracts", "capability mapping", "role lifecycle", "training"],
      "HIGH"
    ),
    seed(
      "DEPT-FINANCE",
      "Finance",
      "FINANCE",
      "Maintain financial truth, budgets, unit economics, spending controls and financial resilience.",
      ["budgeting", "forecasting", "cost control", "billing review", "financial reporting"],
      "CRITICAL",
      true
    ),
    seed(
      "DEPT-PRODUCTION",
      "Production & Engineering",
      "PRODUCTION",
      "Build approved product and platform changes with reproducible execution evidence.",
      ["implementation", "engineering", "build", "integration", "release preparation"],
      "HIGH"
    ),
    seed(
      "DEPT-TESTING",
      "Testing & Verification",
      "TESTING",
      "Execute independent technical verification of work products and releases.",
      ["tests", "e2e", "regression", "compatibility", "verification evidence"],
      "HIGH",
      true
    ),
    seed(
      "DEPT-QC",
      "Quality Control",
      "QUALITY_CONTROL",
      "Independently gate quality across every department and every material stage.",
      ["quality gates", "acceptance control", "evidence sufficiency", "process quality", "handoff quality"],
      "CRITICAL",
      true
    ),
    seed(
      "DEPT-SECURITY",
      "Security",
      "SECURITY",
      "Protect systems, data, privileges and constitutional capability boundaries.",
      ["threat modelling", "security review", "access control", "incident response", "security testing"],
      "CRITICAL",
      true
    ),
    seed(
      "DEPT-OPERATIONS",
      "Operations & Reliability",
      "OPERATIONS",
      "Keep corporate services observable, available, recoverable and resource-efficient.",
      ["health", "availability", "backups", "recovery", "runtime operations"],
      "HIGH"
    ),
    seed(
      "DEPT-INTERNAL-DEVELOPMENT",
      "Internal Development",
      "INTERNAL_DEVELOPMENT",
      "Improve Koordynator, the Corporation kernel and internal tools.",
      ["architecture", "developer tooling", "self-improvement", "internal automation"],
      "HIGH"
    ),
    seed(
      "DEPT-RESEARCH",
      "Research & Intelligence",
      "RESEARCH",
      "Gather, challenge and synthesize evidence needed by the Corporation.",
      ["research", "competitive intelligence", "source evaluation", "uncertainty analysis"],
      "MEDIUM"
    ),
    seed(
      "DEPT-DATA",
      "Data & Analytics",
      "DATA",
      "Maintain decision-grade analytics, metrics, data quality and observability.",
      ["analytics", "metrics", "data quality", "reporting", "experimentation"],
      "HIGH"
    ),
    seed(
      "DEPT-CUSTOMER-SUCCESS",
      "Customer Success & Support",
      "CUSTOMER_SUCCESS",
      "Maintain customer outcomes, support evidence and product feedback loops.",
      ["support", "onboarding", "customer outcomes", "feedback", "retention"],
      "MEDIUM"
    ),
    seed(
      "DEPT-PROCUREMENT",
      "Procurement & Vendor Management",
      "PROCUREMENT",
      "Manage external suppliers and provider dependencies without creating avoidable lock-in.",
      ["vendor review", "provider resilience", "procurement", "contract inputs", "dependency substitution"],
      "HIGH"
    ),
    seed(
      "DEPT-COMPLIANCE-RISK",
      "Compliance & Risk",
      "COMPLIANCE_RISK",
      "Maintain the risk register, control framework and compliance evidence.",
      ["risk register", "controls", "compliance evidence", "control testing"],
      "CRITICAL",
      true
    ),
    seed(
      "DEPT-SCIENCE-INNOVATION",
      "Scientific Research & Innovation",
      "SCIENTIFIC_RESEARCH",
      "Run scientific inquiry, falsification, experiments and evidence-backed innovation programs.",
      ["scientific research", "hypothesis design", "falsification", "experiments", "literature review", "innovation evidence"],
      "HIGH",
      true
    ),
    seed(
      "DEPT-INNOVATION",
      "Innovation & Technology Radar",
      "INNOVATION",
      "Continuously absorb relevant novelty from science, technology, providers, standards and markets.",
      ["novelty intake", "technology radar", "trend detection", "provider change tracking", "innovation triage", "opportunity discovery"],
      "MEDIUM"
    ),
    seed(
      "DEPT-VENTURE-STUDIO",
      "Venture Studio & Product Incubation",
      "VENTURE_STUDIO",
      "Turn verified opportunities into experiments, prototypes, product candidates and independent products.",
      ["idea incubation", "product experiments", "prototype portfolio", "business model tests", "product spin-up"],
      "HIGH"
    ),
    seed(
      "DEPT-GROWTH",
      "Growth & Channel Development",
      "GROWTH",
      "Discover, test and scale acquisition, outreach, partnership and distribution channels.",
      ["channel discovery", "growth experiments", "outreach planning", "campaign operations", "partnership sourcing", "funnel optimisation"],
      "HIGH"
    ),
    seed(
      "DEPT-CORPORATE-INTELLIGENCE",
      "Corporate Intelligence",
      "CORPORATE_INTELLIGENCE",
      "Maintain external situational awareness across markets, competitors, regulation, technology and strategic signals.",
      ["market intelligence", "competitor monitoring", "regulatory watch", "technology watch", "strategic signals"],
      "HIGH"
    )
  ];
}

export function seedDepartmentHierarchy(
  charter: DepartmentCharter,
  options: { directors?: number; managers?: number; leads?: number; agents?: number } = {}
): CorporatePosition[] {
  const positions: CorporatePosition[] = [];
  const headRank: CorporateRank = charter.function === "EXECUTIVE" ? "CEO" : "HEAD";
  const headId = `POS-${charter.departmentId}-${headRank}`;

  positions.push({
    positionId: headId,
    departmentId: charter.departmentId,
    rank: headRank,
    title: charter.function === "EXECUTIVE" ? "Chief Executive Officer" : `Head of ${charter.name}`,
    knowledgeScope: ["department-charter", "department-portfolio", "department-risk", "department-quality"],
    decisionRights: ["prioritise-within-mandate", "delegate", "escalate", "approve-internal-handoff"],
    status: "VACANT"
  });

  const directors = Math.max(0, options.directors ?? 1);
  const managers = Math.max(0, options.managers ?? 1);
  const leads = Math.max(0, options.leads ?? 1);
  const agents = Math.max(0, options.agents ?? 1);

  let parent = headId;
  for (const [rank, count] of [
    ["DIRECTOR", directors],
    ["MANAGER", managers],
    ["LEAD", leads],
    ["AGENT", agents]
  ] as Array<[CorporateRank, number]>) {
    for (let index = 0; index < count; index += 1) {
      const positionId = `POS-${randomUUID().slice(0, 8).toUpperCase()}`;
      positions.push({
        positionId,
        departmentId: charter.departmentId,
        rank,
        title: `${rank[0]}${rank.slice(1).toLowerCase()} · ${charter.name}`,
        reportsToPositionId: parent,
        knowledgeScope: ["assigned-stage", "assigned-task", "evidence-needed", "handoff-contract"],
        decisionRights: rank === "AGENT"
          ? ["execute-within-role-contract", "report-evidence", "escalate"]
          : ["delegate-within-scope", "review-subordinate-output", "escalate"],
        status: "VACANT"
      });
      if (index === 0) parent = positionId;
    }
  }

  return positions;
}

export function defaultOrganizationModel(): OrganizationModel {
  const departments = defaultDepartmentCharters();
  return {
    departments,
    positions: departments.flatMap((department) => seedDepartmentHierarchy(department))
  };
}

export function assertHierarchyValid(model: OrganizationModel): void {
  const positions = new Map(model.positions.map((position) => [position.positionId, position]));

  for (const position of model.positions) {
    if (!position.reportsToPositionId) continue;
    const manager = positions.get(position.reportsToPositionId);
    if (!manager) throw new Error(`ORG_MANAGER_NOT_FOUND:${position.positionId}`);
    if (manager.departmentId !== position.departmentId) {
      throw new Error(`ORG_CROSS_DEPARTMENT_REPORTING_REQUIRES_EXPLICIT_MATRIX:${position.positionId}`);
    }
  }

  for (const department of model.departments) {
    const heads = model.positions.filter((position) =>
      position.departmentId === department.departmentId
      && (position.rank === "HEAD" || position.rank === "CEO")
    );
    if (heads.length !== 1) throw new Error(`ORG_DEPARTMENT_HEAD_INVALID:${department.departmentId}`);
  }
}
