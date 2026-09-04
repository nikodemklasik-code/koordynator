import type { CapabilityRequest, SecurityClass } from "./capability-api.js";

export type ProviderHealth = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "BLOCKED" | "QUARANTINED";
export type ProviderAccessMode = "API" | "SUBSCRIPTION";

export type ProviderDescriptor = {
  providerId: string;
  accessMode: ProviderAccessMode;
  capabilities: string[];
  allowedSecurityClasses: SecurityClass[];
  external: boolean;
  priority: number;
  enabled: boolean;
};

export type ProviderResult<T = unknown> = {
  output: T;
  providerRequestId?: string;
};

export interface ProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  health(): Promise<ProviderHealth>;
  canExecute(request: CapabilityRequest): Promise<boolean>;
  execute<T>(request: CapabilityRequest): Promise<ProviderResult<T>>;
}
