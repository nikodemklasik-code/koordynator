export type SolutionAdmissibility = {
  goalSatisfied: boolean;
  productCongruence: boolean;
  hllValid: boolean;
  requiredRelationsPreserved: boolean;
  requiredProvenancePreserved: boolean;
  constitutionalConstraintsPreserved: boolean;
  evidenceRefs: string[];
};

export type CostDimension =
  | "money"
  | "time"
  | "compute"
  | "complexity"
  | "maintenance"
  | "externalDependency"
  | "operationalBurden";

export type CostVector = Record<CostDimension, number>;

export type CostBurden = {
  burdenId: string;
  dimension: CostDimension;
  amount: number;
  introducedBy: string;
  serves: string[];
  justificationRefs: string[];
  alternatives: string[];
};

export type RouteEconomics = {
  cost: CostVector;
  burdens: CostBurden[];
};

export type CostReview = {
  proportional: boolean;
  reasons: string[];
};

const DIMENSIONS: CostDimension[] = [
  "money",
  "time",
  "compute",
  "complexity",
  "maintenance",
  "externalDependency",
  "operationalBurden"
];

export function admissibilityReasons(input: SolutionAdmissibility): string[] {
  const reasons: string[] = [];
  if (!input.goalSatisfied) reasons.push("GOAL_NOT_SATISFIED");
  if (!input.productCongruence) reasons.push("PRODUCT_NOT_CONGRUENT");
  if (!input.hllValid) reasons.push("HLL_INVALID");
  if (!input.requiredRelationsPreserved) reasons.push("REQUIRED_RELATIONS_NOT_PRESERVED");
  if (!input.requiredProvenancePreserved) reasons.push("REQUIRED_PROVENANCE_NOT_PRESERVED");
  if (!input.constitutionalConstraintsPreserved) reasons.push("CONSTITUTIONAL_CONSTRAINTS_NOT_PRESERVED");
  if (!input.evidenceRefs.length) reasons.push("ADMISSIBILITY_EVIDENCE_MISSING");
  return reasons;
}

export function reviewCostProportionality(economics: RouteEconomics): CostReview {
  const reasons: string[] = [];
  const justified = new Map<CostDimension, number>(DIMENSIONS.map((dimension) => [dimension, 0]));

  for (const dimension of DIMENSIONS) {
    const value = economics.cost[dimension];
    if (!Number.isFinite(value) || value < 0) reasons.push(`COST_VECTOR_INVALID:${dimension}`);
  }

  const ids = new Set<string>();
  for (const burden of economics.burdens) {
    if (!burden.burdenId.trim()) reasons.push("COST_BURDEN_ID_MISSING");
    if (ids.has(burden.burdenId)) reasons.push(`COST_BURDEN_DUPLICATE:${burden.burdenId}`);
    ids.add(burden.burdenId);

    if (!Number.isFinite(burden.amount) || burden.amount < 0) {
      reasons.push(`COST_BURDEN_AMOUNT_INVALID:${burden.burdenId}`);
      continue;
    }
    if (!burden.introducedBy.trim()) reasons.push(`COST_BURDEN_ORIGIN_MISSING:${burden.burdenId}`);
    if (!burden.serves.length) reasons.push(`COST_BURDEN_PURPOSE_MISSING:${burden.burdenId}`);
    if (!burden.justificationRefs.length) reasons.push(`COST_BURDEN_JUSTIFICATION_MISSING:${burden.burdenId}`);

    justified.set(
      burden.dimension,
      (justified.get(burden.dimension) ?? 0) + burden.amount
    );
  }

  for (const dimension of DIMENSIONS) {
    const cost = economics.cost[dimension];
    const coverage = justified.get(dimension) ?? 0;
    if (Number.isFinite(cost) && cost > 0 && coverage + 1e-9 < cost) {
      reasons.push(`COST_BURDEN_UNJUSTIFIED:${dimension}`);
    }
  }

  return { proportional: reasons.length === 0, reasons };
}

export function costDominates(left: CostVector, right: CostVector): boolean {
  const noWorse = DIMENSIONS.every((dimension) => left[dimension] <= right[dimension]);
  const strictlyBetter = DIMENSIONS.some((dimension) => left[dimension] < right[dimension]);
  return noWorse && strictlyBetter;
}
