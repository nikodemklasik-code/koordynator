import type { CapabilityRequest, SecurityClass } from "./capability-api.js";

export type ProviderHealth = "HEALTHY" | "DEGRADED" | "RATE_LIMITED" | "UNAVAILABLE" | "AUTH_REQUIRED" | "BLOCKED" | "QUARANTINED";
export type ProviderAccessMode = "API" | "SUBSCRIPTION" | "LOCAL";
export type ProviderTransport = "OFFICIAL_CLI" | "OFFICIAL_SDK" | "RAW_API" | "LOCAL_RUNTIME";
export type ProviderAuthMode = "SUBSCRIPTION_OAUTH" | "DEVICE_OAUTH" | "API_KEY" | "SERVICE_ACCOUNT" | "ENTERPRISE_IDENTITY" | "LOCAL";
export type ProviderBillingMode = "SUBSCRIPTION_INCLUDED" | "SUBSCRIPTION_CREDITS" | "API_PAYG" | "ENTERPRISE_CREDITS" | "LOCAL";

export type ProviderDescriptor = {
  providerId: string;
  accessMode: ProviderAccessMode;
  capabilities: string[];
  allowedSecurityClasses: SecurityClass[];
  external: boolean;
  priority: number;
  enabled: boolean;
  transport?: ProviderTransport;
  authMode?: ProviderAuthMode;
  billingMode?: ProviderBillingMode;
  supportsHeadless?: boolean;
  supportsStructuredOutput?: boolean;
  adapterVersionFp?: `sha256:${string}`;
};

export type ProviderResult<T = unknown> = {
  output: T;
  providerRequestId?: string;
  seatId?: string;
  workspaceBeforeFp?: `sha256:${string}`;
  workspaceAfterFp?: `sha256:${string}`;
};

export interface ProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  health(): Promise<ProviderHealth>;
  canExecute(request: CapabilityRequest): Promise<boolean>;
  execute<T>(request: CapabilityRequest): Promise<ProviderResult<T>>;
}
