import type { Digest, TaskId } from "../domain/ids.js";

export type SecurityClass = "S0" | "S1" | "S2" | "S3" | "S4" | "S5";
export type AgentRole = "BUILDER" | "FIXER" | "REVIEWER" | "RESEARCHER" | "PLANNER";
export type BillingPolicy = "SUBSCRIPTION_ONLY" | "SUBSCRIPTION_FIRST" | "API_ONLY" | "API_FIRST" | "LOCAL_ONLY";

export type CapabilityRequest<T = unknown> = {
  requestId: string;
  taskId: TaskId;
  tenantId: string;
  role: AgentRole;
  capability: string;
  input: T;
  inputFp?: Digest;
  securityClass: SecurityClass;
  purposeId?: string;
  idempotencyKey?: string;
  requirements: {
    maxLatencyMs?: number;
    maxCost?: number;
    dataResidency?: string[];
    externalProviderAllowed: boolean;
    allowProviderFailover?: boolean;
    allowPaidApiFallback?: boolean;
    providerDiversityRequired?: boolean;
    diversityAgainstProviderId?: string;
    billingPolicy?: BillingPolicy;
  };
};
