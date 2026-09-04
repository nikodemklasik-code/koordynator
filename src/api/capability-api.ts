export type SecurityClass = "S0" | "S1" | "S2" | "S3" | "S4" | "S5";

export type CapabilityRequest<T = unknown> = {
  requestId: string;
  tenantId: string;
  capability: string;
  input: T;
  securityClass: SecurityClass;
  idempotencyKey?: string;
  requirements: {
    maxLatencyMs?: number;
    maxCost?: number;
    dataResidency?: string[];
    externalProviderAllowed: boolean;
    allowProviderFailover?: boolean;
  };
};
