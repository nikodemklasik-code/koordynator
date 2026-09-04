export type GateName =
  | "unit"
  | "static"
  | "security"
  | "contract"
  | "integration"
  | "performance"
  | "resilience"
  | "migration";

export type ChangeImpact = {
  changedFiles: string[];
  affectedModules: string[];
  affectedContracts: string[];
  affectedSchemas: string[];
  affectedSecurityControls: string[];
  affectedGates: GateName[];
  uncertainty: "NONE" | "LOW" | "HIGH";
  requiresFullSuite: boolean;
};

const fullSuite: GateName[] = [
  "unit", "static", "security", "contract", "integration", "performance", "resilience", "migration"
];

export function planGates(impact: ChangeImpact): GateName[] {
  if (impact.requiresFullSuite || impact.uncertainty === "HIGH") return [...fullSuite];
  return [...new Set(impact.affectedGates)];
}
