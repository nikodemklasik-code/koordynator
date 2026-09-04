import type { CapabilityRequest } from "./capability-api.js";
import { EnvCredentialBroker } from "./credential-broker.js";
import type { ProviderAdapter, ProviderDescriptor, ProviderHealth, ProviderResult } from "./provider-contract.js";

export type RawApiSpec = {
  descriptor: ProviderDescriptor;
  endpoint: string;
  credentialRef: string;
  authHeader?: string;
  authPrefix?: string;
  timeoutMs?: number;
  buildBody(request: CapabilityRequest): unknown;
  parseBody(body: unknown): unknown;
};

export class RawApiProviderAdapter implements ProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  constructor(private readonly spec: RawApiSpec, private readonly credentials: EnvCredentialBroker) {
    if (spec.descriptor.accessMode !== "API") throw new Error("RAW_API_ACCESS_MODE_REQUIRED");
    this.descriptor = { ...spec.descriptor, transport: "RAW_API", authMode: spec.descriptor.authMode ?? "API_KEY", billingMode: spec.descriptor.billingMode ?? "API_PAYG" };
  }

  async health(): Promise<ProviderHealth> {
    try {
      new URL(this.spec.endpoint);
      return "HEALTHY";
    } catch {
      return "BLOCKED";
    }
  }

  async canExecute(request: CapabilityRequest): Promise<boolean> {
    return this.descriptor.enabled
      && this.descriptor.capabilities.includes(request.capability)
      && this.descriptor.allowedSecurityClasses.includes(request.securityClass);
  }

  async execute<T>(request: CapabilityRequest): Promise<ProviderResult<T>> {
    const lease = this.credentials.acquire(this.spec.credentialRef, this.descriptor.providerId, request.tenantId, request.capability);
    const headers: Record<string, string> = { "content-type": "application/json" };
    headers[this.spec.authHeader ?? "authorization"] = `${this.spec.authPrefix ?? "Bearer "}${lease.secret}`;
    const response = await fetch(this.spec.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(this.spec.buildBody(request)),
      signal: AbortSignal.timeout(this.spec.timeoutMs ?? 120_000)
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      if (response.status === 401 || response.status === 403) throw new Error("AUTH_REQUIRED");
      if (response.status === 429) throw new Error("RATE_LIMITED");
      throw new Error(`PROVIDER_API_${response.status}:${body}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const body: unknown = contentType.includes("application/json") ? await response.json() : await response.text();
    const providerRequestId = response.headers.get("x-request-id");
    return {
      output: this.spec.parseBody(body) as T,
      ...(providerRequestId === null ? {} : { providerRequestId })
    };
  }
}
