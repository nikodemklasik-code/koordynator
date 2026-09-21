import { randomUUID } from "node:crypto";

export type ProductLifecycle =
  | "IDEA"
  | "DISCOVERY"
  | "VALIDATION"
  | "BUILD"
  | "LIVE"
  | "SCALE"
  | "PAUSED"
  | "RETIRED";

export type ProjectStatus =
  | "PROPOSED"
  | "ACTIVE"
  | "BLOCKED"
  | "VERIFYING"
  | "DONE"
  | "PAUSED"
  | "CANCELLED";

export type CorporateProduct = {
  productId: string;
  name: string;
  ownerDepartmentId: string;
  lifecycle: ProductLifecycle;
  mission: string;
  customerProblem: string;
  strategicFit: string[];
  projectIds: string[];
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
};

export type CorporateProject = {
  projectId: string;
  programId?: string;
  productId?: string;
  name: string;
  objective: string;
  ownerDepartmentId: string;
  participatingDepartmentIds: string[];
  status: ProjectStatus;
  priority: "P0" | "P1" | "P2" | "P3";
  dependencies: string[];
  milestones: string[];
  successDefinition: string;
  capacityDemand: number;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
};

export type CorporateProgram = {
  programId: string;
  name: string;
  objective: string;
  ownerDepartmentId: string;
  projectIds: string[];
  productIds: string[];
  priority: "P0" | "P1" | "P2" | "P3";
  status: "ACTIVE" | "PAUSED" | "DONE";
  createdAt: string;
  updatedAt: string;
};

export type PortfolioSnapshot = {
  products: CorporateProduct[];
  programs: CorporateProgram[];
  projects: CorporateProject[];
  updatedAt: string;
};

export type PortfolioAllocation = {
  projectId: string;
  allocatedCapacity: number;
  deferredCapacity: number;
  rationale: string[];
};

const priorityWeight: Record<CorporateProject["priority"], number> = {
  P0: 100,
  P1: 60,
  P2: 30,
  P3: 10
};

const riskPenalty: Record<CorporateProject["risk"], number> = {
  LOW: 0,
  MEDIUM: 4,
  HIGH: 10,
  CRITICAL: 20
};

function iso(): string {
  return new Date().toISOString();
}

export class CorporatePortfolio {
  private readonly products = new Map<string, CorporateProduct>();
  private readonly programs = new Map<string, CorporateProgram>();
  private readonly projects = new Map<string, CorporateProject>();

  createProduct(input: Omit<CorporateProduct, "productId" | "projectIds" | "createdAt" | "updatedAt">): CorporateProduct {
    const at = iso();
    const product: CorporateProduct = {
      ...input,
      productId: `PRODUCT-${randomUUID().slice(0, 10).toUpperCase()}`,
      projectIds: [],
      evidenceRefs: [...new Set(input.evidenceRefs)],
      createdAt: at,
      updatedAt: at
    };
    this.products.set(product.productId, product);
    return structuredClone(product);
  }

  createProgram(input: Omit<CorporateProgram, "programId" | "projectIds" | "productIds" | "createdAt" | "updatedAt">): CorporateProgram {
    const at = iso();
    const program: CorporateProgram = {
      ...input,
      programId: `PROGRAM-${randomUUID().slice(0, 10).toUpperCase()}`,
      projectIds: [],
      productIds: [],
      createdAt: at,
      updatedAt: at
    };
    this.programs.set(program.programId, program);
    return structuredClone(program);
  }

  createProject(input: Omit<CorporateProject, "projectId" | "createdAt" | "updatedAt">): CorporateProject {
    if (input.productId && !this.products.has(input.productId)) throw new Error("PORTFOLIO_PRODUCT_NOT_FOUND");
    if (input.programId && !this.programs.has(input.programId)) throw new Error("PORTFOLIO_PROGRAM_NOT_FOUND");

    const at = iso();
    const project: CorporateProject = {
      ...input,
      projectId: `PROJECT-${randomUUID().slice(0, 10).toUpperCase()}`,
      participatingDepartmentIds: [...new Set(input.participatingDepartmentIds)],
      dependencies: [...new Set(input.dependencies)],
      milestones: [...new Set(input.milestones)],
      evidenceRefs: [...new Set(input.evidenceRefs)],
      createdAt: at,
      updatedAt: at
    };
    this.projects.set(project.projectId, project);

    if (project.productId) {
      const product = this.products.get(project.productId)!;
      product.projectIds = [...new Set([...product.projectIds, project.projectId])];
      product.updatedAt = at;
    }
    if (project.programId) {
      const program = this.programs.get(project.programId)!;
      program.projectIds = [...new Set([...program.projectIds, project.projectId])];
      if (project.productId) program.productIds = [...new Set([...program.productIds, project.productId])];
      program.updatedAt = at;
    }

    return structuredClone(project);
  }

  allocateCapacity(totalCapacity: number): PortfolioAllocation[] {
    let remaining = Math.max(0, totalCapacity);
    const active = [...this.projects.values()]
      .filter((project) => ["PROPOSED", "ACTIVE", "VERIFYING"].includes(project.status))
      .sort((a, b) => {
        const scoreA = priorityWeight[a.priority] - riskPenalty[a.risk];
        const scoreB = priorityWeight[b.priority] - riskPenalty[b.risk];
        if (scoreA !== scoreB) return scoreB - scoreA;
        return a.createdAt.localeCompare(b.createdAt);
      });

    return active.map((project) => {
      const allocated = Math.min(project.capacityDemand, remaining);
      remaining -= allocated;
      return {
        projectId: project.projectId,
        allocatedCapacity: allocated,
        deferredCapacity: Math.max(0, project.capacityDemand - allocated),
        rationale: allocated === project.capacityDemand
          ? ["project demand fully allocated under current portfolio priority"]
          : allocated > 0
            ? ["partial allocation due to portfolio capacity constraints"]
            : ["deferred because higher-priority portfolio demand consumed available capacity"]
      };
    });
  }

  snapshot(): PortfolioSnapshot {
    return {
      products: [...this.products.values()].map((item) => structuredClone(item)),
      programs: [...this.programs.values()].map((item) => structuredClone(item)),
      projects: [...this.projects.values()].map((item) => structuredClone(item)),
      updatedAt: iso()
    };
  }
}
